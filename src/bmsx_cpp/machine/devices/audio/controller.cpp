#include "machine/devices/audio/controller.h"

#include "audio/soundmaster.h"
#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"

#include <stdexcept>

namespace bmsx {
namespace {

AudioType decodeChannel(uint32_t channel) {
	if (channel == APU_CHANNEL_MUSIC) {
		return AudioType::Music;
	}
	if (channel == APU_CHANNEL_UI) {
		return AudioType::Ui;
	}
	return AudioType::Sfx;
}

uint32_t encodeChannel(AudioType type) {
	switch (type) {
		case AudioType::Music:
			return APU_CHANNEL_MUSIC;
		case AudioType::Ui:
			return APU_CHANNEL_UI;
		case AudioType::Sfx:
		default:
			return APU_CHANNEL_SFX;
	}
}

size_t typeIndex(AudioType type) {
	switch (type) {
		case AudioType::Music:
			return 1;
		case AudioType::Ui:
			return 2;
		case AudioType::Sfx:
		default:
			return 0;
	}
}

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

void writeNumber(Memory& memory, uint32_t addr, double value) {
	memory.writeValue(addr, valueNumber(value));
}

} // namespace

	AudioController::AudioController(Memory& memory, SoundMaster& soundMaster, IrqController& irq)
		: m_memory(memory)
		, m_soundMaster(soundMaster)
		, m_irq(irq) {
		m_memory.mapIoWrite(IO_APU_CMD, this, &AudioController::onCommandWriteThunk);
		m_sfxEnded = ScopedSubscription(m_soundMaster.addEndedListener(AudioType::Sfx, [this](const ActiveVoiceInfo& info) {
		onVoiceEnded(AudioType::Sfx, info);
	}));
	m_musicEnded = ScopedSubscription(m_soundMaster.addEndedListener(AudioType::Music, [this](const ActiveVoiceInfo& info) {
		onVoiceEnded(AudioType::Music, info);
	}));
	m_uiEnded = ScopedSubscription(m_soundMaster.addEndedListener(AudioType::Ui, [this](const ActiveVoiceInfo& info) {
		onVoiceEnded(AudioType::Ui, info);
	}));
}

void AudioController::reset() {
	m_eventSequence = 0;
	m_activeHandleByType = {0, 0, 0};
	m_activeVoiceByType = {0, 0, 0};
	for (auto& queue : m_queuedByType) {
		queue.clear();
	}
	resetCommandLatch();
	m_memory.writeIoValue(IO_APU_CMD, valueNumber(static_cast<double>(APU_CMD_NONE)));
	writeNumber(m_memory, IO_APU_STATUS, 0.0);
	writeNumber(m_memory, IO_APU_EVENT_KIND, static_cast<double>(APU_EVENT_NONE));
	writeNumber(m_memory, IO_APU_EVENT_CHANNEL, static_cast<double>(APU_CHANNEL_SFX));
	writeNumber(m_memory, IO_APU_EVENT_HANDLE, 0.0);
	writeNumber(m_memory, IO_APU_EVENT_VOICE, 0.0);
	writeNumber(m_memory, IO_APU_EVENT_SEQ, 0.0);
}

void AudioController::resetCommandLatch() {
	writeNumber(m_memory, IO_APU_HANDLE, 0.0);
	writeNumber(m_memory, IO_APU_CHANNEL, static_cast<double>(APU_CHANNEL_SFX));
	writeNumber(m_memory, IO_APU_PRIORITY, static_cast<double>(APU_PRIORITY_AUTO));
	writeNumber(m_memory, IO_APU_PITCH_CENTS, 0.0);
	writeNumber(m_memory, IO_APU_VOLUME_MILLIDB, 0.0);
	writeNumber(m_memory, IO_APU_OFFSET_MS, 0.0);
	writeNumber(m_memory, IO_APU_RATE_PERMIL, 1000.0);
	writeNumber(m_memory, IO_APU_FILTER_KIND, static_cast<double>(APU_FILTER_NONE));
	writeNumber(m_memory, IO_APU_FILTER_FREQ_HZ, 0.0);
	writeNumber(m_memory, IO_APU_FILTER_Q_MILLI, 1000.0);
	writeNumber(m_memory, IO_APU_FILTER_GAIN_MILLIDB, 0.0);
	writeNumber(m_memory, IO_APU_FADE_MS, 0.0);
	writeNumber(m_memory, IO_APU_CROSSFADE_MS, 0.0);
	writeNumber(m_memory, IO_APU_SYNC_LOOP, 0.0);
	writeNumber(m_memory, IO_APU_START_AT_LOOP, 0.0);
	writeNumber(m_memory, IO_APU_START_FRESH, 0.0);
}

void AudioController::onCommandWrite() {
	switch (m_memory.readIoU32(IO_APU_CMD)) {
		case APU_CMD_PLAY:
			play();
			resetCommandLatch();
			m_memory.writeIoValue(IO_APU_CMD, valueNumber(static_cast<double>(APU_CMD_NONE)));
			return;
		case APU_CMD_QUEUE_PLAY:
			queuePlay();
			resetCommandLatch();
			m_memory.writeIoValue(IO_APU_CMD, valueNumber(static_cast<double>(APU_CMD_NONE)));
			return;
		case APU_CMD_STOP_CHANNEL:
			stopChannel();
			resetCommandLatch();
			m_memory.writeIoValue(IO_APU_CMD, valueNumber(static_cast<double>(APU_CMD_NONE)));
			return;
		default:
			return;
	}
}

void AudioController::onCommandWriteThunk(void* context, uint32_t, Value) {
	static_cast<AudioController*>(context)->onCommandWrite();
}

void AudioController::play() {
	const uint32_t handle = m_memory.readIoU32(IO_APU_HANDLE);
	const Memory::AssetEntry& entry = m_memory.getAssetEntryByHandle(handle);
	if (entry.type != Memory::AssetType::Audio) {
		throw std::runtime_error("[APU] asset handle " + std::to_string(handle) + " is not audio.");
	}
	const AudioType channel = decodeChannel(m_memory.readIoU32(IO_APU_CHANNEL));
	m_queuedByType[typeIndex(channel)].clear();
	startPlay(handle, entry.id, channel, readResolvedPlayRequest());
}

void AudioController::queuePlay() {
	const uint32_t handle = m_memory.readIoU32(IO_APU_HANDLE);
	const Memory::AssetEntry& entry = m_memory.getAssetEntryByHandle(handle);
	if (entry.type != Memory::AssetType::Audio) {
		throw std::runtime_error("[APU] asset handle " + std::to_string(handle) + " is not audio.");
	}
	const AudioType channel = decodeChannel(m_memory.readIoU32(IO_APU_CHANNEL));
	const SoundMasterResolvedPlayRequest request = readResolvedPlayRequest();
	const size_t idx = typeIndex(channel);
	if (m_activeHandleByType[idx] != 0u) {
		m_queuedByType[idx].push_back(QueuedAudioPlay{handle, entry.id, request});
		return;
	}
	startPlay(handle, entry.id, channel, request);
}

void AudioController::startPlay(uint32_t handle, const std::string& id, AudioType channel, const SoundMasterResolvedPlayRequest& request) {
	if (!m_soundMaster.isRuntimeAudioReady()) {
		throw std::runtime_error("[APU] SoundMaster runtime audio is not initialized.");
	}
	if (!m_soundMaster.hasAudio(id)) {
		throw std::runtime_error("[APU] audio asset '" + id + "' is not loaded in SoundMaster.");
	}
	const size_t idx = typeIndex(channel);
	m_activeHandleByType[idx] = handle;
	if (channel == AudioType::Music) {
		m_activeVoiceByType[idx] = 0;
		playMusic(id);
		return;
	}
	m_activeVoiceByType[idx] = m_soundMaster.playResolved(id, request);
}

void AudioController::playMusic(const std::string& id) {
	MusicTransitionRequest request;
	request.to = id;
	request.sync.kind = m_memory.readIoU32(IO_APU_SYNC_LOOP) != 0u
		? MusicTransitionSync::Kind::Loop
		: MusicTransitionSync::Kind::Immediate;
	const int32_t fadeMs = m_memory.readIoI32(IO_APU_FADE_MS);
	const int32_t crossfadeMs = m_memory.readIoI32(IO_APU_CROSSFADE_MS);
	request.fadeMs = fadeMs > 0 ? fadeMs : 0;
	if (crossfadeMs > 0) {
		request.crossfadeMs = crossfadeMs;
	}
	request.startAtLoopStart = m_memory.readIoU32(IO_APU_START_AT_LOOP) != 0u;
	request.startFresh = m_memory.readIoU32(IO_APU_START_FRESH) != 0u;
	m_soundMaster.requestMusicTransition(request);
}

void AudioController::stopChannel() {
	const AudioType channel = decodeChannel(m_memory.readIoU32(IO_APU_CHANNEL));
	const size_t idx = typeIndex(channel);
	m_activeHandleByType[idx] = 0;
	m_activeVoiceByType[idx] = 0;
	m_queuedByType[idx].clear();
	if (channel == AudioType::Music) {
		const int32_t fadeMs = m_memory.readIoI32(IO_APU_FADE_MS);
		m_soundMaster.stopMusic(fadeMs > 0 ? std::optional<i32>(fadeMs) : std::nullopt);
		return;
	}
	m_soundMaster.stop(channel, AudioStopSelector::All);
}

SoundMasterResolvedPlayRequest AudioController::readResolvedPlayRequest() const {
	SoundMasterResolvedPlayRequest request;
	const int32_t priority = m_memory.readIoI32(IO_APU_PRIORITY);
	const int32_t pitchCents = m_memory.readIoI32(IO_APU_PITCH_CENTS);
	const int32_t volumeMilliDb = m_memory.readIoI32(IO_APU_VOLUME_MILLIDB);
	const int32_t offsetMs = m_memory.readIoI32(IO_APU_OFFSET_MS);
	const int32_t ratePermil = m_memory.readIoI32(IO_APU_RATE_PERMIL);
	const uint32_t filterKind = m_memory.readIoU32(IO_APU_FILTER_KIND);
	request.pitchCents = pitchCents;
	request.volumeMilliDb = volumeMilliDb;
	request.offsetMs = offsetMs;
	request.ratePermil = ratePermil;
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

void AudioController::onVoiceEnded(AudioType type, const ActiveVoiceInfo& info) {
	const uint32_t handle = m_memory.resolveAssetHandle(info.id);
	const size_t idx = typeIndex(type);
	const VoiceId activeVoice = m_activeVoiceByType[idx];
	const bool activeEnded = activeVoice != 0
		? activeVoice == info.voiceId
		: m_activeHandleByType[idx] == handle;
	if (activeEnded) {
		auto& queue = m_queuedByType[idx];
		if (!queue.empty()) {
			const QueuedAudioPlay play = queue.front();
			queue.pop_front();
			startPlay(play.handle, play.id, type, play.request);
		} else {
			m_activeHandleByType[idx] = 0;
		}
	}
	m_eventSequence += 1u;
	writeNumber(m_memory, IO_APU_EVENT_KIND, static_cast<double>(APU_EVENT_VOICE_ENDED));
	writeNumber(m_memory, IO_APU_EVENT_CHANNEL, static_cast<double>(encodeChannel(type)));
	writeNumber(m_memory, IO_APU_EVENT_HANDLE, static_cast<double>(handle));
	writeNumber(m_memory, IO_APU_EVENT_VOICE, static_cast<double>(info.voiceId));
	writeNumber(m_memory, IO_APU_EVENT_SEQ, static_cast<double>(m_eventSequence));
	m_irq.raise(IRQ_APU);
}

} // namespace bmsx
