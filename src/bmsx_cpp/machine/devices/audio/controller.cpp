#include "machine/devices/audio/controller.h"

#include "audio/soundmaster.h"
#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"

#include <optional>
#include <stdexcept>

namespace bmsx {
namespace {

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

// disable-next-line single_line_method_pattern -- APU register resets write numeric MMIO values repeatedly; this keeps the value conversion local.
void writeNumber(Memory& memory, uint32_t addr, double value) {
	memory.writeValue(addr, valueNumber(value));
}

} // namespace

AudioController::AudioController(Memory& memory, SoundMaster& soundMaster, IrqController& irq)
	: m_memory(memory)
	, m_soundMaster(soundMaster)
	, m_irq(irq) {
	m_memory.mapIoWrite(IO_APU_CMD, this, &AudioController::onCommandWriteThunk);
	m_endedSubscription = ScopedSubscription(m_soundMaster.addEndedListener([this](const ActiveVoiceInfo& info) {
		onVoiceEnded(info);
	}));
}

void AudioController::reset() {
	m_eventSequence = 0;
	clearCommandLatch();
	writeNumber(m_memory, IO_APU_STATUS, 0.0);
	writeNumber(m_memory, IO_APU_EVENT_KIND, static_cast<double>(APU_EVENT_NONE));
	writeNumber(m_memory, IO_APU_EVENT_SLOT, 0.0);
	writeNumber(m_memory, IO_APU_EVENT_HANDLE, 0.0);
	writeNumber(m_memory, IO_APU_EVENT_SEQ, 0.0);
}

void AudioController::clearCommandLatch() {
	resetCommandLatch();
	m_memory.writeIoValue(IO_APU_CMD, valueNumber(static_cast<double>(APU_CMD_NONE)));
}

void AudioController::resetCommandLatch() {
	writeNumber(m_memory, IO_APU_HANDLE, 0.0);
	writeNumber(m_memory, IO_APU_SLOT, 0.0);
	writeNumber(m_memory, IO_APU_PRIORITY, static_cast<double>(APU_PRIORITY_AUTO));
	writeNumber(m_memory, IO_APU_RATE_STEP_Q16, static_cast<double>(APU_RATE_STEP_Q16_ONE));
	writeNumber(m_memory, IO_APU_GAIN_Q12, static_cast<double>(APU_GAIN_Q12_ONE));
	writeNumber(m_memory, IO_APU_START_SAMPLE, 0.0);
	writeNumber(m_memory, IO_APU_FILTER_KIND, static_cast<double>(APU_FILTER_NONE));
	writeNumber(m_memory, IO_APU_FILTER_FREQ_HZ, 0.0);
	writeNumber(m_memory, IO_APU_FILTER_Q_MILLI, 1000.0);
	writeNumber(m_memory, IO_APU_FILTER_GAIN_MILLIDB, 0.0);
	writeNumber(m_memory, IO_APU_FADE_SAMPLES, 0.0);
	writeNumber(m_memory, IO_APU_TARGET_GAIN_Q12, static_cast<double>(APU_GAIN_Q12_ONE));
}

void AudioController::onCommandWrite() {
	switch (m_memory.readIoU32(IO_APU_CMD)) {
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
		default:
			return;
	}
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk back into the APU device instance.
void AudioController::onCommandWriteThunk(void* context, uint32_t, Value) {
	static_cast<AudioController*>(context)->onCommandWrite();
}

const Memory::AssetEntry& AudioController::requireAudioEntry(uint32_t handle) const {
	const Memory::AssetEntry& entry = m_memory.getAssetEntryByHandle(handle);
	if (entry.type != Memory::AssetType::Audio) {
		throw std::runtime_error("[APU] asset handle " + std::to_string(handle) + " is not audio.");
	}
	return entry;
}

AudioSlot AudioController::readSlot() const {
	const AudioSlot slot = static_cast<AudioSlot>(m_memory.readIoU32(IO_APU_SLOT));
	if (slot >= APU_SLOT_COUNT) {
		throw std::runtime_error("[APU] slot " + std::to_string(slot) + " is outside 0.." + std::to_string(APU_SLOT_COUNT - 1) + ".");
	}
	return slot;
}

void AudioController::play() {
	const uint32_t handle = m_memory.readIoU32(IO_APU_HANDLE);
	const Memory::AssetEntry& entry = requireAudioEntry(handle);
	startPlay(entry.id, readSlot(), readResolvedPlayRequest());
}

void AudioController::startPlay(const std::string& id, AudioSlot slot, const SoundMasterResolvedPlayRequest& request) {
	if (!m_soundMaster.isRuntimeAudioReady()) {
		throw std::runtime_error("[APU] SoundMaster runtime audio is not initialized.");
	}
	if (!m_soundMaster.hasAudio(id)) {
		throw std::runtime_error("[APU] audio asset '" + id + "' is not loaded in SoundMaster.");
	}
	m_soundMaster.playResolved(slot, id, request);
}

void AudioController::stopSlot() {
	const AudioSlot slot = readSlot();
	const uint32_t fadeSamples = m_memory.readIoU32(IO_APU_FADE_SAMPLES);
	m_soundMaster.stopSlot(slot, fadeSamples > 0 ? std::optional<i32>(apuSamplesToMilliseconds(fadeSamples)) : std::nullopt);
}

void AudioController::rampSlot() {
	const AudioSlot slot = readSlot();
	const f32 targetGain = static_cast<f32>(m_memory.readIoI32(IO_APU_TARGET_GAIN_Q12)) / static_cast<f32>(APU_GAIN_Q12_ONE);
	const uint32_t fadeSamples = m_memory.readIoU32(IO_APU_FADE_SAMPLES);
	if (fadeSamples > 0) {
		m_soundMaster.rampSlotGainLinear(slot, targetGain, static_cast<f64>(fadeSamples) / static_cast<f64>(APU_SAMPLE_RATE_HZ));
		return;
	}
	m_soundMaster.setSlotGainLinear(slot, targetGain);
}

SoundMasterResolvedPlayRequest AudioController::readResolvedPlayRequest() const {
	SoundMasterResolvedPlayRequest request;
	const int32_t priority = m_memory.readIoI32(IO_APU_PRIORITY);
	const int32_t rateStepQ16 = m_memory.readIoI32(IO_APU_RATE_STEP_Q16);
	const int32_t gainQ12 = m_memory.readIoI32(IO_APU_GAIN_Q12);
	const uint32_t startSample = m_memory.readIoU32(IO_APU_START_SAMPLE);
	const uint32_t filterKind = m_memory.readIoU32(IO_APU_FILTER_KIND);
	request.playbackRate = static_cast<f32>(rateStepQ16) / static_cast<f32>(APU_RATE_STEP_Q16_ONE);
	request.gainLinear = static_cast<f32>(gainQ12) / static_cast<f32>(APU_GAIN_Q12_ONE);
	request.offsetSeconds = static_cast<f32>(startSample) / static_cast<f32>(APU_SAMPLE_RATE_HZ);
	if (priority != APU_PRIORITY_AUTO) {
		request.priority = priority;
	}
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

void AudioController::emitSlotEvent(uint32_t kind, AudioSlot slot, uint32_t handle) {
	m_eventSequence += 1u;
	writeNumber(m_memory, IO_APU_EVENT_KIND, static_cast<double>(kind));
	writeNumber(m_memory, IO_APU_EVENT_SLOT, static_cast<double>(slot));
	writeNumber(m_memory, IO_APU_EVENT_HANDLE, static_cast<double>(handle));
	writeNumber(m_memory, IO_APU_EVENT_SEQ, static_cast<double>(m_eventSequence));
	m_irq.raise(IRQ_APU);
}

void AudioController::onVoiceEnded(const ActiveVoiceInfo& info) {
	emitSlotEvent(APU_EVENT_SLOT_ENDED, info.slot, m_memory.resolveAssetHandle(info.id));
}

} // namespace bmsx
