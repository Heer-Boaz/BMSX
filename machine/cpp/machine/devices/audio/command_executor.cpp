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

void ApuCommandExecutor::restoreOutputVoice(const ApuOutputVoiceState& state, ApuVoiceId voiceId) {
	const ApuAudioSlot slot = state.slot;
	m_slots.loadRegisterWords(slot, m_slotRegisterDispatchWords);
	const ApuAudioSource source = resolveApuAudioSource(m_slotRegisterDispatchWords);
	const u32 fadeSamples = m_slots.fadeSamplesRemaining(slot);
	const ApuParameterRegisterWords& outputRegisterWords = fadeSamples > 0u
		? fadeOutputRegisterWords(slot, m_slotRegisterDispatchWords)
		: m_slotRegisterDispatchWords;
	m_audioOutput.restoreVoice(
		slot,
		voiceId,
		source,
		m_sourceDma.bytesForSlot(slot),
		outputRegisterWords,
		m_slots.playbackCursorQ16(slot),
		state
	);
}

Value ApuCommandExecutor::onSelectedSlotRegisterRead(u32 addr) const {
	const u32 slot = m_memory.readIoU32(IO_APU_SLOT) & APU_SLOT_INDEX_MASK;
	const u32 parameterIndex = (addr - IO_APU_SELECTED_SLOT_REG0) / IO_WORD_SIZE;
	return valueNumber(static_cast<double>(m_slots.registerWord(slot, parameterIndex)));
}

void ApuCommandExecutor::onSelectedSlotRegisterWrite(u32 addr, Value value) {
	const u32 slot = m_memory.readIoU32(IO_APU_SLOT) & APU_SLOT_INDEX_MASK;
	writeSlotRegisterWord(slot, (addr - IO_APU_SELECTED_SLOT_REG0) / IO_WORD_SIZE, toU32(value));
}

Value ApuCommandExecutor::selectedSlotRegisterReadThunk(void* context, u32 addr) {
	return static_cast<ApuCommandExecutor*>(context)->onSelectedSlotRegisterRead(addr);
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk into the APU command executor owner.
void ApuCommandExecutor::selectedSlotRegisterWriteThunk(void* context, u32 addr, Value value) {
	static_cast<ApuCommandExecutor*>(context)->onSelectedSlotRegisterWrite(addr, value);
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
	replaceSlotSourceDma(slot, source);
	const ApuVoiceId voiceId = m_slots.allocateVoiceId();
	m_activeSlots.setActive(slot, registerWords, voiceId);
	playOutputVoice(slot, voiceId, source, registerWords, 0u);
	m_serviceClock.scheduleNext(m_scheduler.currentNowCycles());
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
		m_slots.setFadeSamples(slot, fadeSamples);
		m_activeSlots.setPhase(slot, APU_SLOT_PHASE_FADING);
		m_audioOutput.stopSlot(slot, fadeSamples);
		m_serviceClock.scheduleNext(m_scheduler.currentNowCycles());
		return;
	}
	m_audioOutput.stopSlot(slot);
	m_activeSlots.stop(slot);
	m_serviceClock.scheduleNext(m_scheduler.currentNowCycles());
}

void ApuCommandExecutor::setSlotGain(const ApuParameterRegisterWords& registerWords) {
	const ApuAudioSlot slot = registerWords[APU_PARAMETER_SLOT_INDEX] & APU_SLOT_INDEX_MASK;
	writeSlotRegisterWord(slot, APU_PARAMETER_GAIN_Q12_INDEX, registerWords[APU_PARAMETER_GAIN_Q12_INDEX]);
}

void ApuCommandExecutor::replaceSlotSourceDma(ApuAudioSlot slot, const ApuAudioSource& source) {
	m_audioOutput.stopSlot(slot);
	m_sourceDma.loadSlot(m_memory, slot, source);
}

void ApuCommandExecutor::writeSlotRegisterWord(ApuAudioSlot slot, u32 parameterIndex, u32 word) {
	m_slots.writeRegisterWord(slot, parameterIndex, word);
	if ((m_slots.activeMask() & (1u << slot)) != 0u) {
		m_slots.loadRegisterWords(slot, m_slotRegisterDispatchWords);
		const ApuAudioSource source = resolveApuAudioSource(m_slotRegisterDispatchWords);
		const u32 fadeSamples = m_slots.fadeSamplesRemaining(slot);
		if (apuParameterProgramsSourceBuffer(parameterIndex)) {
			replaceSlotSourceDma(slot, source);
			const ApuVoiceId voiceId = m_slots.allocateVoiceId();
			m_slots.assignVoiceId(slot, voiceId);
			playOutputVoice(slot, voiceId, source, m_slotRegisterDispatchWords, fadeSamples);
			m_serviceClock.scheduleNext(m_scheduler.currentNowCycles());
		} else {
			const ApuParameterRegisterWords& outputRegisterWords = fadeSamples > 0u
				? fadeOutputRegisterWords(slot, m_slotRegisterDispatchWords)
				: m_slotRegisterDispatchWords;
			m_audioOutput.writeSlotRegisterWord(
				slot,
				source,
				outputRegisterWords,
				parameterIndex,
				m_slots.playbackCursorQ16(slot)
			);
		}
	}
	m_selectedSlotLatch.refresh();
}

void ApuCommandExecutor::playOutputVoice(ApuAudioSlot slot, ApuVoiceId voiceId, const ApuAudioSource& source, const ApuParameterRegisterWords& registerWords, u32 fadeSamples) {
	const ApuParameterRegisterWords& outputRegisterWords = fadeSamples > 0u
		? fadeOutputRegisterWords(slot, registerWords)
		: registerWords;
	m_audioOutput.playVoice(
		slot,
		voiceId,
		source,
		m_sourceDma.bytesForSlot(slot),
		outputRegisterWords,
		m_slots.playbackCursorQ16(slot),
		fadeSamples
	);
}

const ApuParameterRegisterWords& ApuCommandExecutor::fadeOutputRegisterWords(ApuAudioSlot slot, const ApuParameterRegisterWords& registerWords) {
	for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		m_slotRegisterDispatchWords[index] = registerWords[index];
	}
	const i64 scaledGain = static_cast<i64>(toSignedWord(registerWords[APU_PARAMETER_GAIN_Q12_INDEX])) * static_cast<i64>(m_slots.fadeSamplesRemaining(slot));
	m_slotRegisterDispatchWords[APU_PARAMETER_GAIN_Q12_INDEX] = static_cast<u32>(scaledGain / static_cast<i64>(m_slots.fadeSamplesTotal(slot)));
	return m_slotRegisterDispatchWords;
}

} // namespace bmsx
