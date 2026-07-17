#include "machine/devices/audio/command_executor.h"

#include "machine/bus/io.h"
#include "machine/common/numeric.h"
#include "machine/devices/audio/active_slots.h"
#include "machine/devices/audio/command_fifo.h"
#include "machine/devices/audio/output.h"
#include "machine/devices/audio/selected_slot_latch.h"
#include "machine/devices/audio/service_clock.h"
#include "machine/devices/audio/source.h"
#include "machine/devices/audio/slot_bank.h"
#include "machine/devices/device_status.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"

namespace bmsx {

ApuCommandExecutor::ApuCommandExecutor(Memory& memory,
	ApuOutputMixer& audioOutput,
	DeviceScheduler& scheduler,
	ApuCommandFifo& commandFifo,
	ApuSourceDma& sourceDma,
	ApuActiveSlots& activeSlots,
	ApuSlotBank& slots,
	ApuSelectedSlotLatch& selectedSlotLatch,
	DeviceStatusLatch& fault,
	ApuServiceClock& serviceClock)
	: m_memory(memory)
	, m_audioOutput(audioOutput)
	, m_scheduler(scheduler)
	, m_commandFifo(commandFifo)
	, m_sourceDma(sourceDma)
	, m_activeSlots(activeSlots)
	, m_slots(slots)
	, m_selectedSlotLatch(selectedSlotLatch)
	, m_fault(fault)
	, m_serviceClock(serviceClock) {}

void ApuCommandExecutor::drainCommandFifo() {
	while (!m_commandFifo.empty()) {
		const u32 command = m_commandFifo.popInto(m_commandDispatchRegisterWords);
		executeCommand(command, m_commandDispatchRegisterWords);
	}
}

void ApuCommandExecutor::restoreOutputVoice(const ApuOutputVoiceState& state) {
	const ApuAudioSlot slot = state.slot;
	m_slots.loadRegisterWords(slot, m_slotRegisterDispatchWords);
	const ApuAudioSource source = resolveApuAudioSource(m_slotRegisterDispatchWords);
	m_audioOutput.restoreVoice(
		slot,
		source,
		m_sourceDma.bytesForSlot(slot),
		m_slotRegisterDispatchWords,
		state
	);
}

Value ApuCommandExecutor::selectedSlotRegisterReadThunk(void* context, u32 addr) {
	auto& executor = *static_cast<ApuCommandExecutor*>(context);
	const i64 nowCycles = executor.m_scheduler.currentNowCycles();
	executor.m_serviceClock.synchronize(nowCycles);
	const u32 slot = executor.m_memory.readIoU32(IO_APU_SLOT) & APU_SLOT_INDEX_MASK;
	const u32 parameterIndex = (addr - IO_APU_SELECTED_SLOT_REG0) / IO_WORD_SIZE;
	return valueNumber(static_cast<double>(executor.m_slots.registerWord(slot, parameterIndex)));
}

void ApuCommandExecutor::selectedSlotRegisterWriteThunk(void* context, u32 addr, Value value) {
	auto& executor = *static_cast<ApuCommandExecutor*>(context);
	const i64 nowCycles = executor.m_scheduler.currentNowCycles();
	executor.m_serviceClock.synchronize(nowCycles);
	const u32 slot = executor.m_memory.readIoU32(IO_APU_SLOT) & APU_SLOT_INDEX_MASK;
	executor.writeSlotRegisterWord(slot, (addr - IO_APU_SELECTED_SLOT_REG0) / IO_WORD_SIZE, toU32(value));
	executor.m_serviceClock.scheduleNext(nowCycles);
}

void ApuCommandExecutor::executeCommand(u32 command, const ApuParameterRegisterWords& registerWords) {
	switch (command) {
		case APU_CMD_PLAY:
			play(registerWords);
			return;
		case APU_CMD_STOP_SLOT:
			stopSlot(registerWords);
			return;
		case APU_CMD_SET_SLOT_GAIN:
			setSlotGain(registerWords);
			return;
		default:
			m_fault.raise(APU_FAULT_BAD_CMD, command);
			return;
	}
}

void ApuCommandExecutor::play(const ApuParameterRegisterWords& registerWords) {
	const ApuAudioSource source = resolveApuAudioSource(registerWords);
	const ApuAudioSlot slot = registerWords[APU_PARAMETER_SLOT_INDEX] & APU_SLOT_INDEX_MASK;
	startPlay(source, slot, registerWords);
}

void ApuCommandExecutor::startPlay(const ApuAudioSource& source, ApuAudioSlot slot, const ApuParameterRegisterWords& registerWords) {
	m_sourceDma.loadSlot(m_memory, slot, source);
	m_activeSlots.setActive(slot, registerWords);
	m_audioOutput.playVoice(slot, source, m_sourceDma.bytesForSlot(slot), registerWords);
}

void ApuCommandExecutor::stopSlot(const ApuParameterRegisterWords& registerWords) {
	const ApuAudioSlot slot = registerWords[APU_PARAMETER_SLOT_INDEX] & APU_SLOT_INDEX_MASK;
	const u32 fadeSamples = registerWords[APU_PARAMETER_FADE_SAMPLES_INDEX];
	if ((m_slots.activeMask() & (1u << slot)) == 0u) {
		m_audioOutput.stopSlot(slot);
		m_activeSlots.stop(slot);
		return;
	}
	if (fadeSamples > 0u) {
		m_activeSlots.setPhase(slot, APU_SLOT_PHASE_FADING);
		m_audioOutput.stopSlot(slot, fadeSamples);
		return;
	}
	m_audioOutput.stopSlot(slot);
	m_activeSlots.stop(slot);
}

void ApuCommandExecutor::setSlotGain(const ApuParameterRegisterWords& registerWords) {
	const ApuAudioSlot slot = registerWords[APU_PARAMETER_SLOT_INDEX] & APU_SLOT_INDEX_MASK;
	writeSlotRegisterWord(slot, APU_PARAMETER_GAIN_Q12_INDEX, registerWords[APU_PARAMETER_GAIN_Q12_INDEX]);
}

void ApuCommandExecutor::writeSlotRegisterWord(ApuAudioSlot slot, u32 parameterIndex, u32 word) {
	m_slots.writeRegisterWord(slot, parameterIndex, word);
	if ((m_slots.activeMask() & (1u << slot)) != 0u) {
		m_slots.loadRegisterWords(slot, m_slotRegisterDispatchWords);
		const ApuAudioSource source = resolveApuAudioSource(m_slotRegisterDispatchWords);
		if (apuParameterProgramsSourceBuffer(parameterIndex)) {
			m_sourceDma.loadSlot(m_memory, slot, source);
			m_audioOutput.replaceVoiceSource(slot, source, m_sourceDma.bytesForSlot(slot), m_slotRegisterDispatchWords);
		} else {
			m_audioOutput.writeSlotRegisterWord(
				slot,
				source,
				m_slotRegisterDispatchWords,
				parameterIndex
			);
		}
	}
	ApuSelectedSlotLatch::refreshThunk(&m_selectedSlotLatch, IO_APU_SLOT, valueNil());
}

} // namespace bmsx
