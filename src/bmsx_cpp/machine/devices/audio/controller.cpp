#include "machine/devices/audio/controller.h"

#include "audio/soundmaster.h"
#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"

#include <exception>
#include <optional>
#include <utility>
#include <vector>

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

const char* decodeFilterKind(uint32_t kind) {
	switch (kind) {
		case APU_FILTER_HIGHPASS:
			return "highpass";
		case APU_FILTER_BANDPASS:
			return "bandpass";
		case APU_FILTER_NOTCH:
			return "notch";
		case APU_FILTER_ALLPASS:
			return "allpass";
		case APU_FILTER_PEAKING:
			return "peaking";
		case APU_FILTER_LOWSHELF:
			return "lowshelf";
		case APU_FILTER_HIGHSHELF:
			return "highshelf";
		case APU_FILTER_LOWPASS:
		default:
			return "lowpass";
	}
}

int32_t apuSamplesToMilliseconds(uint32_t samples) {
	return static_cast<int32_t>((static_cast<uint64_t>(samples) * 1000ull) / APU_SAMPLE_RATE_HZ);
}

} // namespace

AudioController::AudioController(Memory& memory, SoundMaster& soundMaster, IrqController& irq)
	: m_memory(memory)
	, m_soundMaster(soundMaster)
	, m_irq(irq)
	, m_fault(memory, APU_DEVICE_STATUS_REGISTERS) {
	m_memory.mapIoWrite(IO_APU_CMD, this, &AudioController::onCommandWriteThunk);
	m_endedSubscription = ScopedSubscription(m_soundMaster.addEndedListener([this](const ActiveVoiceInfo& info) {
		emitSlotEvent(APU_EVENT_SLOT_ENDED, info.slot, info.sourceAddr);
	}));
	m_memory.mapIoWrite(IO_APU_FAULT_ACK, this, &AudioController::onFaultAckWriteThunk);
}

void AudioController::reset() {
	m_eventSequence = 0;
	m_fault.resetStatus();
	clearCommandLatch();
	m_memory.writeValue(IO_APU_EVENT_KIND, valueNumber(static_cast<double>(APU_EVENT_NONE)));
	m_memory.writeValue(IO_APU_EVENT_SLOT, valueNumber(0.0));
	m_memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, valueNumber(0.0));
	m_memory.writeValue(IO_APU_EVENT_SEQ, valueNumber(0.0));
}

AudioControllerState AudioController::captureState() const {
	AudioControllerState state;
	state.eventSequence = m_eventSequence;
	state.apuStatus = m_fault.status;
	state.apuFaultCode = m_fault.code;
	state.apuFaultDetail = m_fault.detail;
	return state;
}

void AudioController::restoreState(const AudioControllerState& state) {
	m_eventSequence = state.eventSequence;
	m_fault.restore(state.apuStatus, state.apuFaultCode, state.apuFaultDetail);
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
	m_memory.writeValue(IO_APU_TARGET_GAIN_Q12, valueNumber(static_cast<double>(APU_GAIN_Q12_ONE)));
}

void AudioController::onCommandWrite() {
	const uint32_t command = m_memory.readIoU32(IO_APU_CMD);
	switch (command) {
		case APU_CMD_PLAY:
			play();
			clearCommandLatch();
			return;
		case APU_CMD_STOP_SLOT:
			stopSlot();
			clearCommandLatch();
			return;
		case APU_CMD_RAMP_SLOT:
			rampSlot();
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

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk back into the APU device instance.
void AudioController::onCommandWriteThunk(void* context, uint32_t, Value) {
	static_cast<AudioController*>(context)->onCommandWrite();
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk back into the APU device instance.
void AudioController::onFaultAckWriteThunk(void* context, uint32_t, Value) {
	auto& controller = *static_cast<AudioController*>(context);
	controller.m_fault.acknowledge();
}

bool AudioController::readSlot(AudioSlot& slot) const {
	slot = static_cast<AudioSlot>(m_memory.readIoU32(IO_APU_SLOT));
	if (slot >= APU_SLOT_COUNT) {
		m_fault.raise(APU_FAULT_BAD_SLOT, slot);
		return false;
	}
	return true;
}

void AudioController::play() {
	SoundMasterAudioSource source;
	if (!readAudioSource(source)) {
		return;
	}
	AudioSlot slot = 0;
	if (!readSlot(slot)) {
		return;
	}
	startPlay(source, slot, readResolvedPlayRequest(source));
}

bool AudioController::readAudioSource(SoundMasterAudioSource& source) const {
	source.sourceAddr = m_memory.readIoU32(IO_APU_SOURCE_ADDR);
	source.sourceBytes = m_memory.readIoU32(IO_APU_SOURCE_BYTES);
	source.sampleRateHz = m_memory.readIoU32(IO_APU_SOURCE_SAMPLE_RATE_HZ);
	source.channels = m_memory.readIoU32(IO_APU_SOURCE_CHANNELS);
	source.bitsPerSample = m_memory.readIoU32(IO_APU_SOURCE_BITS_PER_SAMPLE);
	source.frameCount = m_memory.readIoU32(IO_APU_SOURCE_FRAME_COUNT);
	source.dataOffset = m_memory.readIoU32(IO_APU_SOURCE_DATA_OFFSET);
	source.dataBytes = m_memory.readIoU32(IO_APU_SOURCE_DATA_BYTES);
	source.loopStartSample = m_memory.readIoU32(IO_APU_SOURCE_LOOP_START_SAMPLE);
	source.loopEndSample = m_memory.readIoU32(IO_APU_SOURCE_LOOP_END_SAMPLE);
	if (source.sourceBytes == 0) {
		m_fault.raise(APU_FAULT_SOURCE_BYTES, source.sourceBytes);
		return false;
	}
	if (!m_memory.isReadableMainMemoryRange(source.sourceAddr, source.sourceBytes)) {
		m_fault.raise(APU_FAULT_SOURCE_RANGE, source.sourceAddr);
		return false;
	}
	if (source.sampleRateHz == 0) {
		m_fault.raise(APU_FAULT_SOURCE_SAMPLE_RATE, source.sampleRateHz);
		return false;
	}
	if (source.channels < 1 || source.channels > 2) {
		m_fault.raise(APU_FAULT_SOURCE_CHANNELS, source.channels);
		return false;
	}
	if (source.frameCount == 0) {
		m_fault.raise(APU_FAULT_SOURCE_FRAME_COUNT, source.frameCount);
		return false;
	}
	if (source.dataBytes == 0 || source.dataOffset + source.dataBytes > source.sourceBytes) {
		m_fault.raise(APU_FAULT_SOURCE_DATA_RANGE, source.dataOffset);
		return false;
	}
	if (source.bitsPerSample != 4 && source.bitsPerSample != 8 && source.bitsPerSample != 16) {
		m_fault.raise(APU_FAULT_SOURCE_BIT_DEPTH, source.bitsPerSample);
		return false;
	}
	return true;
}

void AudioController::startPlay(const SoundMasterAudioSource& source, AudioSlot slot, const SoundMasterResolvedPlayRequest& request) {
	if (!m_soundMaster.isRuntimeAudioReady()) {
		m_fault.raise(APU_FAULT_RUNTIME_UNAVAILABLE, source.sourceAddr);
		return;
	}
	std::vector<u8> bytes(source.sourceBytes);
	m_memory.readBytes(source.sourceAddr, bytes.data(), bytes.size());
	try {
		m_soundMaster.playResolved(slot, source, std::move(bytes), request);
	} catch (const std::exception&) {
		m_fault.raise(APU_FAULT_PLAYBACK_REJECTED, source.sourceAddr);
	}
}

void AudioController::stopSlot() {
	AudioSlot slot = 0;
	if (!readSlot(slot)) {
		return;
	}
	const uint32_t fadeSamples = m_memory.readIoU32(IO_APU_FADE_SAMPLES);
	m_soundMaster.stopSlot(slot, fadeSamples > 0 ? std::optional<i32>(apuSamplesToMilliseconds(fadeSamples)) : std::nullopt);
}

void AudioController::rampSlot() {
	AudioSlot slot = 0;
	if (!readSlot(slot)) {
		return;
	}
	const f32 targetGain = static_cast<f32>(m_memory.readIoI32(IO_APU_TARGET_GAIN_Q12)) / static_cast<f32>(APU_GAIN_Q12_ONE);
	const uint32_t fadeSamples = m_memory.readIoU32(IO_APU_FADE_SAMPLES);
	if (fadeSamples > 0) {
		m_soundMaster.rampSlotGainLinear(slot, targetGain, static_cast<f64>(fadeSamples) / static_cast<f64>(APU_SAMPLE_RATE_HZ));
		return;
	}
	m_soundMaster.setSlotGainLinear(slot, targetGain);
}

SoundMasterResolvedPlayRequest AudioController::readResolvedPlayRequest(const SoundMasterAudioSource& source) const {
	SoundMasterResolvedPlayRequest request;
	const int32_t rateStepQ16 = m_memory.readIoI32(IO_APU_RATE_STEP_Q16);
	const int32_t gainQ12 = m_memory.readIoI32(IO_APU_GAIN_Q12);
	const uint32_t startSample = m_memory.readIoU32(IO_APU_START_SAMPLE);
	const uint32_t filterKind = m_memory.readIoU32(IO_APU_FILTER_KIND);
	request.playbackRate = static_cast<f32>(rateStepQ16) / static_cast<f32>(APU_RATE_STEP_Q16_ONE);
	request.gainLinear = static_cast<f32>(gainQ12) / static_cast<f32>(APU_GAIN_Q12_ONE);
	request.offsetSeconds = static_cast<f32>(startSample) / static_cast<f32>(source.sampleRateHz);
	if (filterKind != APU_FILTER_NONE) {
		FilterModulationParams filter;
		filter.type = decodeFilterKind(filterKind);
		filter.frequency = static_cast<f32>(m_memory.readIoI32(IO_APU_FILTER_FREQ_HZ));
		filter.q = static_cast<f32>(m_memory.readIoI32(IO_APU_FILTER_Q_MILLI)) / 1000.0f;
		filter.gain = static_cast<f32>(m_memory.readIoI32(IO_APU_FILTER_GAIN_MILLIDB)) / 1000.0f;
		request.filter = filter;
	}
	return request;
}

void AudioController::emitSlotEvent(uint32_t kind, AudioSlot slot, uint32_t sourceAddr) {
	m_eventSequence += 1u;
	m_memory.writeValue(IO_APU_EVENT_KIND, valueNumber(static_cast<double>(kind)));
	m_memory.writeValue(IO_APU_EVENT_SLOT, valueNumber(static_cast<double>(slot)));
	m_memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, valueNumber(static_cast<double>(sourceAddr)));
	m_memory.writeValue(IO_APU_EVENT_SEQ, valueNumber(static_cast<double>(m_eventSequence)));
	m_irq.raise(IRQ_APU);
}

} // namespace bmsx
