/*
 * soundmaster.h - Audio playback and mixing (C++ counterpart to SoundMaster)
 */

#pragma once

#include "../rompack/runtime_assets.h"
#include "../core/registry.h"
#include "../subscription.h"
#include <array>
#include <functional>
#include <optional>
#include <random>
#include <utility>
#include <vector>

namespace bmsx {

using VoiceId = u64;

class Table;

struct ModulationRange {
	f32 min = 0.0f;
	f32 max = 0.0f;
};

struct FilterModulationParams {
	std::string type;
	f32 frequency = 0.0f;
	f32 q = 0.0f;
	f32 gain = 0.0f;
};

struct ModulationInput {
	std::optional<f32> pitchDelta;
	std::optional<f32> volumeDelta;
	std::optional<f32> offset;
	std::optional<f32> playbackRate;
	std::optional<ModulationRange> pitchRange;
	std::optional<ModulationRange> volumeRange;
	std::optional<ModulationRange> offsetRange;
	std::optional<ModulationRange> playbackRateRange;
	std::optional<FilterModulationParams> filter;
};

struct ModulationParams {
	f32 pitchDelta = 0.0f;
	f32 volumeDelta = 0.0f;
	f32 offset = 0.0f;
	f32 playbackRate = 1.0f;
	std::optional<FilterModulationParams> filter;
};

struct SoundMasterPlayRequest {
	std::optional<ModulationInput> params;
	std::optional<AssetId> modulationPreset;
	std::optional<i32> priority;
};

struct ActiveVoiceInfo {
	VoiceId voiceId = 0;
	AssetId id;
	i32 priority = 0;
	ModulationParams params;
	f64 startedAt = 0.0;
	f64 startOffset = 0.0;
	AudioMeta meta;
};

struct PausedSnapshot {
	AssetId id;
	f64 offset = 0.0;
	ModulationParams params;
	i32 priority = 0;
};

enum class AudioStopSelector {
	All,
	Oldest,
	Newest,
	ById,
	ByVoice,
};

enum class AudioPlaybackMode {
	Replace,
	Ignore,
	Queue,
	Stop,
	Pause,
};

struct MusicTransitionSync {
	enum class Kind { Immediate, Loop, Delay, Stinger } kind = Kind::Immediate;
	i32 delayMs = 0;
	AssetId stinger;
	std::optional<AssetId> returnTo;
	bool returnToPrevious = false;
};

struct MusicTransitionRequest {
	AssetId to;
	MusicTransitionSync sync;
	i32 fadeMs = 0;
	std::optional<i32> crossfadeMs;
	bool startAtLoopStart = false;
	bool startFresh = false;
};

struct AudioDataView {
	const u8* data = nullptr;
	size_t frames = 0;
};

using AudioDataResolver = std::function<AudioDataView(const AssetId& id)>;

class SoundMaster final : public Registerable {
public:
	SoundMaster();
	~SoundMaster() override;

	const Identifier& registryId() const override;
	bool isRegistryPersistent() const override { return true; }

	void init(const RuntimeAssets& assets, f32 startingVolume, AudioDataResolver audioResolver);
	void setMaxVoicesByType(std::optional<int> sfx, std::optional<int> music, std::optional<int> ui);
	void resetPlaybackState();
	void dispose();

	VoiceId play(const AssetId& id, const SoundMasterPlayRequest& request = {});
	void playWithPolicy(AudioType type, const AssetId& id, const SoundMasterPlayRequest& request = {}, std::optional<AudioPlaybackMode> policy = std::nullopt, std::optional<int> maxVoices = std::nullopt);
	void stop(AudioType type, AudioStopSelector which, VoiceId voiceId = 0, const AssetId& id = {});
	void stopEffect();
	void stopMusic(std::optional<i32> fadeMs = std::nullopt);
	void stopUI();

	void pause(AudioType type);
	void pauseAll();
	void resume();
	void resumeType(AudioType type);

	f32 masterVolume() const { return m_masterVolume; }
	void setMasterVolume(f32 value);

	size_t activeCountByType(AudioType type) const;
	std::vector<ActiveVoiceInfo> getActiveVoiceInfosByType(AudioType type) const;
	std::optional<ModulationParams> currentModulationParamsByType(AudioType type) const;
	std::optional<f64> currentTimeByType(AudioType type) const;
	AssetId currentTrackByType(AudioType type) const;
	const AudioMeta* currentTrackMetaByType(AudioType type) const;

	std::vector<PausedSnapshot> snapshotVoices(AudioType type) const;
	std::vector<PausedSnapshot> drainPausedSnapshots(AudioType type);

	SubscriptionHandle addEndedListener(AudioType type, std::function<void(const ActiveVoiceInfo&)> listener);

	void requestMusicTransition(const MusicTransitionRequest& request);

	void renderSamples(i16* output, size_t frameCount, i32 outputSampleRate);

	f64 currentTimeSec() const { return m_audioTimeSec; }

private:
	struct BadpDecoderState {
		i32 predictors[2] = {0, 0};
		i32 stepIndices[2] = {0, 0};
		size_t nextFrame = 0;
		size_t blockEnd = 0;
		size_t blockFrames = 0;
		size_t blockFrameIndex = 0;
		size_t payloadOffset = 0;
		size_t nibbleCursor = 0;
		i64 decodedFrame = -1;
		i16 decodedLeft = 0;
		i16 decodedRight = 0;
	};

	struct VoiceRecord {
		VoiceId voiceId = 0;
		AssetId id;
		const AudioAsset* asset = nullptr;
		const u8* data = nullptr;
		size_t frames = 0;
		AudioMeta meta;
		AudioType type = AudioType::Sfx;
		i32 priority = 0;
		ModulationParams params;
		f64 startedAt = 0.0;
		f64 startOffset = 0.0;
		f64 position = 0.0;
		f64 step = 0.0;
		f32 gain = 1.0f;
		f32 targetGain = 1.0f;
		f64 gainRampRemaining = 0.0;
		f64 stopAfter = -1.0;
		bool finalized = false;
		bool usesBadp = false;
		BadpDecoderState badp;
	};

	struct PendingTransition {
		MusicTransitionRequest request;
		f64 remainingSec = 0.0;
		std::optional<f64> startAtSeconds;
	};

	struct AudioQueueItem {
		AssetId id;
		SoundMasterPlayRequest request;
		int maxVoices = 1;
	};

	ModulationParams resolvePlayParams(const ModulationInput& input);
	std::optional<ModulationInput> resolveModulationPreset(const AssetId& key) const;
	ModulationInput parseModulationInput(const BinValue& value) const;
	ModulationInput parseModulationInput(const Table& table) const;

	const AudioAsset& getAudioOrThrow(const AssetId& id) const;
	AudioDataView resolveAudioData(const AssetId& id) const;

	VoiceId startVoice(AudioType type, const AssetId& id, const AudioAsset& asset, const ModulationParams& params, i32 priority, f32 initialGain);
	void removeVoice(AudioType type, size_t index);
	void finalizeVoiceEnd(AudioType type, const VoiceRecord& record);
	void stopVoice(AudioType type, size_t index);
	int selectVoiceDropIndex(const std::vector<VoiceRecord>& pool) const;

	void startMusicNow(const AssetId& target, bool startAtLoopStart, std::optional<f64> startAtSeconds);
	void startMusicWithCrossfade(const AssetId& target, f64 crossfadeSec, bool startAtLoopStart, std::optional<f64> startAtSeconds);
	void startMusicAfterFadeOut(const AssetId& target, f64 fadeSec, bool startAtLoopStart, std::optional<f64> startAtSeconds);
	void startMusicTransition(const AssetId& target, i32 fadeMs, std::optional<i32> crossfadeMs, bool startAtLoopStart, std::optional<f64> startAtSeconds);
	void enqueueTransition(const MusicTransitionRequest& request, f64 delaySec, std::optional<f64> startAtSeconds);
	void processPendingTransitions(f64 dt);
	void rampVoiceGain(VoiceRecord& record, f32 target, f64 durationSec);
	void onAudioChannelEnded(AudioType type);
	void badpLoadBlock(VoiceRecord& record, size_t offset);
	void badpSeekToFrame(VoiceRecord& record, size_t frame);
	void badpResetDecoder(VoiceRecord& record, size_t frame);
	void badpDecodeNextFrame(VoiceRecord& record);
	bool badpReadFrameAt(VoiceRecord& record, size_t frame, i16& outLeft, i16& outRight);

	f32 clampVolume(f32 value) const;
	f64 effectivePlaybackRate(const ModulationParams& params) const;

	static size_t typeIndex(AudioType type);

	const RuntimeAssets* m_assets = nullptr;
	AudioDataResolver m_audioResolver;
	f32 m_masterVolume = 1.0f;
	f64 m_audioTimeSec = 0.0;

	std::array<std::vector<VoiceRecord>, 3> m_voicesByType;
	std::array<std::vector<PausedSnapshot>, 3> m_pausedByType;
	std::array<std::vector<AudioQueueItem>, 3> m_audioQueueByType;
	std::array<bool, 3> m_resumeOnNextEndByType{};
	std::array<VoiceId, 3> m_currentVoiceIdByType{};
	std::array<AssetId, 3> m_currentAudioIdByType{};
	std::array<ModulationParams, 3> m_currentParamsByType{};

	std::array<std::vector<std::pair<u32, std::function<void(const ActiveVoiceInfo&)>>>, 3> m_endedListenersByType;

	std::mt19937 m_rng;
	mutable std::uniform_real_distribution<f32> m_unitDist;

	void cancelActiveMusicTransition();

	std::optional<PendingTransition> m_pendingTransition;
	std::optional<AssetId> m_pendingStingerReturnTo;
	std::optional<f64> m_pendingStingerReturnOffset;
	std::optional<SubscriptionHandle> m_pendingStingerEndListener;
	std::optional<AudioType> m_pendingStingerVoiceType;
	VoiceId m_pendingStingerVoiceId = 0;
	u64 m_musicTransitionRequestId = 0;

	std::array<size_t, 3> m_maxVoicesByType;
	std::vector<f32> m_mixBuffer;
	VoiceId m_nextVoiceId = 1;
	u32 m_nextListenerId = 1;
};

} // namespace bmsx
