#include "machine/devices/audio/controller.h"

#include "machine/devices/audio/command_latch.h"

#include "machine/bus/io.h"
#include "machine/common/numeric.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/scheduler/budget.h"
#include "machine/scheduler/device.h"

#include <utility>

namespace bmsx {
namespace {

constexpr DeviceStatusRegisters APU_DEVICE_STATUS_REGISTERS{
	IO_APU_STATUS,
	IO_APU_FAULT_CODE,
	IO_APU_FAULT_DETAIL,
	IO_APU_FAULT_ACK,
	APU_STATUS_FAULT,
	APU_FAULT_NONE,
};

} // namespace

AudioController::AudioController(Memory& memory, ApuOutputMixer& audioOutput, IrqController& irq, DeviceScheduler& scheduler)
	: m_memory(memory)
	, m_audioOutput(audioOutput)
	, m_scheduler(scheduler)
	, m_eventLatch(memory, irq)
	, m_fault(memory, APU_DEVICE_STATUS_REGISTERS)
	, m_selectedSlotLatch(memory, m_fault, m_slots) {
	m_memory.mapIoRead(IO_APU_STATUS, this, &AudioController::onStatusReadThunk);
	m_memory.mapIoWrite(IO_APU_CMD, this, &AudioController::onCommandWriteThunk);
	m_memory.mapIoWrite(IO_APU_SLOT, this, &AudioController::onSlotWriteThunk);
	m_memory.mapIoRead(IO_APU_OUTPUT_QUEUED_FRAMES, this, &AudioController::onOutputQueuedFramesReadThunk);
	m_memory.mapIoRead(IO_APU_OUTPUT_FREE_FRAMES, this, &AudioController::onOutputFreeFramesReadThunk);
	m_memory.mapIoRead(IO_APU_OUTPUT_CAPACITY_FRAMES, this, &AudioController::onOutputCapacityFramesReadThunk);
	m_memory.mapIoRead(IO_APU_CMD_QUEUED, this, &AudioController::onCommandQueuedReadThunk);
	m_memory.mapIoRead(IO_APU_CMD_FREE, this, &AudioController::onCommandFreeReadThunk);
	m_memory.mapIoRead(IO_APU_CMD_CAPACITY, this, &AudioController::onCommandCapacityReadThunk);
	for (uint32_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		m_memory.mapIoRead(IO_APU_SELECTED_SLOT_REG0 + index * IO_WORD_SIZE, this, &AudioController::onSelectedSlotRegisterReadThunk);
		m_memory.mapIoWrite(IO_APU_SELECTED_SLOT_REG0 + index * IO_WORD_SIZE, this, &AudioController::onSelectedSlotRegisterWriteThunk);
	}
	m_memory.mapIoWrite(IO_APU_FAULT_ACK, this, &AudioController::onFaultAckWriteThunk);
}

void AudioController::dispose() {
	m_scheduler.cancelDeviceService(DeviceServiceApu);
	m_audioOutput.resetPlaybackState();
}

void AudioController::reset() {
	m_commandFifo.reset();
	m_slots.reset();
	m_sourceDma.reset();
	m_sampleCarry = 0;
	m_availableSamples = 0;
	m_scheduler.cancelDeviceService(DeviceServiceApu);
	m_audioOutput.resetPlaybackState();
	m_fault.resetStatus();
	clearApuCommandLatch(m_memory);
	m_eventLatch.reset();
	m_selectedSlotLatch.reset();
	m_memory.writeIoValue(IO_APU_ACTIVE_MASK, valueNumber(0.0));
}

void AudioController::setTiming(int64_t cpuHz, int64_t nowCycles) {
	m_cpuHz = cpuHz;
	if (m_slots.activeMask() == 0u && m_commandFifo.empty()) {
		m_sampleCarry = 0;
		m_availableSamples = 0;
	}
	scheduleNextService(nowCycles);
}

void AudioController::accrueCycles(int cycles, int64_t nowCycles) {
	if (m_slots.activeMask() == 0u || cycles <= 0) {
		return;
	}
	const int64_t wholeSamples = accrueBudgetUnits(m_cpuHz, APU_SAMPLE_RATE_HZ, m_sampleCarry, cycles);
	m_availableSamples += wholeSamples;
	scheduleNextService(nowCycles);
}

void AudioController::onService(int64_t nowCycles) {
	if (!m_commandFifo.empty()) {
		drainCommandFifo();
	}
	if (m_slots.activeMask() == 0u || m_availableSamples == 0) {
		scheduleNextService(nowCycles);
		return;
	}
	advanceActiveSlots(std::exchange(m_availableSamples, 0));
	scheduleNextService(nowCycles);
}

void AudioController::onCommandWrite() {
	const uint32_t command = m_memory.readIoU32(IO_APU_CMD);
	switch (command) {
		case APU_CMD_PLAY:
		case APU_CMD_STOP_SLOT:
		case APU_CMD_SET_SLOT_GAIN:
			if (enqueueCommand(command)) {
				scheduleNextService(m_scheduler.currentNowCycles());
			}
			clearApuCommandLatch(m_memory);
			return;
		case APU_CMD_NONE:
			return;
		default:
			m_fault.raise(APU_FAULT_BAD_CMD, command);
			clearApuCommandLatch(m_memory);
			return;
	}
}

bool AudioController::enqueueCommand(uint32_t command) {
	if (!m_commandFifo.enqueue(command, m_memory)) {
		m_fault.raise(APU_FAULT_CMD_FIFO_FULL, command);
		return false;
	}
	return true;
}

void AudioController::drainCommandFifo() {
	while (!m_commandFifo.empty()) {
		const uint32_t command = m_commandFifo.popInto(m_commandDispatchRegisterWords);
		executeCommand(command, m_commandDispatchRegisterWords);
	}
}

void AudioController::executeCommand(uint32_t command, const ApuParameterRegisterWords& registerWords) {
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

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk back into the APU device instance.
void AudioController::onCommandWriteThunk(void* context, uint32_t, Value) {
	static_cast<AudioController*>(context)->onCommandWrite();
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk back into the APU device instance.
void AudioController::onSlotWriteThunk(void* context, uint32_t, Value) {
	static_cast<AudioController*>(context)->m_selectedSlotLatch.refresh();
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk back into the APU device instance.
void AudioController::onFaultAckWriteThunk(void* context, uint32_t, Value) {
	auto& controller = *static_cast<AudioController*>(context);
	controller.m_fault.acknowledge();
}

Value AudioController::onStatusReadThunk(void* context, uint32_t) {
	return static_cast<AudioController*>(context)->onStatusRead();
}

Value AudioController::onOutputQueuedFramesReadThunk(void* context, uint32_t) {
	auto& controller = *static_cast<AudioController*>(context);
	return valueNumber(static_cast<double>(controller.m_audioOutput.outputRing.queuedFrames()));
}

Value AudioController::onOutputFreeFramesReadThunk(void* context, uint32_t) {
	auto& controller = *static_cast<AudioController*>(context);
	return valueNumber(static_cast<double>(controller.m_audioOutput.outputRing.freeFrames()));
}

Value AudioController::onOutputCapacityFramesReadThunk(void* context, uint32_t) {
	auto& controller = *static_cast<AudioController*>(context);
	return valueNumber(static_cast<double>(controller.m_audioOutput.outputRing.capacityFrames()));
}

Value AudioController::onCommandQueuedReadThunk(void* context, uint32_t) {
	auto& controller = *static_cast<AudioController*>(context);
	return valueNumber(static_cast<double>(controller.m_commandFifo.count()));
}

Value AudioController::onCommandFreeReadThunk(void* context, uint32_t) {
	auto& controller = *static_cast<AudioController*>(context);
	return valueNumber(static_cast<double>(controller.m_commandFifo.free()));
}

Value AudioController::onCommandCapacityReadThunk(void*, uint32_t) {
	return valueNumber(static_cast<double>(APU_COMMAND_FIFO_CAPACITY));
}

Value AudioController::onSelectedSlotRegisterReadThunk(void* context, uint32_t addr) {
	return static_cast<AudioController*>(context)->onSelectedSlotRegisterRead(addr);
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk back into the APU device instance.
void AudioController::onSelectedSlotRegisterWriteThunk(void* context, uint32_t addr, Value value) {
	static_cast<AudioController*>(context)->onSelectedSlotRegisterWrite(addr, value);
}

bool AudioController::readSlot(const ApuParameterRegisterWords& registerWords, ApuAudioSlot& slot) const {
	slot = static_cast<ApuAudioSlot>(registerWords[APU_PARAMETER_SLOT_INDEX]);
	if (slot >= APU_SLOT_COUNT) {
		m_fault.raise(APU_FAULT_BAD_SLOT, slot);
		return false;
	}
	return true;
}

void AudioController::play(const ApuParameterRegisterWords& registerWords) {
	const ApuAudioSource source = resolveApuAudioSource(registerWords);
	ApuAudioSlot slot = 0;
	if (!readSlot(registerWords, slot)) {
		return;
	}
	startPlay(source, slot, registerWords);
}

void AudioController::startPlay(const ApuAudioSource& source, ApuAudioSlot slot, const ApuParameterRegisterWords& registerWords) {
	if (!replaceSlotSourceDma(slot, source)) {
		return;
	}
	const ApuVoiceId voiceId = m_slots.allocateVoiceId();
	setSlotActive(slot, registerWords, voiceId);
	if (!playOutputVoice(slot, voiceId, source, registerWords, 0u)) {
		return;
	}
	scheduleNextService(m_scheduler.currentNowCycles());
}

bool AudioController::playOutputVoice(ApuAudioSlot slot, ApuVoiceId voiceId, const ApuAudioSource& source, const ApuParameterRegisterWords& registerWords, u32 fadeSamples) {
	const ApuParameterRegisterWords& outputRegisterWords = fadeSamples > 0u
		? fadeOutputRegisterWords(slot, registerWords)
		: registerWords;
	const ApuOutputStartResult outputStart = m_audioOutput.playVoice(
		slot,
		voiceId,
		source,
		m_sourceDma.bytesForSlot(slot),
		outputRegisterWords,
		m_slots.playbackCursorQ16(slot),
		fadeSamples
	);
	if (outputStart.faultCode != APU_FAULT_NONE) {
		m_audioOutput.stopSlot(slot);
		stopSlotActive(slot);
		m_fault.raise(outputStart.faultCode, outputStart.faultDetail);
		return false;
	}
	return true;
}

const ApuParameterRegisterWords& AudioController::fadeOutputRegisterWords(ApuAudioSlot slot, const ApuParameterRegisterWords& registerWords) {
	for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		m_slotRegisterDispatchWords[index] = registerWords[index];
	}
	const i64 scaledGain = static_cast<i64>(toSignedWord(registerWords[APU_PARAMETER_GAIN_Q12_INDEX])) * static_cast<i64>(m_slots.fadeSamplesRemaining(slot));
	m_slotRegisterDispatchWords[APU_PARAMETER_GAIN_Q12_INDEX] = static_cast<u32>(scaledGain / static_cast<i64>(m_slots.fadeSamplesTotal(slot)));
	return m_slotRegisterDispatchWords;
}

bool AudioController::replaceSlotSourceDma(ApuAudioSlot slot, const ApuAudioSource& source) {
	m_audioOutput.stopSlot(slot);
	const ApuSourceDmaResult dma = m_sourceDma.loadSlot(m_memory, slot, source);
	if (dma.faultCode != APU_FAULT_NONE) {
		stopSlotActive(slot);
		m_fault.raise(dma.faultCode, dma.faultDetail);
		return false;
	}
	return true;
}

void AudioController::stopSlot(const ApuParameterRegisterWords& registerWords) {
	ApuAudioSlot slot = 0;
	if (!readSlot(registerWords, slot)) {
		return;
	}
	const uint32_t fadeSamples = registerWords[APU_PARAMETER_FADE_SAMPLES_INDEX];
	if ((m_slots.activeMask() & (1u << slot)) == 0u) {
		m_audioOutput.stopSlot(slot);
		stopSlotActive(slot);
		return;
	}
	if (fadeSamples > 0u) {
		m_slots.setFadeSamples(slot, fadeSamples);
		setSlotPhase(slot, APU_SLOT_PHASE_FADING);
		m_audioOutput.stopSlot(slot, fadeSamples);
		scheduleNextService(m_scheduler.currentNowCycles());
		return;
	}
	m_audioOutput.stopSlot(slot);
	stopSlotActive(slot);
	scheduleNextService(m_scheduler.currentNowCycles());
}

void AudioController::setSlotGain(const ApuParameterRegisterWords& registerWords) {
	ApuAudioSlot slot = 0;
	if (!readSlot(registerWords, slot)) {
		return;
	}
	writeSlotRegisterWord(slot, APU_PARAMETER_GAIN_Q12_INDEX, registerWords[APU_PARAMETER_GAIN_Q12_INDEX]);
}

void AudioController::emitSlotEvent(uint32_t kind, ApuAudioSlot slot, ApuVoiceId voiceId, uint32_t sourceAddr) {
	if (m_slots.voiceId(slot) != voiceId) {
		return;
	}
	stopSlotActive(slot);
	m_eventLatch.emit(kind, slot, sourceAddr);
}

void AudioController::setSlotActive(ApuAudioSlot slot, const ApuParameterRegisterWords& registerWords, ApuVoiceId voiceId) {
	m_slots.setActive(slot, registerWords, voiceId);
	m_memory.writeIoValue(IO_APU_ACTIVE_MASK, valueNumber(static_cast<double>(m_slots.activeMask())));
	m_selectedSlotLatch.refresh();
}

void AudioController::stopSlotActive(ApuAudioSlot slot) {
	m_slots.clearSlot(slot);
	m_sourceDma.clearSlot(slot);
	m_memory.writeIoValue(IO_APU_ACTIVE_MASK, valueNumber(static_cast<double>(m_slots.activeMask())));
	m_selectedSlotLatch.refresh();
}

void AudioController::setSlotPhase(ApuAudioSlot slot, ApuSlotPhase phase) {
	m_slots.setPhase(slot, phase);
	m_memory.writeIoValue(IO_APU_ACTIVE_MASK, valueNumber(static_cast<double>(m_slots.activeMask())));
	m_selectedSlotLatch.refresh();
}

bool AudioController::replayHostOutput(ApuAudioSlot slot, ApuVoiceId voiceId) {
	m_slots.loadRegisterWords(slot, m_slotRegisterDispatchWords);
	return playOutputVoice(
		slot,
		voiceId,
		resolveApuAudioSource(m_slotRegisterDispatchWords),
		m_slotRegisterDispatchWords,
		m_slots.fadeSamplesRemaining(slot)
	);
}

void AudioController::advanceActiveSlots(int64_t samples) {
	for (ApuAudioSlot slot = 0; slot < APU_SLOT_COUNT; slot += 1u) {
		const ApuSlotAdvanceResult result = m_slots.advanceSlot(slot, samples);
		if (result.ended) {
			m_audioOutput.stopSlot(slot);
			emitSlotEvent(APU_EVENT_SLOT_ENDED, slot, result.voiceId, result.sourceAddr);
		}
	}
}

void AudioController::scheduleNextService(int64_t nowCycles) {
	if (!m_commandFifo.empty()) {
		m_scheduler.scheduleDeviceService(DeviceServiceApu, nowCycles);
		return;
	}
	if (m_slots.activeMask() == 0u) {
		m_scheduler.cancelDeviceService(DeviceServiceApu);
		m_sampleCarry = 0;
		m_availableSamples = 0;
		return;
	}
	if (m_availableSamples > 0) {
		m_scheduler.scheduleDeviceService(DeviceServiceApu, nowCycles);
		return;
	}
	m_scheduler.scheduleDeviceService(DeviceServiceApu, nowCycles + cyclesUntilBudgetUnits(m_cpuHz, APU_SAMPLE_RATE_HZ, m_sampleCarry, 1));
}


Value AudioController::onStatusRead() const {
	uint32_t status = m_fault.status;
	if (m_slots.activeMask() != 0u || !m_commandFifo.empty()) {
		status |= APU_STATUS_BUSY;
	}
	if (m_commandFifo.empty()) {
		status |= APU_STATUS_CMD_FIFO_EMPTY;
	}
	if (m_commandFifo.full()) {
		status |= APU_STATUS_CMD_FIFO_FULL;
	}
	const size_t queuedFrames = m_audioOutput.outputRing.queuedFrames();
	if (queuedFrames == 0u) {
		status |= APU_STATUS_OUTPUT_EMPTY;
	}
	if (queuedFrames >= m_audioOutput.outputRing.capacityFrames()) {
		status |= APU_STATUS_OUTPUT_FULL;
	}
	return valueNumber(static_cast<double>(status));
}

Value AudioController::onSelectedSlotRegisterRead(uint32_t addr) const {
	const uint32_t slot = m_memory.readIoU32(IO_APU_SLOT);
	if (slot >= APU_SLOT_COUNT) {
		return valueNumber(0.0);
	}
	const uint32_t parameterIndex = (addr - IO_APU_SELECTED_SLOT_REG0) / IO_WORD_SIZE;
	return valueNumber(static_cast<double>(m_slots.registerWord(slot, parameterIndex)));
}

void AudioController::onSelectedSlotRegisterWrite(uint32_t addr, Value value) {
	const uint32_t slot = m_memory.readIoU32(IO_APU_SLOT);
	if (slot >= APU_SLOT_COUNT) {
		m_fault.raise(APU_FAULT_BAD_SLOT, slot);
		return;
	}
	writeSlotRegisterWord(slot, (addr - IO_APU_SELECTED_SLOT_REG0) / IO_WORD_SIZE, toU32(value));
}

void AudioController::writeSlotRegisterWord(ApuAudioSlot slot, uint32_t parameterIndex, uint32_t word) {
	m_slots.writeRegisterWord(slot, parameterIndex, word);
	if ((m_slots.activeMask() & (1u << slot)) != 0u) {
		m_slots.loadRegisterWords(slot, m_slotRegisterDispatchWords);
		const ApuAudioSource source = resolveApuAudioSource(m_slotRegisterDispatchWords);
		const u32 fadeSamples = m_slots.fadeSamplesRemaining(slot);
		if (apuParameterProgramsSourceBuffer(parameterIndex)) {
			if (!replaceSlotSourceDma(slot, source)) {
				return;
			}
			const ApuVoiceId voiceId = m_slots.allocateVoiceId();
			m_slots.assignVoiceId(slot, voiceId);
			if (!playOutputVoice(slot, voiceId, source, m_slotRegisterDispatchWords, fadeSamples)) {
				return;
			}
			scheduleNextService(m_scheduler.currentNowCycles());
		} else {
			const ApuParameterRegisterWords& outputRegisterWords = fadeSamples > 0u
				? fadeOutputRegisterWords(slot, m_slotRegisterDispatchWords)
				: m_slotRegisterDispatchWords;
			const ApuOutputStartResult outputWrite = m_audioOutput.writeSlotRegisterWord(
				slot,
				source,
				outputRegisterWords,
				parameterIndex,
				m_slots.playbackCursorQ16(slot)
			);
			if (outputWrite.faultCode != APU_FAULT_NONE) {
				m_audioOutput.stopSlot(slot);
				stopSlotActive(slot);
				m_fault.raise(outputWrite.faultCode, outputWrite.faultDetail);
			}
		}
	}
	m_selectedSlotLatch.refresh();
}

} // namespace bmsx
