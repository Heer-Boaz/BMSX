#include "machine/devices/audio/controller.h"

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
	, m_irq(irq)
	, m_scheduler(scheduler)
	, m_fault(memory, APU_DEVICE_STATUS_REGISTERS) {
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
	m_eventSequence = 0;
	resetCommandFifo();
	m_activeSlotMask = 0u;
	m_slotPhases.fill(APU_SLOT_PHASE_IDLE);
	m_slotRegisterWords.fill(0u);
	m_sourceDma.reset();
	m_slotPlaybackCursorQ16.fill(0);
	m_slotFadeSamplesRemaining.fill(0u);
	m_slotFadeSamplesTotal.fill(0u);
	m_sampleCarry = 0;
	m_availableSamples = 0;
	m_slotVoiceIds.fill(0);
	m_nextVoiceId = 1u;
	m_scheduler.cancelDeviceService(DeviceServiceApu);
	m_audioOutput.resetPlaybackState();
	m_fault.resetStatus();
	clearCommandLatch();
	m_memory.writeValue(IO_APU_EVENT_KIND, valueNumber(static_cast<double>(APU_EVENT_NONE)));
	m_memory.writeValue(IO_APU_EVENT_SLOT, valueNumber(0.0));
	m_memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, valueNumber(0.0));
	m_memory.writeValue(IO_APU_EVENT_SEQ, valueNumber(0.0));
	m_memory.writeValue(IO_APU_SELECTED_SOURCE_ADDR, valueNumber(0.0));
	m_memory.writeIoValue(IO_APU_ACTIVE_MASK, valueNumber(0.0));
}

AudioControllerState AudioController::captureState() const {
	AudioControllerState state;
	for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		state.registerWords[index] = m_memory.readIoU32(IO_APU_PARAMETER_REGISTER_ADDRS[index]);
	}
	state.commandFifoCommands = m_commandFifoCommands;
	state.commandFifoRegisterWords = m_commandFifoRegisterWords;
	state.commandFifoReadIndex = m_commandFifoReadIndex;
	state.commandFifoWriteIndex = m_commandFifoWriteIndex;
	state.commandFifoCount = m_commandFifoCount;
	state.eventSequence = m_eventSequence;
	state.eventKind = m_memory.readIoU32(IO_APU_EVENT_KIND);
	state.eventSlot = m_memory.readIoU32(IO_APU_EVENT_SLOT);
	state.eventSourceAddr = m_memory.readIoU32(IO_APU_EVENT_SOURCE_ADDR);
	state.slotPhases = m_slotPhases;
	state.slotRegisterWords = m_slotRegisterWords;
	state.slotSourceBytes = m_sourceDma.captureState();
	state.slotPlaybackCursorQ16 = m_slotPlaybackCursorQ16;
	state.slotFadeSamplesRemaining = m_slotFadeSamplesRemaining;
	state.slotFadeSamplesTotal = m_slotFadeSamplesTotal;
	state.sampleCarry = m_sampleCarry;
	state.availableSamples = m_availableSamples;
	state.apuStatus = m_fault.status;
	state.apuFaultCode = m_fault.code;
	state.apuFaultDetail = m_fault.detail;
	return state;
}

void AudioController::restoreState(const AudioControllerState& state, int64_t nowCycles) {
	m_slotVoiceIds.fill(0);
	m_audioOutput.resetPlaybackState();
	m_nextVoiceId = 1u;
	for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		m_memory.writeIoValue(IO_APU_PARAMETER_REGISTER_ADDRS[index], valueNumber(static_cast<double>(state.registerWords[index])));
	}
	m_commandFifoCommands = state.commandFifoCommands;
	m_commandFifoRegisterWords = state.commandFifoRegisterWords;
	m_commandFifoReadIndex = state.commandFifoReadIndex;
	m_commandFifoWriteIndex = state.commandFifoWriteIndex;
	m_commandFifoCount = state.commandFifoCount;
	m_eventSequence = state.eventSequence;
	m_memory.writeValue(IO_APU_EVENT_KIND, valueNumber(static_cast<double>(state.eventKind)));
	m_memory.writeValue(IO_APU_EVENT_SLOT, valueNumber(static_cast<double>(state.eventSlot)));
	m_memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, valueNumber(static_cast<double>(state.eventSourceAddr)));
	m_memory.writeValue(IO_APU_EVENT_SEQ, valueNumber(static_cast<double>(m_eventSequence)));
	m_slotPhases = state.slotPhases;
	m_activeSlotMask = 0u;
	for (ApuAudioSlot slot = 0; slot < APU_SLOT_COUNT; slot += 1u) {
		if (m_slotPhases[slot] != APU_SLOT_PHASE_IDLE) {
			m_activeSlotMask |= 1u << slot;
		}
	}
	m_memory.writeIoValue(IO_APU_ACTIVE_MASK, valueNumber(static_cast<double>(m_activeSlotMask)));
	m_slotRegisterWords = state.slotRegisterWords;
	m_sourceDma.restoreState(state.slotSourceBytes);
	m_slotPlaybackCursorQ16 = state.slotPlaybackCursorQ16;
	m_slotFadeSamplesRemaining = state.slotFadeSamplesRemaining;
	m_slotFadeSamplesTotal = state.slotFadeSamplesTotal;
	m_sampleCarry = state.sampleCarry;
	m_availableSamples = state.availableSamples;
	m_fault.restore(state.apuStatus, state.apuFaultCode, state.apuFaultDetail);
	for (ApuAudioSlot slot = 0; slot < APU_SLOT_COUNT; slot += 1u) {
		if (m_slotPhases[slot] == APU_SLOT_PHASE_IDLE) {
			continue;
		}
		const ApuVoiceId voiceId = m_nextVoiceId;
		m_nextVoiceId += 1u;
		m_slotVoiceIds[slot] = voiceId;
		replayHostOutput(slot, voiceId);
	}
	updateSelectedSlotActiveStatus();
	scheduleNextService(nowCycles);
}

void AudioController::setTiming(int64_t cpuHz, int64_t nowCycles) {
	m_cpuHz = cpuHz;
	if (m_activeSlotMask == 0u && m_commandFifoCount == 0u) {
		m_sampleCarry = 0;
		m_availableSamples = 0;
	}
	scheduleNextService(nowCycles);
}

void AudioController::accrueCycles(int cycles, int64_t nowCycles) {
	if (m_activeSlotMask == 0u || cycles <= 0) {
		return;
	}
	const int64_t wholeSamples = accrueBudgetUnits(m_cpuHz, APU_SAMPLE_RATE_HZ, m_sampleCarry, cycles);
	m_availableSamples += wholeSamples;
	scheduleNextService(nowCycles);
}

void AudioController::onService(int64_t nowCycles) {
	if (m_commandFifoCount > 0u) {
		drainCommandFifo();
	}
	if (m_activeSlotMask == 0u || m_availableSamples == 0) {
		scheduleNextService(nowCycles);
		return;
	}
	advanceActiveSlots(std::exchange(m_availableSamples, 0));
	scheduleNextService(nowCycles);
}

void AudioController::clearCommandLatch() {
	resetCommandLatch();
	m_memory.writeIoValue(IO_APU_CMD, valueNumber(static_cast<double>(APU_CMD_NONE)));
}

void AudioController::resetCommandLatch() {
	m_memory.writeValue(IO_APU_SOURCE_ADDR, valueNumber(0.0));
	m_memory.writeValue(IO_APU_SOURCE_BYTES, valueNumber(0.0));
	m_memory.writeValue(IO_APU_SOURCE_SAMPLE_RATE_HZ, valueNumber(0.0));
	m_memory.writeValue(IO_APU_SOURCE_CHANNELS, valueNumber(0.0));
	m_memory.writeValue(IO_APU_SOURCE_BITS_PER_SAMPLE, valueNumber(0.0));
	m_memory.writeValue(IO_APU_SOURCE_FRAME_COUNT, valueNumber(0.0));
	m_memory.writeValue(IO_APU_SOURCE_DATA_OFFSET, valueNumber(0.0));
	m_memory.writeValue(IO_APU_SOURCE_DATA_BYTES, valueNumber(0.0));
	m_memory.writeValue(IO_APU_SOURCE_LOOP_START_SAMPLE, valueNumber(0.0));
	m_memory.writeValue(IO_APU_SOURCE_LOOP_END_SAMPLE, valueNumber(0.0));
	m_memory.writeValue(IO_APU_SLOT, valueNumber(0.0));
	m_memory.writeValue(IO_APU_RATE_STEP_Q16, valueNumber(static_cast<double>(APU_RATE_STEP_Q16_ONE)));
	m_memory.writeValue(IO_APU_GAIN_Q12, valueNumber(static_cast<double>(APU_GAIN_Q12_ONE)));
	m_memory.writeValue(IO_APU_START_SAMPLE, valueNumber(0.0));
	m_memory.writeValue(IO_APU_FILTER_KIND, valueNumber(static_cast<double>(APU_FILTER_NONE)));
	m_memory.writeValue(IO_APU_FILTER_FREQ_HZ, valueNumber(0.0));
	m_memory.writeValue(IO_APU_FILTER_Q_MILLI, valueNumber(1000.0));
	m_memory.writeValue(IO_APU_FILTER_GAIN_MILLIDB, valueNumber(0.0));
	m_memory.writeValue(IO_APU_FADE_SAMPLES, valueNumber(0.0));
	m_memory.writeValue(IO_APU_GENERATOR_KIND, valueNumber(static_cast<double>(APU_GENERATOR_NONE)));
	m_memory.writeValue(IO_APU_GENERATOR_DUTY_Q12, valueNumber(static_cast<double>(APU_GAIN_Q12_ONE / 2u)));
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
			clearCommandLatch();
			return;
		case APU_CMD_NONE:
			return;
		default:
			m_fault.raise(APU_FAULT_BAD_CMD, command);
			clearCommandLatch();
			return;
	}
}

void AudioController::resetCommandFifo() {
	m_commandFifoCommands.fill(APU_CMD_NONE);
	m_commandFifoRegisterWords.fill(0u);
	m_commandFifoReadIndex = 0u;
	m_commandFifoWriteIndex = 0u;
	m_commandFifoCount = 0u;
}

bool AudioController::enqueueCommand(uint32_t command) {
	if (m_commandFifoCount == APU_COMMAND_FIFO_CAPACITY) {
		m_fault.raise(APU_FAULT_CMD_FIFO_FULL, command);
		return false;
	}
	const uint32_t entry = m_commandFifoWriteIndex;
	m_commandFifoCommands[entry] = command;
	const size_t base = static_cast<size_t>(entry) * APU_PARAMETER_REGISTER_COUNT;
	for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		m_commandFifoRegisterWords[base + index] = m_memory.readIoU32(IO_APU_PARAMETER_REGISTER_ADDRS[index]);
	}
	m_commandFifoWriteIndex += 1u;
	if (m_commandFifoWriteIndex == APU_COMMAND_FIFO_CAPACITY) {
		m_commandFifoWriteIndex = 0u;
	}
	m_commandFifoCount += 1u;
	return true;
}

void AudioController::drainCommandFifo() {
	while (m_commandFifoCount > 0u) {
		const uint32_t entry = m_commandFifoReadIndex;
		const uint32_t command = m_commandFifoCommands[entry];
		const size_t base = static_cast<size_t>(entry) * APU_PARAMETER_REGISTER_COUNT;
		for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
			m_commandDispatchRegisterWords[index] = m_commandFifoRegisterWords[base + index];
			m_commandFifoRegisterWords[base + index] = 0u;
		}
		m_commandFifoCommands[entry] = APU_CMD_NONE;
		m_commandFifoReadIndex += 1u;
		if (m_commandFifoReadIndex == APU_COMMAND_FIFO_CAPACITY) {
			m_commandFifoReadIndex = 0u;
		}
		m_commandFifoCount -= 1u;
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
	static_cast<AudioController*>(context)->updateSelectedSlotActiveStatus();
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
	return valueNumber(static_cast<double>(controller.m_audioOutput.queuedOutputFrames()));
}

Value AudioController::onOutputFreeFramesReadThunk(void* context, uint32_t) {
	auto& controller = *static_cast<AudioController*>(context);
	return valueNumber(static_cast<double>(controller.m_audioOutput.freeOutputFrames()));
}

Value AudioController::onOutputCapacityFramesReadThunk(void* context, uint32_t) {
	auto& controller = *static_cast<AudioController*>(context);
	return valueNumber(static_cast<double>(controller.m_audioOutput.capacityOutputFrames()));
}

Value AudioController::onCommandQueuedReadThunk(void* context, uint32_t) {
	auto& controller = *static_cast<AudioController*>(context);
	return valueNumber(static_cast<double>(controller.m_commandFifoCount));
}

Value AudioController::onCommandFreeReadThunk(void* context, uint32_t) {
	auto& controller = *static_cast<AudioController*>(context);
	return valueNumber(static_cast<double>(APU_COMMAND_FIFO_CAPACITY - controller.m_commandFifoCount));
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
	const ApuVoiceId voiceId = m_nextVoiceId;
	m_nextVoiceId += 1u;
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
		m_slotPlaybackCursorQ16[slot],
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
	const i64 scaledGain = static_cast<i64>(toSignedWord(registerWords[APU_PARAMETER_GAIN_Q12_INDEX])) * static_cast<i64>(m_slotFadeSamplesRemaining[slot]);
	m_slotRegisterDispatchWords[APU_PARAMETER_GAIN_Q12_INDEX] = static_cast<u32>(scaledGain / static_cast<i64>(m_slotFadeSamplesTotal[slot]));
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
	if ((m_activeSlotMask & (1u << slot)) == 0u) {
		m_audioOutput.stopSlot(slot);
		stopSlotActive(slot);
		return;
	}
	if (fadeSamples > 0u) {
		m_slotFadeSamplesRemaining[slot] = fadeSamples;
		m_slotFadeSamplesTotal[slot] = fadeSamples;
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
	if (m_slotVoiceIds[slot] != voiceId) {
		return;
	}
	stopSlotActive(slot);
	m_eventSequence += 1u;
	m_memory.writeValue(IO_APU_EVENT_KIND, valueNumber(static_cast<double>(kind)));
	m_memory.writeValue(IO_APU_EVENT_SLOT, valueNumber(static_cast<double>(slot)));
	m_memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, valueNumber(static_cast<double>(sourceAddr)));
	m_memory.writeValue(IO_APU_EVENT_SEQ, valueNumber(static_cast<double>(m_eventSequence)));
	m_irq.raise(IRQ_APU);
}

void AudioController::setSlotActive(ApuAudioSlot slot, const ApuParameterRegisterWords& registerWords, ApuVoiceId voiceId) {
	setSlotPhase(slot, APU_SLOT_PHASE_PLAYING);
	const size_t base = apuSlotRegisterWordIndex(slot, 0u);
	for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		m_slotRegisterWords[base + index] = registerWords[index];
	}
	m_slotPlaybackCursorQ16[slot] = static_cast<int64_t>(registerWords[APU_PARAMETER_START_SAMPLE_INDEX]) * static_cast<int64_t>(APU_RATE_STEP_Q16_ONE);
	m_slotFadeSamplesRemaining[slot] = 0u;
	m_slotFadeSamplesTotal[slot] = 0u;
	m_slotVoiceIds[slot] = voiceId;
}

void AudioController::stopSlotActive(ApuAudioSlot slot) {
	setSlotPhase(slot, APU_SLOT_PHASE_IDLE);
	const size_t base = apuSlotRegisterWordIndex(slot, 0u);
	for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		m_slotRegisterWords[base + index] = 0u;
	}
	m_sourceDma.clearSlot(slot);
	m_slotPlaybackCursorQ16[slot] = 0;
	m_slotFadeSamplesRemaining[slot] = 0u;
	m_slotFadeSamplesTotal[slot] = 0u;
	m_slotVoiceIds[slot] = 0;
}

void AudioController::setSlotPhase(ApuAudioSlot slot, ApuSlotPhase phase) {
	m_slotPhases[slot] = phase;
	const uint32_t bit = 1u << slot;
	if (phase == APU_SLOT_PHASE_IDLE) {
		m_activeSlotMask &= ~bit;
	} else {
		m_activeSlotMask |= bit;
	}
	m_memory.writeIoValue(IO_APU_ACTIVE_MASK, valueNumber(static_cast<double>(m_activeSlotMask)));
	updateSelectedSlotActiveStatus();
}

void AudioController::replayHostOutput(ApuAudioSlot slot, ApuVoiceId voiceId) {
	const size_t base = apuSlotRegisterWordIndex(slot, 0u);
	for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		m_slotRegisterDispatchWords[index] = m_slotRegisterWords[base + index];
	}
	playOutputVoice(
		slot,
		voiceId,
		resolveApuAudioSource(m_slotRegisterDispatchWords),
		m_slotRegisterDispatchWords,
		m_slotFadeSamplesRemaining[slot]
	);
}

void AudioController::advanceActiveSlots(int64_t samples) {
	for (ApuAudioSlot slot = 0; slot < APU_SLOT_COUNT; slot += 1u) {
		const ApuSlotPhase phase = m_slotPhases[slot];
		if (phase == APU_SLOT_PHASE_IDLE) {
			continue;
		}
		const size_t base = apuSlotRegisterWordIndex(slot, 0u);
		const u32 sourceAddr = m_slotRegisterWords[base + APU_PARAMETER_SOURCE_ADDR_INDEX];
		const ApuVoiceId voiceId = m_slotVoiceIds[slot];
		const u32 fadeSamples = m_slotFadeSamplesRemaining[slot];
		if (phase == APU_SLOT_PHASE_FADING) {
			const int64_t cursorSamples = samples < static_cast<int64_t>(fadeSamples) ? samples : static_cast<int64_t>(fadeSamples);
			const bool endedByCursor = advanceSlotCursor(slot, cursorSamples);
			if (samples < static_cast<int64_t>(fadeSamples)) {
				m_slotFadeSamplesRemaining[slot] = static_cast<u32>(static_cast<int64_t>(fadeSamples) - samples);
				if (endedByCursor) {
					m_slotFadeSamplesRemaining[slot] = 0u;
					m_audioOutput.stopSlot(slot);
					emitSlotEvent(APU_EVENT_SLOT_ENDED, slot, voiceId, sourceAddr);
				}
				continue;
			}
			m_slotFadeSamplesRemaining[slot] = 0u;
			m_audioOutput.stopSlot(slot);
			emitSlotEvent(APU_EVENT_SLOT_ENDED, slot, voiceId, sourceAddr);
			continue;
		}
		if (advanceSlotCursor(slot, samples)) {
			m_audioOutput.stopSlot(slot);
			emitSlotEvent(APU_EVENT_SLOT_ENDED, slot, voiceId, sourceAddr);
		}
	}
}

bool AudioController::advanceSlotCursor(ApuAudioSlot slot, int64_t samples) {
	const size_t base = apuSlotRegisterWordIndex(slot, 0u);
	const int64_t rateStepQ16 = toSignedWord(m_slotRegisterWords[base + APU_PARAMETER_RATE_STEP_Q16_INDEX]);
	const uint32_t sourceSampleRateHz = m_slotRegisterWords[base + APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX];
	const int64_t loopStartQ16 = static_cast<int64_t>(m_slotRegisterWords[base + APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX]) * static_cast<int64_t>(APU_RATE_STEP_Q16_ONE);
	const int64_t loopEndQ16 = static_cast<int64_t>(m_slotRegisterWords[base + APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX]) * static_cast<int64_t>(APU_RATE_STEP_Q16_ONE);
	int64_t cursorQ16 = advanceApuPlaybackCursorQ16(m_slotPlaybackCursorQ16[slot], samples, rateStepQ16, sourceSampleRateHz);
	if (loopEndQ16 > loopStartQ16) {
		if (cursorQ16 >= loopEndQ16) {
			const int64_t loopLengthQ16 = loopEndQ16 - loopStartQ16;
			cursorQ16 = loopStartQ16 + ((cursorQ16 - loopStartQ16) % loopLengthQ16);
		}
		m_slotPlaybackCursorQ16[slot] = cursorQ16;
		return false;
	}
	m_slotPlaybackCursorQ16[slot] = cursorQ16;
	const int64_t frameEndQ16 = static_cast<int64_t>(m_slotRegisterWords[base + APU_PARAMETER_SOURCE_FRAME_COUNT_INDEX]) * static_cast<int64_t>(APU_RATE_STEP_Q16_ONE);
	return rateStepQ16 > 0 && cursorQ16 >= frameEndQ16;
}

void AudioController::scheduleNextService(int64_t nowCycles) {
	if (m_commandFifoCount > 0u) {
		m_scheduler.scheduleDeviceService(DeviceServiceApu, nowCycles);
		return;
	}
	if (m_activeSlotMask == 0u) {
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

void AudioController::updateSelectedSlotActiveStatus() {
	const uint32_t slot = m_memory.readIoU32(IO_APU_SLOT);
	const bool active = slot < APU_SLOT_COUNT && (m_activeSlotMask & (1u << slot)) != 0u;
	m_memory.writeIoValue(IO_APU_SELECTED_SOURCE_ADDR, valueNumber(active ? static_cast<double>(m_slotRegisterWords[apuSlotRegisterWordIndex(slot, APU_PARAMETER_SOURCE_ADDR_INDEX)]) : 0.0));
	m_fault.setStatusFlag(APU_STATUS_SELECTED_SLOT_ACTIVE, active);
}

Value AudioController::onStatusRead() const {
	uint32_t status = m_fault.status;
	if (m_activeSlotMask != 0u || m_commandFifoCount != 0u) {
		status |= APU_STATUS_BUSY;
	}
	if (m_commandFifoCount == 0u) {
		status |= APU_STATUS_CMD_FIFO_EMPTY;
	}
	if (m_commandFifoCount == APU_COMMAND_FIFO_CAPACITY) {
		status |= APU_STATUS_CMD_FIFO_FULL;
	}
	const size_t queuedFrames = m_audioOutput.queuedOutputFrames();
	if (queuedFrames == 0u) {
		status |= APU_STATUS_OUTPUT_EMPTY;
	}
	if (queuedFrames >= m_audioOutput.capacityOutputFrames()) {
		status |= APU_STATUS_OUTPUT_FULL;
	}
	return valueNumber(static_cast<double>(status));
}

Value AudioController::onSelectedSlotRegisterRead(uint32_t addr) const {
	const uint32_t slot = m_memory.readIoU32(IO_APU_SLOT);
	if (slot >= APU_SLOT_COUNT) {
		return valueNumber(0.0);
	}
	const size_t parameterIndex = static_cast<size_t>((addr - IO_APU_SELECTED_SLOT_REG0) / IO_WORD_SIZE);
	const size_t registerIndex = apuSlotRegisterWordIndex(slot, static_cast<uint32_t>(parameterIndex));
	return valueNumber(static_cast<double>(m_slotRegisterWords[registerIndex]));
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
	const size_t base = apuSlotRegisterWordIndex(slot, 0u);
	m_slotRegisterWords[base + parameterIndex] = word;
	if (parameterIndex == APU_PARAMETER_START_SAMPLE_INDEX) {
		m_slotPlaybackCursorQ16[slot] = static_cast<int64_t>(word) * static_cast<int64_t>(APU_RATE_STEP_Q16_ONE);
	}
	if ((m_activeSlotMask & (1u << slot)) != 0u) {
		for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
			m_slotRegisterDispatchWords[index] = m_slotRegisterWords[base + index];
			}
			const ApuAudioSource source = resolveApuAudioSource(m_slotRegisterDispatchWords);
			if (apuParameterProgramsSourceBuffer(parameterIndex)) {
				if (!replaceSlotSourceDma(slot, source)) {
					return;
				}
				const ApuVoiceId voiceId = m_nextVoiceId;
			m_nextVoiceId += 1u;
			const u32 fadeSamples = m_slotFadeSamplesRemaining[slot];
			m_slotVoiceIds[slot] = voiceId;
			if (!playOutputVoice(slot, voiceId, source, m_slotRegisterDispatchWords, fadeSamples)) {
				return;
			}
			scheduleNextService(m_scheduler.currentNowCycles());
		} else {
			const u32 fadeSamples = m_slotFadeSamplesRemaining[slot];
			const ApuParameterRegisterWords& outputRegisterWords = fadeSamples > 0u
				? fadeOutputRegisterWords(slot, m_slotRegisterDispatchWords)
				: m_slotRegisterDispatchWords;
			const ApuOutputStartResult outputWrite = m_audioOutput.writeSlotRegisterWord(
				slot,
				source,
				outputRegisterWords,
				parameterIndex,
				m_slotPlaybackCursorQ16[slot]
			);
			if (outputWrite.faultCode != APU_FAULT_NONE) {
				m_audioOutput.stopSlot(slot);
				stopSlotActive(slot);
				m_fault.raise(outputWrite.faultCode, outputWrite.faultDetail);
			}
		}
	}
	updateSelectedSlotActiveStatus();
}

} // namespace bmsx
