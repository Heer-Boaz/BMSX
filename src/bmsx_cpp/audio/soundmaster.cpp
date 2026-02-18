/*
 * soundmaster.cpp - Audio playback and mixing
 */

#include "soundmaster.h"
#include "../core/engine_core.h"
#include "../emulator/cpu.h"
#include "../emulator/runtime.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <memory>
#include <stdexcept>

namespace bmsx {

static constexpr f32 MIN_GAIN = 0.0001f;
static constexpr i32 BADP_STEP_TABLE[89] = {
	7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
	19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
	50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
	130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
	337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
	876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
	2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
	5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
	15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
};
static constexpr i32 BADP_INDEX_TABLE[16] = {
	-1, -1, -1, -1, 2, 4, 6, 8,
	-1, -1, -1, -1, 2, 4, 6, 8,
};

static inline u16 readLE16Audio(const u8* data) {
	return static_cast<u16>(data[0]) | (static_cast<u16>(data[1]) << 8);
}

SoundMaster::SoundMaster()
	: m_rng(std::random_device{}()),
		m_unitDist(0.0f, 1.0f) {
	m_maxVoicesByType = {16, 1, 8};
	resetPlaybackState();
}

SoundMaster::~SoundMaster() {
	dispose();
}

const Identifier& SoundMaster::registryId() const {
	static const Identifier id = "sm";
	return id;
}

void SoundMaster::init(const RuntimeAssets& assets, f32 startingVolume, AudioDataResolver audioResolver) {
	m_assets = &assets;
	m_audioResolver = std::move(audioResolver);
	setMasterVolume(startingVolume);
	resetPlaybackState();
}

void SoundMaster::setMaxVoicesByType(std::optional<int> sfx, std::optional<int> music, std::optional<int> ui) {
	auto applyLimit = [this](AudioType type, int value) {
		if (value < 1) {
			throw std::runtime_error("[SoundMaster] max voices must be at least 1.");
		}
		const size_t idx = typeIndex(type);
		const size_t limit = static_cast<size_t>(value);
		m_maxVoicesByType[idx] = limit;
		auto& pool = m_voicesByType[idx];
		while (pool.size() > limit) {
			removeVoice(type, 0);
		}
	};
	if (sfx) applyLimit(AudioType::Sfx, *sfx);
	if (music) applyLimit(AudioType::Music, *music);
	if (ui) applyLimit(AudioType::Ui, *ui);
}

void SoundMaster::resetPlaybackState() {
	for (auto& pool : m_voicesByType) pool.clear();
	for (auto& pool : m_pausedByType) pool.clear();
	for (auto& list : m_endedListenersByType) list.clear();
	m_currentVoiceIdByType = {0, 0, 0};
	m_currentAudioIdByType = {"", "", ""};
	m_currentParamsByType = {ModulationParams{}, ModulationParams{}, ModulationParams{}};
	cancelActiveMusicTransition();
	m_pendingStingerVoiceType.reset();
	m_pendingStingerVoiceId = 0;
	m_audioTimeSec = 0.0;
	m_nextVoiceId = 1;
}

void SoundMaster::dispose() {
	resetPlaybackState();
	m_assets = nullptr;
	m_audioResolver = {};
}

VoiceId SoundMaster::play(const AssetId& id, const SoundMasterPlayRequest& request) {
	const AudioAsset& asset = getAudioOrThrow(id);
	ModulationInput input;
	if (request.params.has_value()) {
		input = request.params.value();
	} else if (request.modulationPreset.has_value()) {
		auto preset = resolveModulationPreset(request.modulationPreset.value());
		if (preset.has_value()) {
			input = preset.value();
		}
	}
	const ModulationParams params = resolvePlayParams(input);
	const i32 priority = request.priority.has_value() ? request.priority.value() : asset.meta.priority;
	const f32 initialGain = clampVolume(std::pow(10.0f, params.volumeDelta / 20.0f));
	return startVoice(asset.meta.type, id, asset, params, priority, initialGain);
}

void SoundMaster::stop(AudioType type, AudioStopSelector which, VoiceId voiceId, const AssetId& id) {
	const size_t idx = typeIndex(type);
	auto& pool = m_voicesByType[idx];
	if (pool.empty()) return;

	switch (which) {
		case AudioStopSelector::All: {
			while (!pool.empty()) {
				removeVoice(type, pool.size() - 1);
			}
			break;
		}
		case AudioStopSelector::Oldest: {
			removeVoice(type, 0);
			break;
		}
		case AudioStopSelector::Newest: {
			removeVoice(type, pool.size() - 1);
			break;
		}
		case AudioStopSelector::ById: {
			for (size_t i = pool.size(); i-- > 0;) {
				if (pool[i].id == id) {
					removeVoice(type, i);
				}
			}
			break;
		}
		case AudioStopSelector::ByVoice: {
			for (size_t i = 0; i < pool.size(); ++i) {
				if (pool[i].voiceId == voiceId) {
					removeVoice(type, i);
					break;
				}
			}
			break;
		}
	}
}

void SoundMaster::stopEffect() {
	stop(AudioType::Sfx, AudioStopSelector::All);
}

void SoundMaster::stopMusic() {
	stop(AudioType::Music, AudioStopSelector::All);
}

void SoundMaster::stopUI() {
	stop(AudioType::Ui, AudioStopSelector::All);
}

void SoundMaster::pause(AudioType type) {
	const size_t idx = typeIndex(type);
	auto& pool = m_voicesByType[idx];
	auto& paused = m_pausedByType[idx];
	for (const auto& record : pool) {
		const f64 offset = record.position / static_cast<f64>(record.asset->sampleRate);
		paused.push_back(PausedSnapshot{record.id, offset, record.params, record.priority});
	}
	pool.clear();
	m_currentVoiceIdByType[idx] = 0;
	m_currentAudioIdByType[idx].clear();
	m_currentParamsByType[idx] = ModulationParams{};
}

void SoundMaster::pauseAll() {
	pause(AudioType::Sfx);
	pause(AudioType::Music);
	pause(AudioType::Ui);
}

void SoundMaster::resume() {
	resumeType(AudioType::Sfx);
	resumeType(AudioType::Music);
	resumeType(AudioType::Ui);
}

void SoundMaster::resumeType(AudioType type) {
	auto snapshots = drainPausedSnapshots(type);
	for (const auto& snapshot : snapshots) {
		ModulationParams params = snapshot.params;
		params.offset = static_cast<f32>(snapshot.offset);
		const AudioAsset& asset = getAudioOrThrow(snapshot.id);
		const f32 initialGain = clampVolume(std::pow(10.0f, params.volumeDelta / 20.0f));
		startVoice(asset.meta.type, snapshot.id, asset, params, snapshot.priority, initialGain);
	}
}

void SoundMaster::setMasterVolume(f32 value) {
	m_masterVolume = clampVolume(value);
}

size_t SoundMaster::activeCountByType(AudioType type) const {
	return m_voicesByType[typeIndex(type)].size();
}

std::vector<ActiveVoiceInfo> SoundMaster::getActiveVoiceInfosByType(AudioType type) const {
	const auto& pool = m_voicesByType[typeIndex(type)];
	std::vector<ActiveVoiceInfo> result;
	result.reserve(pool.size());
	for (const auto& record : pool) {
		result.push_back(ActiveVoiceInfo{
			record.voiceId,
			record.id,
			record.priority,
			record.params,
			record.startedAt,
			record.startOffset,
			record.meta,
		});
	}
	return result;
}

std::optional<ModulationParams> SoundMaster::currentModulationParamsByType(AudioType type) const {
	const size_t idx = typeIndex(type);
	if (m_currentVoiceIdByType[idx] == 0) return std::nullopt;
	return m_currentParamsByType[idx];
}

std::optional<f64> SoundMaster::currentTimeByType(AudioType type) const {
	const size_t idx = typeIndex(type);
	const VoiceId currentId = m_currentVoiceIdByType[idx];
	if (currentId == 0) return std::nullopt;
	const auto& pool = m_voicesByType[idx];
	for (const auto& record : pool) {
		if (record.voiceId == currentId) {
			return record.position / static_cast<f64>(record.asset->sampleRate);
		}
	}
	return std::nullopt;
}

AssetId SoundMaster::currentTrackByType(AudioType type) const {
	const size_t idx = typeIndex(type);
	return m_currentVoiceIdByType[idx] == 0 ? AssetId{} : m_currentAudioIdByType[idx];
}

const AudioMeta* SoundMaster::currentTrackMetaByType(AudioType type) const {
	const size_t idx = typeIndex(type);
	if (m_currentVoiceIdByType[idx] == 0) return nullptr;
	const auto& pool = m_voicesByType[idx];
	for (const auto& record : pool) {
		if (record.voiceId == m_currentVoiceIdByType[idx]) {
			return &record.meta;
		}
	}
	return nullptr;
}

std::vector<PausedSnapshot> SoundMaster::snapshotVoices(AudioType type) const {
	const auto& pool = m_voicesByType[typeIndex(type)];
	std::vector<PausedSnapshot> snapshots;
	snapshots.reserve(pool.size());
	for (const auto& record : pool) {
		const f64 offset = record.position / static_cast<f64>(record.asset->sampleRate);
		snapshots.push_back(PausedSnapshot{record.id, offset, record.params, record.priority});
	}
	return snapshots;
}

std::vector<PausedSnapshot> SoundMaster::drainPausedSnapshots(AudioType type) {
	const size_t idx = typeIndex(type);
	auto snapshots = m_pausedByType[idx];
	m_pausedByType[idx].clear();
	return snapshots;
}

SubscriptionHandle SoundMaster::addEndedListener(AudioType type, std::function<void(const ActiveVoiceInfo&)> listener) {
	const size_t idx = typeIndex(type);
	const u32 id = m_nextListenerId++;
	m_endedListenersByType[idx].push_back({id, std::move(listener)});
	return SubscriptionHandle::create([this, idx, id]() {
		auto& listeners = m_endedListenersByType[idx];
		for (size_t i = 0; i < listeners.size(); ++i) {
			if (listeners[i].first == id) {
				listeners.erase(listeners.begin() + static_cast<std::ptrdiff_t>(i));
				break;
			}
		}
	});
}

void SoundMaster::cancelActiveMusicTransition() {
	++m_musicTransitionRequestId;
	m_pendingTransition.reset();
	m_pendingStingerReturnTo.reset();
	m_pendingStingerReturnOffset.reset();
	if (m_pendingStingerVoiceType.has_value() && m_pendingStingerVoiceId != 0) {
		stop(m_pendingStingerVoiceType.value(), AudioStopSelector::ByVoice, m_pendingStingerVoiceId);
	}
	if (m_pendingStingerEndListener.has_value()) {
		m_pendingStingerEndListener->unsubscribe();
		m_pendingStingerEndListener.reset();
	}
	m_pendingStingerVoiceType.reset();
	m_pendingStingerVoiceId = 0;
}

void SoundMaster::requestMusicTransition(const MusicTransitionRequest& request) {
	MusicTransitionRequest resolved = request;
	if (resolved.fadeMs < 0) resolved.fadeMs = 0;
	cancelActiveMusicTransition();

	if (resolved.sync.kind != MusicTransitionSync::Kind::Stinger && !resolved.startFresh) {
		if (currentTrackByType(AudioType::Music) == resolved.to) {
			return;
		}
	}

	if (resolved.sync.kind == MusicTransitionSync::Kind::Stinger) {
		const AudioAsset& stingerAsset = getAudioOrThrow(resolved.sync.stinger);
		const AudioType stingerType = stingerAsset.meta.type;
		const AssetId previousId = currentTrackByType(AudioType::Music);
		const std::optional<f64> previousOffset = currentTimeByType(AudioType::Music);
		const bool returnToPrevious = resolved.sync.returnToPrevious;
		const AssetId returnTarget = resolved.sync.returnTo.has_value() ? resolved.sync.returnTo.value() : resolved.to;
		const bool hasPrevious = !previousId.empty();
		m_pendingStingerReturnTo = returnToPrevious ? (hasPrevious ? previousId : returnTarget) : returnTarget;
		m_pendingStingerReturnOffset = returnToPrevious ? (previousOffset.has_value() ? previousOffset : std::optional<f64>{0.0}) : std::optional<f64>{};
		stopMusic();

	const VoiceId stingerVoice = play(resolved.sync.stinger);
	if (stingerVoice == 0) {
		m_pendingStingerVoiceType.reset();
		m_pendingStingerVoiceId = 0;
		m_pendingStingerReturnTo.reset();
		m_pendingStingerReturnOffset.reset();
		return;
	}
	m_pendingStingerVoiceType = stingerType;
	m_pendingStingerVoiceId = stingerVoice;
	const u64 transitionId = m_musicTransitionRequestId;
	auto unsub = std::make_shared<SubscriptionHandle>();
	*unsub = addEndedListener(stingerType, [this, stingerVoice, resolved, transitionId, unsub](const ActiveVoiceInfo& info) {
		if (info.voiceId != stingerVoice) return;
		unsub->unsubscribe();
		if (transitionId != m_musicTransitionRequestId) return;
		m_pendingStingerEndListener.reset();
		m_pendingStingerVoiceType.reset();
		m_pendingStingerVoiceId = 0;
		if (!m_pendingStingerReturnTo.has_value()) return;
			const auto target = m_pendingStingerReturnTo;
			const auto offset = m_pendingStingerReturnOffset;
			m_pendingStingerReturnTo.reset();
			m_pendingStingerReturnOffset.reset();
			if (target.has_value()) {
				startMusicWithFade(target.value(), resolved.fadeMs / 1000.0, resolved.startAtLoopStart, offset);
			}
		});
		m_pendingStingerEndListener = *unsub;
		return;
	}

	if (resolved.sync.kind == MusicTransitionSync::Kind::Immediate) {
		startMusicWithFade(resolved.to, resolved.fadeMs / 1000.0, resolved.startAtLoopStart, resolved.startFresh ? 0.0 : std::optional<f64>{});
		return;
	}

	if (resolved.sync.kind == MusicTransitionSync::Kind::Delay) {
		const f64 delaySec = std::max(0, resolved.sync.delayMs) / 1000.0;
		enqueueTransition(resolved, delaySec, resolved.startFresh ? 0.0 : std::optional<f64>{});
		return;
	}

	const auto currentRecord = currentTrackMetaByType(AudioType::Music);
	const std::optional<f64> currentOffset = currentTimeByType(AudioType::Music);
	if (!currentRecord || !currentOffset.has_value()) {
		startMusicWithFade(resolved.to, resolved.fadeMs / 1000.0, resolved.startAtLoopStart, resolved.startFresh ? 0.0 : std::optional<f64>{});
		return;
	}

	const AudioAsset& currentAsset = getAudioOrThrow(currentTrackByType(AudioType::Music));
	const f64 duration = static_cast<f64>(currentAsset.frames) / currentAsset.sampleRate;
	if (duration <= 0.0) {
		startMusicWithFade(resolved.to, resolved.fadeMs / 1000.0, resolved.startAtLoopStart, resolved.startFresh ? 0.0 : std::optional<f64>{});
		return;
	}
	f64 offsetMod = std::fmod(currentOffset.value(), duration);
	if (offsetMod < 0.0) offsetMod += duration;
	f64 boundary = duration;
	if (currentRecord->loopStart.has_value()) {
		const f64 loopStart = currentRecord->loopStart.value();
		boundary = offsetMod < loopStart ? loopStart : duration;
	}
	const f64 delaySec = std::max(0.0, boundary - offsetMod);
	enqueueTransition(resolved, delaySec, resolved.startFresh ? 0.0 : std::optional<f64>{});
}

void SoundMaster::renderSamples(i16* output, size_t frameCount, i32 outputSampleRate) {
	const size_t totalSamples = frameCount * 2;
	if (m_mixBuffer.size() < totalSamples) {
		m_mixBuffer.resize(totalSamples);
	}
	std::fill(m_mixBuffer.begin(), m_mixBuffer.begin() + totalSamples, 0.0f);

	// const auto mixStart = std::chrono::steady_clock::now();
	const f64 invOutputRate = 1.0 / static_cast<f64>(outputSampleRate);
	const f64 dt = static_cast<f64>(frameCount) * invOutputRate;
	processPendingTransitions(dt);

	const f32 sampleScale = 1.0f / 32768.0f;
	f32* mix = m_mixBuffer.data();

	for (size_t typeIdx = 0; typeIdx < m_voicesByType.size(); ++typeIdx) {
		auto& pool = m_voicesByType[typeIdx];
		for (size_t i = 0; i < pool.size();) {
			VoiceRecord& record = pool[i];
			const AudioAsset& asset = *record.asset;
			const u8* data = record.data;
			const int channels = asset.channels;
			const size_t framesInAsset = record.frames;
			if (framesInAsset == 0) {
				removeVoice(static_cast<AudioType>(typeIdx), i);
				continue;
			}
			const bool is16Bit = asset.bitsPerSample == 16;
			const i16* samples16 = is16Bit ? reinterpret_cast<const i16*>(data) : nullptr;
			const u8* samples8 = data;
			const auto readSample = [&](size_t sampleIndex) -> i16 {
				if (is16Bit) {
					return samples16[sampleIndex];
				}
				return static_cast<i16>(static_cast<int>(samples8[sampleIndex]) - 128) << 8;
			};

			const f64 loopStart = record.meta.loopStart.has_value() ? record.meta.loopStart.value() * asset.sampleRate : 0.0;
			const f64 loopEnd = record.meta.loopEnd.has_value() ? record.meta.loopEnd.value() * asset.sampleRate : static_cast<f64>(framesInAsset);
			const bool hasLoop = record.meta.loopStart.has_value() && loopEnd > loopStart;
			const f64 loopLen = loopEnd - loopStart;

			const f64 step = record.step * (static_cast<f64>(asset.sampleRate) * invOutputRate);

			f64 position = record.position;
			f32 gain = record.gain;
			const f32 target = record.targetGain;
			f64 rampRemaining = record.gainRampRemaining;
			f64 stopAfter = record.stopAfter;
			f64 gainStep = 0.0;
			if (rampRemaining > 0.0) {
				const f64 rampFrames = rampRemaining * static_cast<f64>(outputSampleRate);
				gainStep = (target - gain) / rampFrames;
			}

			bool ended = false;
			if (record.usesBadp) {
				const f64 framesInAssetF = static_cast<f64>(framesInAsset);
				size_t outIndex = 0;
				for (size_t frame = 0; frame < frameCount; ++frame) {
					if (stopAfter >= 0.0) {
						stopAfter -= invOutputRate;
						if (stopAfter <= 0.0) {
							ended = true;
							break;
						}
					}
					if (hasLoop) {
						if (position < loopStart || position >= loopEnd) {
							position = loopStart + std::fmod(position - loopStart, loopLen);
							if (position < loopStart) {
								position += loopLen;
							}
						}
					} else if (position >= framesInAssetF) {
						ended = true;
						break;
					}

					const i64 idx = static_cast<i64>(position);
					const f64 frac = position - static_cast<f64>(idx);
					const size_t idx0 = static_cast<size_t>(idx);
					size_t idx1 = idx0 + 1;
					if (hasLoop) {
						if (static_cast<f64>(idx1) >= loopEnd) {
							const f64 wrapped = loopStart + (static_cast<f64>(idx1) - loopEnd);
							idx1 = static_cast<size_t>(static_cast<i64>(wrapped));
						}
					} else if (idx1 >= framesInAsset) {
						idx1 = idx0;
					}

					i16 left0i = 0;
					i16 right0i = 0;
					if (!badpReadFrameAt(record, idx0, left0i, right0i)) {
						ended = true;
						break;
					}
					i16 left1i = left0i;
					i16 right1i = right0i;
					if (idx1 != idx0 && !badpReadFrameAt(record, idx1, left1i, right1i)) {
						ended = true;
						break;
					}

					const f32 left0 = static_cast<f32>(left0i) * sampleScale;
					const f32 right0 = static_cast<f32>(right0i) * sampleScale;
					const f32 left1 = static_cast<f32>(left1i) * sampleScale;
					const f32 right1 = static_cast<f32>(right1i) * sampleScale;
					const f32 left = left0 + (left1 - left0) * static_cast<f32>(frac);
					const f32 right = right0 + (right1 - right0) * static_cast<f32>(frac);
					mix[outIndex] += left * gain;
					mix[outIndex + 1] += right * gain;
					outIndex += 2;

					position += step;
					if (hasLoop && position >= loopEnd) {
						position = loopStart + std::fmod(position - loopStart, loopLen);
					}
					if (rampRemaining > 0.0) {
						gain += static_cast<f32>(gainStep);
						rampRemaining -= invOutputRate;
					}
				}
			} else {
				const bool integerPos = position == std::floor(position);
				const bool loopAligned = !hasLoop || (loopStart == std::floor(loopStart) && loopEnd == std::floor(loopEnd));
				const bool fastPath = step == 1.0 && integerPos && loopAligned;

				if (fastPath) {
					size_t posIndex = static_cast<size_t>(position);
					const size_t loopStartIndex = static_cast<size_t>(loopStart);
					const size_t loopEndIndex = static_cast<size_t>(loopEnd);
				size_t outIndex = 0;

				if (channels == 1) {
					for (size_t frame = 0; frame < frameCount; ++frame) {
						if (stopAfter >= 0.0) {
							stopAfter -= invOutputRate;
							if (stopAfter <= 0.0) {
								ended = true;
								break;
							}
						}
						if (!hasLoop && posIndex >= framesInAsset) {
							ended = true;
							break;
						}

						const f32 sample = static_cast<f32>(readSample(posIndex)) * sampleScale;
						const f32 out = sample * gain;
						mix[outIndex] += out;
						mix[outIndex + 1] += out;
						outIndex += 2;

						++posIndex;
						if (hasLoop && posIndex >= loopEndIndex) {
							posIndex = loopStartIndex;
						}

						if (rampRemaining > 0.0) {
							gain += static_cast<f32>(gainStep);
							rampRemaining -= invOutputRate;
						}
					}
				} else {
					for (size_t frame = 0; frame < frameCount; ++frame) {
						if (stopAfter >= 0.0) {
							stopAfter -= invOutputRate;
							if (stopAfter <= 0.0) {
								ended = true;
								break;
							}
						}
						if (!hasLoop && posIndex >= framesInAsset) {
							ended = true;
							break;
						}

						const size_t base = posIndex * static_cast<size_t>(channels);
						const f32 left = static_cast<f32>(readSample(base)) * sampleScale;
						const f32 right = static_cast<f32>(readSample(base + 1)) * sampleScale;
						mix[outIndex] += left * gain;
						mix[outIndex + 1] += right * gain;
						outIndex += 2;

						++posIndex;
						if (hasLoop && posIndex >= loopEndIndex) {
							posIndex = loopStartIndex;
						}

						if (rampRemaining > 0.0) {
							gain += static_cast<f32>(gainStep);
							rampRemaining -= invOutputRate;
						}
					}
				}

				position = static_cast<f64>(posIndex);
			} else {
				size_t outIndex = 0;

				if (channels == 1) {
					if (hasLoop) {
						for (size_t frame = 0; frame < frameCount; ++frame) {
							if (stopAfter >= 0.0) {
								stopAfter -= invOutputRate;
								if (stopAfter <= 0.0) {
									ended = true;
									break;
								}
							}

							const i64 idx = static_cast<i64>(position);
							const f64 frac = position - static_cast<f64>(idx);
							i64 idx1 = idx + 1;
							if (static_cast<f64>(idx1) >= loopEnd) {
								const f64 wrapped = loopStart + (static_cast<f64>(idx1) - loopEnd);
								idx1 = static_cast<i64>(wrapped);
							}

							const f32 s0 = static_cast<f32>(readSample(static_cast<size_t>(idx))) * sampleScale;
							const f32 s1 = static_cast<f32>(readSample(static_cast<size_t>(idx1))) * sampleScale;
							const f32 sample = s0 + (s1 - s0) * static_cast<f32>(frac);
							const f32 out = sample * gain;
							mix[outIndex] += out;
							mix[outIndex + 1] += out;
							outIndex += 2;

							position += step;
							if (position >= loopEnd) {
								position = loopStart + std::fmod(position - loopStart, loopLen);
							}

							if (rampRemaining > 0.0) {
								gain += static_cast<f32>(gainStep);
								rampRemaining -= invOutputRate;
							}
						}
					} else {
						const f64 framesInAssetF = static_cast<f64>(framesInAsset);
						for (size_t frame = 0; frame < frameCount; ++frame) {
							if (stopAfter >= 0.0) {
								stopAfter -= invOutputRate;
								if (stopAfter <= 0.0) {
									ended = true;
									break;
								}
							}
							if (position >= framesInAssetF) {
								ended = true;
								break;
							}

							const i64 idx = static_cast<i64>(position);
							const f64 frac = position - static_cast<f64>(idx);
							const size_t idx0 = static_cast<size_t>(idx);
							const f32 s0 = static_cast<f32>(readSample(idx0)) * sampleScale;
							f32 s1 = 0.0f;
							const size_t idx1 = idx0 + 1;
							if (idx1 < framesInAsset) {
								s1 = static_cast<f32>(readSample(idx1)) * sampleScale;
							}
							const f32 sample = s0 + (s1 - s0) * static_cast<f32>(frac);
							const f32 out = sample * gain;
							mix[outIndex] += out;
							mix[outIndex + 1] += out;
							outIndex += 2;

							position += step;
							if (rampRemaining > 0.0) {
								gain += static_cast<f32>(gainStep);
								rampRemaining -= invOutputRate;
							}
						}
					}
				} else {
					if (hasLoop) {
						for (size_t frame = 0; frame < frameCount; ++frame) {
							if (stopAfter >= 0.0) {
								stopAfter -= invOutputRate;
								if (stopAfter <= 0.0) {
									ended = true;
									break;
								}
							}

							const i64 idx = static_cast<i64>(position);
							const f64 frac = position - static_cast<f64>(idx);
							i64 idx1 = idx + 1;
							if (static_cast<f64>(idx1) >= loopEnd) {
								const f64 wrapped = loopStart + (static_cast<f64>(idx1) - loopEnd);
								idx1 = static_cast<i64>(wrapped);
							}

							const size_t base0 = static_cast<size_t>(idx) * static_cast<size_t>(channels);
							const size_t base1 = static_cast<size_t>(idx1) * static_cast<size_t>(channels);
							const f32 left0 = static_cast<f32>(readSample(base0)) * sampleScale;
							const f32 right0 = static_cast<f32>(readSample(base0 + 1)) * sampleScale;
							const f32 left1 = static_cast<f32>(readSample(base1)) * sampleScale;
							const f32 right1 = static_cast<f32>(readSample(base1 + 1)) * sampleScale;

							const f32 left = left0 + (left1 - left0) * static_cast<f32>(frac);
							const f32 right = right0 + (right1 - right0) * static_cast<f32>(frac);
							mix[outIndex] += left * gain;
							mix[outIndex + 1] += right * gain;
							outIndex += 2;

							position += step;
							if (position >= loopEnd) {
								position = loopStart + std::fmod(position - loopStart, loopLen);
							}

							if (rampRemaining > 0.0) {
								gain += static_cast<f32>(gainStep);
								rampRemaining -= invOutputRate;
							}
						}
					} else {
						const f64 framesInAssetF = static_cast<f64>(framesInAsset);
						for (size_t frame = 0; frame < frameCount; ++frame) {
							if (stopAfter >= 0.0) {
								stopAfter -= invOutputRate;
								if (stopAfter <= 0.0) {
									ended = true;
									break;
								}
							}
							if (position >= framesInAssetF) {
								ended = true;
								break;
							}

							const i64 idx = static_cast<i64>(position);
							const f64 frac = position - static_cast<f64>(idx);
							const size_t idx0 = static_cast<size_t>(idx);
							const size_t base0 = idx0 * static_cast<size_t>(channels);
							const f32 left0 = static_cast<f32>(readSample(base0)) * sampleScale;
							const f32 right0 = static_cast<f32>(readSample(base0 + 1)) * sampleScale;
							f32 left1 = 0.0f;
							f32 right1 = 0.0f;
							const size_t idx1 = idx0 + 1;
							if (idx1 < framesInAsset) {
								const size_t base1 = idx1 * static_cast<size_t>(channels);
								left1 = static_cast<f32>(readSample(base1)) * sampleScale;
								right1 = static_cast<f32>(readSample(base1 + 1)) * sampleScale;
							}

							const f32 left = left0 + (left1 - left0) * static_cast<f32>(frac);
							const f32 right = right0 + (right1 - right0) * static_cast<f32>(frac);
							mix[outIndex] += left * gain;
							mix[outIndex + 1] += right * gain;
							outIndex += 2;

							position += step;
							if (rampRemaining > 0.0) {
								gain += static_cast<f32>(gainStep);
								rampRemaining -= invOutputRate;
							}
						}
					}
				}
			}
			}

			record.position = position;
			record.gain = gain;
			record.gainRampRemaining = rampRemaining > 0.0 ? rampRemaining : 0.0;
			if (record.gainRampRemaining == 0.0f) {
				record.gain = record.targetGain;
			}
			record.stopAfter = stopAfter;

			if (ended) {
				removeVoice(static_cast<AudioType>(typeIdx), i);
				continue;
			}
			++i;
		}
	}

	const f32 master = m_masterVolume;
	for (size_t i = 0; i < totalSamples; ++i) {
		f32 v = mix[i] * master;
		if (v > 1.0f) v = 1.0f;
		if (v < -1.0f) v = -1.0f;
		output[i] = static_cast<i16>(std::lrint(v * 32767.0f));
	}

	// const auto mixEnd = std::chrono::steady_clock::now();
	// static f64 accAudioSec = 0.0;
	// static f64 accMixMs = 0.0;
	// static u64 accCalls = 0;
	// accAudioSec += dt;
	// accMixMs += std::chrono::duration<double, std::milli>(mixEnd - mixStart).count();
	// accCalls += 1;
	// if (accAudioSec >= 1.0) {
	// 	const size_t sfxCount = m_voicesByType[0].size();
	// 	const size_t musicCount = m_voicesByType[1].size();
	// 	const size_t uiCount = m_voicesByType[2].size();
	// 	const f64 audioMs = accAudioSec * 1000.0;
	// 	const f64 loadPct = (accMixMs / audioMs) * 100.0;
	// 	std::fprintf(stderr,
	// 		"[BMSX] audio mix %.2fms / %.2fms (%.1f%%), calls=%llu, voices sfx=%zu music=%zu ui=%zu\n",
	// 		accMixMs,
	// 		audioMs,
	// 		loadPct,
	// 		static_cast<unsigned long long>(accCalls),
	// 		sfxCount,
	// 		musicCount,
	// 		uiCount);
	// 	accAudioSec = 0.0;
	// 	accMixMs = 0.0;
	// 	accCalls = 0;
	// }

	m_audioTimeSec += dt;
}

ModulationParams SoundMaster::resolvePlayParams(const ModulationInput& input) {
	auto randomInRange = [this](const std::optional<ModulationRange>& range) -> f32 {
		if (!range.has_value()) return 0.0f;
		f32 min = range->min;
		f32 max = range->max;
		if (min > max) std::swap(min, max);
		return min + (max - min) * m_unitDist(m_rng);
	};

	ModulationParams params;
	params.offset = (input.offset.has_value() ? input.offset.value() : 0.0f) + randomInRange(input.offsetRange);
	params.pitchDelta = (input.pitchDelta.has_value() ? input.pitchDelta.value() : 0.0f) + randomInRange(input.pitchRange);
	params.volumeDelta = (input.volumeDelta.has_value() ? input.volumeDelta.value() : 0.0f) + randomInRange(input.volumeRange);
	params.playbackRate = (input.playbackRate.has_value() ? input.playbackRate.value() : 1.0f) + randomInRange(input.playbackRateRange);
	if (input.filter.has_value()) {
		params.filter = input.filter;
	}
	return params;
}

std::optional<ModulationInput> SoundMaster::resolveModulationPreset(const AssetId& key) const {
	if (key.empty()) return std::nullopt;
	size_t pos = key.find('.');
	const std::string root = pos == std::string::npos ? key : key.substr(0, pos);
	const BinValue* dataValue = m_assets->getData(root);
	if (!dataValue) return std::nullopt;

	const BinValue* cursor = dataValue;
	while (pos != std::string::npos) {
		const size_t next = key.find('.', pos + 1);
		const std::string segment = key.substr(pos + 1, next - (pos + 1));
		const auto& obj = cursor->asObject();
		auto segIt = obj.find(segment);
		if (segIt == obj.end()) return std::nullopt;
		cursor = &segIt->second;
		pos = next;
	}

	return parseModulationInput(*cursor);
}

ModulationInput SoundMaster::parseModulationInput(const BinValue& value) const {
	if (!value.isObject()) {
		throw BMSX_RUNTIME_ERROR("Modulation preset is not an object");
	}
	const auto& obj = value.asObject();
	ModulationInput input;

	auto readRange = [](const BinValue& v) -> ModulationRange {
		if (!v.isArray()) {
			throw BMSX_RUNTIME_ERROR("Modulation range is not an array");
		}
		const auto& arr = v.asArray();
		if (arr.size() < 2) {
			throw BMSX_RUNTIME_ERROR("Modulation range is missing bounds");
		}
		return ModulationRange{static_cast<f32>(arr[0].toNumber()), static_cast<f32>(arr[1].toNumber())};
	};

	auto setOptionalRange = [&](const char* key, std::optional<ModulationRange>& target) {
		auto it = obj.find(key);
		if (it == obj.end() || it->second.isNull()) return;
		target = readRange(it->second);
	};

	auto setOptionalNumber = [&](const char* key, std::optional<f32>& target) {
		auto it = obj.find(key);
		if (it == obj.end() || it->second.isNull()) return;
		target = static_cast<f32>(it->second.toNumber());
	};

	setOptionalRange("pitchRange", input.pitchRange);
	setOptionalRange("volumeRange", input.volumeRange);
	setOptionalRange("offsetRange", input.offsetRange);
	setOptionalRange("playbackRateRange", input.playbackRateRange);

	setOptionalNumber("pitchDelta", input.pitchDelta);
	setOptionalNumber("volumeDelta", input.volumeDelta);
	setOptionalNumber("offset", input.offset);
	setOptionalNumber("playbackRate", input.playbackRate);

	auto filterIt = obj.find("filter");
	if (filterIt != obj.end() && filterIt->second.isObject()) {
		const auto& fobj = filterIt->second.asObject();
		FilterModulationParams filter;
		auto typeIt = fobj.find("type");
		if (typeIt != fobj.end() && typeIt->second.isString()) {
			filter.type = typeIt->second.asString();
		}
		auto freqIt = fobj.find("frequency");
		if (freqIt != fobj.end() && freqIt->second.isNumber()) {
			filter.frequency = static_cast<f32>(freqIt->second.toNumber());
		}
		auto qIt = fobj.find("q");
		if (qIt != fobj.end() && qIt->second.isNumber()) {
			filter.q = static_cast<f32>(qIt->second.toNumber());
		}
		auto gainIt = fobj.find("gain");
		if (gainIt != fobj.end() && gainIt->second.isNumber()) {
			filter.gain = static_cast<f32>(gainIt->second.toNumber());
		}
		input.filter = filter;
	}

	return input;
}

ModulationInput SoundMaster::parseModulationInput(const Table& table) const {
	auto key = [](const std::string& name) {
		return Runtime::instance().canonicalizeIdentifier(name);
	};
	auto valueString = [](Value value) -> const std::string& {
		return Runtime::instance().cpu().stringPool().toString(asStringId(value));
	};

	auto getNumber = [&](const std::string& field, std::optional<f32>& out) {
		Value v = table.get(key(field));
		if (isNil(v)) return;
		if (valueIsNumber(v)) {
			out = static_cast<f32>(valueToNumber(v));
			return;
		}
		throw BMSX_RUNTIME_ERROR("Modulation param '" + field + "' is not a number");
	};

	auto getRange = [&](const std::string& field, std::optional<ModulationRange>& out) {
		Value v = table.get(key(field));
		if (isNil(v)) return;
		if (!valueIsTable(v)) {
			throw BMSX_RUNTIME_ERROR("Modulation range '" + field + "' is not an array");
		}
		const Table& arr = *asTable(v);
		const int len = arr.length();
		if (len < 2) {
			throw BMSX_RUNTIME_ERROR("Modulation range '" + field + "' is missing bounds");
		}
		const Value v0 = arr.get(valueNumber(1.0));
		const Value v1 = arr.get(valueNumber(2.0));
		if (!valueIsNumber(v0) || !valueIsNumber(v1)) {
			throw BMSX_RUNTIME_ERROR("Modulation range '" + field + "' bounds are not numbers");
		}
		out = ModulationRange{static_cast<f32>(valueToNumber(v0)), static_cast<f32>(valueToNumber(v1))};
	};

	ModulationInput input;
	getNumber("pitchDelta", input.pitchDelta);
	getNumber("volumeDelta", input.volumeDelta);
	getNumber("offset", input.offset);
	getNumber("playbackRate", input.playbackRate);
	getRange("pitchRange", input.pitchRange);
	getRange("volumeRange", input.volumeRange);
	getRange("offsetRange", input.offsetRange);
	getRange("playbackRateRange", input.playbackRateRange);

	Value filterVal = table.get(key("filter"));
	if (!isNil(filterVal)) {
		if (!valueIsTable(filterVal)) {
			throw BMSX_RUNTIME_ERROR("Modulation filter must be a table");
		}
		const Table& ftable = *asTable(filterVal);
		FilterModulationParams filter;
		Value typeVal = ftable.get(key("type"));
		if (valueIsString(typeVal)) {
			filter.type = valueString(typeVal);
		}
		Value freqVal = ftable.get(key("frequency"));
		if (valueIsNumber(freqVal)) {
			filter.frequency = static_cast<f32>(valueToNumber(freqVal));
		}
		Value qVal = ftable.get(key("q"));
		if (valueIsNumber(qVal)) {
			filter.q = static_cast<f32>(valueToNumber(qVal));
		}
		Value gainVal = ftable.get(key("gain"));
		if (valueIsNumber(gainVal)) {
			filter.gain = static_cast<f32>(valueToNumber(gainVal));
		}
		input.filter = filter;
	}

	return input;
}

const AudioAsset& SoundMaster::getAudioOrThrow(const AssetId& id) const {
	const AudioAsset* asset = m_assets ? m_assets->getAudio(id) : nullptr;
	if (!asset) {
		throw BMSX_RUNTIME_ERROR("Audio asset not found: " + id);
	}
	return *asset;
}

AudioDataView SoundMaster::resolveAudioData(const AssetId& id) const {
	if (!m_audioResolver) {
		throw BMSX_RUNTIME_ERROR("SoundMaster audio resolver not configured.");
	}
	AudioDataView view = m_audioResolver(id);
	if (!view.data || view.frames == 0) {
		throw BMSX_RUNTIME_ERROR("Audio asset missing encoded data: " + id);
	}
	return view;
}

void SoundMaster::badpLoadBlock(VoiceRecord& record, size_t offset) {
	const AudioAsset& asset = *record.asset;
	const u8* data = record.data;
	if (offset + 4 > asset.dataSize) {
		throw BMSX_RUNTIME_ERROR("BADP block header exceeds data.");
	}
	const size_t blockFrames = static_cast<size_t>(readLE16Audio(data + offset));
	const size_t blockBytes = static_cast<size_t>(readLE16Audio(data + offset + 2));
	if (blockFrames == 0) {
		throw BMSX_RUNTIME_ERROR("BADP block frame count is zero.");
	}
	const size_t blockHeaderBytes = 4 + static_cast<size_t>(asset.channels) * 4;
	if (blockBytes < blockHeaderBytes) {
		throw BMSX_RUNTIME_ERROR("BADP block header length is invalid.");
	}
	const size_t blockEnd = offset + blockBytes;
	if (blockEnd > asset.dataSize) {
		throw BMSX_RUNTIME_ERROR("BADP block exceeds bounds.");
	}
	size_t cursor = offset + 4;
	for (i32 channel = 0; channel < asset.channels; channel += 1) {
		record.badp.predictors[channel] = static_cast<i16>(readLE16Audio(data + cursor));
		const i32 stepIndex = static_cast<i32>(data[cursor + 2]);
		if (stepIndex < 0 || stepIndex > 88) {
			throw BMSX_RUNTIME_ERROR("BADP step index out of range.");
		}
		record.badp.stepIndices[channel] = stepIndex;
		cursor += 4;
	}
	record.badp.blockEnd = blockEnd;
	record.badp.blockFrames = blockFrames;
	record.badp.blockFrameIndex = 0;
	record.badp.payloadOffset = offset + blockHeaderBytes;
	record.badp.nibbleCursor = 0;
}

void SoundMaster::badpSeekToFrame(VoiceRecord& record, size_t frame) {
	const AudioAsset& asset = *record.asset;
	if (frame > record.frames) {
		throw BMSX_RUNTIME_ERROR("BADP seek frame out of range.");
	}
	if (frame == record.frames) {
		record.badp.nextFrame = frame;
		record.badp.decodedFrame = static_cast<i64>(frame) - 1;
		record.badp.decodedLeft = 0;
		record.badp.decodedRight = 0;
		return;
	}

	size_t seekIndex = 0;
	size_t lo = 0;
	size_t hi = asset.badpSeekFrames.size() - 1;
	while (lo <= hi) {
		const size_t mid = (lo + hi) >> 1;
		if (asset.badpSeekFrames[mid] <= frame) {
			seekIndex = mid;
			lo = mid + 1;
		} else {
			if (mid == 0) {
				break;
			}
			hi = mid - 1;
		}
	}

	size_t currentFrame = static_cast<size_t>(asset.badpSeekFrames[seekIndex]);
	size_t cursor = static_cast<size_t>(asset.badpSeekOffsets[seekIndex]);
	badpLoadBlock(record, cursor);
	while (currentFrame + record.badp.blockFrames <= frame) {
		currentFrame += record.badp.blockFrames;
		cursor = record.badp.blockEnd;
		badpLoadBlock(record, cursor);
	}
	record.badp.nextFrame = currentFrame;
	record.badp.decodedFrame = static_cast<i64>(currentFrame) - 1;
	while (record.badp.nextFrame <= frame) {
		badpDecodeNextFrame(record);
	}
}

void SoundMaster::badpResetDecoder(VoiceRecord& record, size_t frame) {
	record.badp = BadpDecoderState{};
	badpSeekToFrame(record, frame);
}

void SoundMaster::badpDecodeNextFrame(VoiceRecord& record) {
	if (record.badp.nextFrame >= record.frames) {
		throw BMSX_RUNTIME_ERROR("BADP decode frame out of range.");
	}
	if (record.badp.blockFrameIndex >= record.badp.blockFrames) {
		badpLoadBlock(record, record.badp.blockEnd);
	}

	const AudioAsset& asset = *record.asset;
	const u8* data = record.data;
	i32 left = 0;
	i32 right = 0;
	for (i32 channel = 0; channel < asset.channels; channel += 1) {
		const size_t payloadIndex = record.badp.payloadOffset + (record.badp.nibbleCursor >> 1);
		if (payloadIndex >= record.badp.blockEnd) {
			throw BMSX_RUNTIME_ERROR("BADP payload underrun.");
		}
		const u8 packed = data[payloadIndex];
		const i32 code = (record.badp.nibbleCursor & 1) == 0 ? static_cast<i32>((packed >> 4) & 0x0f) : static_cast<i32>(packed & 0x0f);
		record.badp.nibbleCursor += 1;

		const i32 step = BADP_STEP_TABLE[record.badp.stepIndices[channel]];
		i32 diff = step >> 3;
		if ((code & 4) != 0) diff += step;
		if ((code & 2) != 0) diff += step >> 1;
		if ((code & 1) != 0) diff += step >> 2;
		if ((code & 8) != 0) {
			record.badp.predictors[channel] -= diff;
		} else {
			record.badp.predictors[channel] += diff;
		}
		if (record.badp.predictors[channel] < -32768) record.badp.predictors[channel] = -32768;
		if (record.badp.predictors[channel] > 32767) record.badp.predictors[channel] = 32767;
		record.badp.stepIndices[channel] += BADP_INDEX_TABLE[code];
		if (record.badp.stepIndices[channel] < 0) record.badp.stepIndices[channel] = 0;
		if (record.badp.stepIndices[channel] > 88) record.badp.stepIndices[channel] = 88;

		if (channel == 0) {
			left = record.badp.predictors[channel];
		} else {
			right = record.badp.predictors[channel];
		}
	}
	if (asset.channels == 1) {
		right = left;
	}
	record.badp.blockFrameIndex += 1;
	record.badp.nextFrame += 1;
	record.badp.decodedFrame = static_cast<i64>(record.badp.nextFrame) - 1;
	record.badp.decodedLeft = static_cast<i16>(left);
	record.badp.decodedRight = static_cast<i16>(right);
}

bool SoundMaster::badpReadFrameAt(VoiceRecord& record, size_t frame, i16& outLeft, i16& outRight) {
	if (frame >= record.frames) {
		return false;
	}
	if (record.badp.decodedFrame == static_cast<i64>(frame)) {
		outLeft = record.badp.decodedLeft;
		outRight = record.badp.decodedRight;
		return true;
	}
	if (frame < record.badp.nextFrame) {
		badpSeekToFrame(record, frame);
	}
	while (record.badp.nextFrame <= frame) {
		badpDecodeNextFrame(record);
	}
	outLeft = record.badp.decodedLeft;
	outRight = record.badp.decodedRight;
	return true;
}

VoiceId SoundMaster::startVoice(AudioType type, const AssetId& id, const AudioAsset& asset, const ModulationParams& params, i32 priority, f32 initialGain) {
	const size_t idx = typeIndex(type);
	auto& pool = m_voicesByType[idx];
	const size_t capacity = m_maxVoicesByType[idx];
	if (capacity > 0 && pool.size() >= capacity) {
		const int drop = selectVoiceDropIndex(pool);
		if (drop >= 0) {
			if (priority < pool[drop].priority) {
				return 0;
			}
			removeVoice(type, static_cast<size_t>(drop));
		}
	}

	VoiceRecord record;
	record.voiceId = m_nextVoiceId++;
	record.id = id;
	record.asset = &asset;
	record.meta = asset.meta;
	record.type = type;
	record.priority = priority;
	record.params = params;
	record.startedAt = m_audioTimeSec;
	const AudioDataView view = resolveAudioData(id);
	record.data = view.data;
	record.frames = view.frames;
	record.usesBadp = asset.bitsPerSample == 4;
	const size_t framesInAsset = record.frames;
	const f64 durationSec = framesInAsset > 0 ? static_cast<f64>(framesInAsset) / asset.sampleRate : 0.0;
	f64 offset = params.offset;
	if (durationSec > 0.0) {
		if (asset.meta.loopStart.has_value()) {
			offset = std::fmod(offset, durationSec);
			if (offset < 0.0) offset += durationSec;
		} else {
			if (offset < 0.0) offset = 0.0;
			if (offset > durationSec) offset = durationSec;
		}
	}
	const f64 rate = effectivePlaybackRate(params);
	if (rate <= 0.0) {
		throw BMSX_RUNTIME_ERROR("Playback rate must be positive");
	}
	record.startOffset = offset;
	record.position = offset * asset.sampleRate;
	record.step = rate;
	record.gain = initialGain;
	record.targetGain = initialGain;
	record.gainRampRemaining = 0.0;
	record.stopAfter = -1.0;
	if (record.usesBadp) {
		badpResetDecoder(record, static_cast<size_t>(std::floor(record.position)));
	}

	pool.push_back(record);
	m_currentVoiceIdByType[idx] = record.voiceId;
	m_currentAudioIdByType[idx] = id;
	m_currentParamsByType[idx] = params;

	return record.voiceId;
}

void SoundMaster::removeVoice(AudioType type, size_t index) {
	const size_t idx = typeIndex(type);
	auto& pool = m_voicesByType[idx];
	if (index >= pool.size()) return;
	VoiceRecord record = pool[index];
	pool.erase(pool.begin() + static_cast<std::ptrdiff_t>(index));
	if (m_currentVoiceIdByType[idx] == record.voiceId) {
		if (!pool.empty()) {
			const auto& latest = pool.back();
			m_currentVoiceIdByType[idx] = latest.voiceId;
			m_currentAudioIdByType[idx] = latest.id;
			m_currentParamsByType[idx] = latest.params;
		} else {
			m_currentVoiceIdByType[idx] = 0;
			m_currentAudioIdByType[idx].clear();
			m_currentParamsByType[idx] = ModulationParams{};
		}
	}
	finalizeVoiceEnd(type, record);
}

void SoundMaster::finalizeVoiceEnd(AudioType type, const VoiceRecord& record) {
	const size_t idx = typeIndex(type);
	if (m_endedListenersByType[idx].empty()) return;
	ActiveVoiceInfo info{
		record.voiceId,
		record.id,
		record.priority,
		record.params,
		record.startedAt,
		record.startOffset,
		record.meta,
	};
	for (const auto& entry : m_endedListenersByType[idx]) {
		entry.second(info);
	}
}

void SoundMaster::stopVoice(AudioType type, size_t index) {
	removeVoice(type, index);
}

int SoundMaster::selectVoiceDropIndex(const std::vector<VoiceRecord>& pool) const {
	if (pool.empty()) return -1;
	size_t index = 0;
	const VoiceRecord* candidate = &pool[0];
	for (size_t i = 1; i < pool.size(); ++i) {
		const auto& record = pool[i];
		if (record.priority < candidate->priority) {
			candidate = &record;
			index = i;
			continue;
		}
		if (record.priority == candidate->priority && record.startedAt < candidate->startedAt) {
			candidate = &record;
			index = i;
		}
	}
	return static_cast<int>(index);
}

void SoundMaster::startMusicWithFade(const AssetId& target, f64 fadeSec, bool startAtLoopStart, std::optional<f64> startAtSeconds) {
	const AudioAsset& asset = getAudioOrThrow(target);
	const f64 baseOffset = startAtSeconds.has_value()
		? startAtSeconds.value()
		: (startAtLoopStart && asset.meta.loopStart.has_value() ? asset.meta.loopStart.value() : 0.0);

	ModulationParams params;
	params.offset = static_cast<f32>(baseOffset);
	const f32 initialGain = MIN_GAIN;
	const VoiceId newVoiceId = startVoice(AudioType::Music, target, asset, params, asset.meta.priority, initialGain);
	if (newVoiceId == 0) return;

	const size_t musicIdx = typeIndex(AudioType::Music);
	auto& pool = m_voicesByType[musicIdx];
	for (auto& record : pool) {
		if (record.voiceId == newVoiceId) {
			rampVoiceGain(record, 1.0f, fadeSec);
			break;
		}
	}

	if (pool.size() > 1) {
		for (auto& record : pool) {
			if (record.voiceId != newVoiceId) {
				rampVoiceGain(record, MIN_GAIN, fadeSec);
				record.stopAfter = fadeSec;
			}
		}
	}
}

void SoundMaster::enqueueTransition(const MusicTransitionRequest& request, f64 delaySec, std::optional<f64> startAtSeconds) {
	PendingTransition pending;
	pending.request = request;
	pending.remainingSec = delaySec;
	pending.startAtSeconds = startAtSeconds;
	m_pendingTransition = pending;
}

void SoundMaster::processPendingTransitions(f64 dt) {
	if (!m_pendingTransition.has_value()) return;
	auto& pending = m_pendingTransition.value();
	pending.remainingSec -= dt;
	if (pending.remainingSec > 0.0) return;
	const auto startAt = pending.startAtSeconds;
	startMusicWithFade(pending.request.to, pending.request.fadeMs / 1000.0, pending.request.startAtLoopStart, startAt);
	m_pendingTransition.reset();
}

void SoundMaster::rampVoiceGain(VoiceRecord& record, f32 target, f64 durationSec) {
	record.targetGain = target;
	record.gainRampRemaining = durationSec;
}

f32 SoundMaster::clampVolume(f32 value) const {
	if (value < 0.0f) return 0.0f;
	if (value > 1.0f) return 1.0f;
	return std::isfinite(value) ? value : 0.0f;
}

f64 SoundMaster::effectivePlaybackRate(const ModulationParams& params) const {
	const f64 base = params.playbackRate;
	const f64 pitch = params.pitchDelta;
	return base * std::pow(2.0, pitch / 12.0);
}

size_t SoundMaster::typeIndex(AudioType type) {
	switch (type) {
		case AudioType::Sfx: return 0;
		case AudioType::Music: return 1;
		case AudioType::Ui: return 2;
	}
	return 0;
}

} // namespace bmsx
