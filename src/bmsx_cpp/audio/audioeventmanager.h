/*
 * audioeventmanager.h - Data-driven audio event dispatch
 */

#pragma once

#include "soundmaster.h"
#include "../core/assets.h"
#include "../core/registry.h"
#include "../vm/cpu.h"
#include <array>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace bmsx {

enum class AudioPlaybackMode {
	Replace,
	Ignore,
	Queue,
	Stop,
	Pause,
};

struct AudioCaseMatcher {
	std::vector<std::pair<std::string, BinValue>> equals;
	std::vector<std::pair<std::string, std::vector<BinValue>>> anyOf;
	std::vector<std::string> requiredTags;
	std::vector<AudioCaseMatcher> andMatchers;
	std::vector<AudioCaseMatcher> orMatchers;
	std::shared_ptr<AudioCaseMatcher> notMatcher;
};

struct AudioAction {
	AssetId audioId;
	std::optional<AssetId> modulationPreset;
	std::optional<i32> priority;
	std::optional<i32> cooldownMs;
};

struct AudioActionWeighted {
	AudioAction action;
	f32 weight = 1.0f;
};

enum class AudioPickMode {
	Uniform,
	Weighted,
};

struct AudioActionOneOf {
	std::vector<AudioActionWeighted> items;
	AudioPickMode pickMode = AudioPickMode::Uniform;
	bool avoidRepeat = false;
};

struct MusicTransitionSpec {
	AssetId audioId;
	MusicTransitionSync sync;
	i32 fadeMs = 250;
	bool startAtLoopStart = false;
	bool startFresh = false;
};

struct AudioActionSpec {
	enum class Kind { Action, OneOf, MusicTransition } kind = Kind::Action;
	AudioAction action;
	AudioActionOneOf oneOf;
	MusicTransitionSpec transition;
};

struct AudioEventRule {
	AudioCaseMatcher when;
	AudioActionSpec action;
};

struct AudioEventEntry {
	std::string name;
	std::optional<AudioType> channel;
	std::optional<i32> maxVoices;
	std::optional<AudioPlaybackMode> policy;
	std::vector<AudioEventRule> rules;
};

struct AudioEventQueueItem {
	std::string name;
	AssetId audioId;
	std::optional<AssetId> modulationPreset;
	std::optional<ModulationInput> modulationParams;
	std::optional<i32> priority;
	std::optional<i32> cooldownMs;
	std::optional<std::string> payloadActorId;
	f64 enqueuedAt = 0.0;
};

class AudioEventManager final : public Registerable {
public:
	AudioEventManager();
	~AudioEventManager() override;

	const Identifier& registryId() const override;
	bool isRegistryPersistent() const override { return true; }

	void setSoundMaster(SoundMaster* soundMaster) { m_soundMaster = soundMaster; }
	void setAssets(const RuntimeAssets* assets) { m_assets = assets; }

	void init(const std::unordered_map<AssetId, BinValue>& map);
	void resetPlaybackState();
	void dispose();

	bool onEvent(const std::string& name, const Value& payload, const std::string& emitterId);
	void playDirect(const AssetId& id, const SoundMasterPlayRequest& request = {});

private:
	AudioEventEntry parseEventEntry(const std::string& name, const BinValue& value) const;
	AudioEventRule parseRule(const BinValue& value) const;
	AudioActionSpec parseActionSpec(const BinValue& value) const;
	AudioAction parseAction(const BinValue& value) const;
	AudioActionOneOf parseOneOf(const BinValue& value) const;
	MusicTransitionSpec parseMusicTransition(const BinValue& value) const;
	MusicTransitionSync parseMusicSync(const BinValue& value) const;
	AudioCaseMatcher parseMatcher(const BinValue& value) const;

	bool ruleMatches(const AudioCaseMatcher& matcher, const Value& payload) const;
	bool valueEquals(const BinValue& expected, const Value& actual) const;
	bool matchesAnyOf(const std::vector<BinValue>& expected, const Value& actual) const;
	std::optional<std::string> readPayloadString(const Value& payload, const std::string& key) const;
	std::optional<ModulationInput> readPayloadModulation(const Value& payload, const std::string& key) const;

	std::optional<AudioAction> pickAction(const std::string& eventName, const AudioEventEntry& entry, const Value& payload);
	size_t pickUniformIndex(size_t n, std::optional<size_t> avoid) const;
	size_t pickWeightedIndex(const std::vector<f32>& weights, std::optional<size_t> avoid) const;

	void enqueue(AudioType type, AudioEventQueueItem item);
	void onChannelEnded(AudioType type);
	void handleQueued(AudioType type);

	f64 nowMs() const;

	SoundMaster* m_soundMaster = nullptr;
	const RuntimeAssets* m_assets = nullptr;

	std::unordered_map<std::string, AudioEventEntry> m_events;
	std::unordered_map<std::string, f64> m_lastPlayedAt;
	std::unordered_map<std::string, size_t> m_lastRandomPickByRule;

	std::array<std::vector<AudioEventQueueItem>, 3> m_queuesByType;
	std::array<bool, 3> m_resumeOnNextEndByType{false, false, false};

	std::array<SubscriptionHandle, 3> m_endSubscriptions{};

	mutable std::mt19937 m_rng;
	mutable std::uniform_real_distribution<f32> m_unitDist;
	mutable std::vector<f32> m_weightScratch;
};

} // namespace bmsx
