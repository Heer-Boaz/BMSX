/*
 * audioeventmanager.cpp - Audio event dispatch implementation
 */

#include "audioeventmanager.h"
#include "../core/engine.h"
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace bmsx {

static AudioPlaybackMode parsePlaybackMode(const std::string& value) {
	if (value == "ignore") return AudioPlaybackMode::Ignore;
	if (value == "queue") return AudioPlaybackMode::Queue;
	if (value == "stop") return AudioPlaybackMode::Stop;
	if (value == "pause") return AudioPlaybackMode::Pause;
	return AudioPlaybackMode::Replace;
}

AudioEventManager::AudioEventManager()
	: m_rng(std::random_device{}()),
	  m_unitDist(0.0f, 1.0f) {
}

AudioEventManager::~AudioEventManager() {
	dispose();
}

const Identifier& AudioEventManager::registryId() const {
	static const Identifier id = "aem";
	return id;
}

void AudioEventManager::init(const std::unordered_map<AssetId, BinValue>& map) {
	dispose();
	resetPlaybackState();

	// Keep event parsing aligned with src/bmsx/audio/audioeventmanager.ts to avoid runtime drift.
	auto addOrMerge = [&](const std::string& name, const AudioEventEntry& entry) {
		auto it = m_events.find(name);
		if (it == m_events.end()) {
			m_events[name] = entry;
			return;
		}
		AudioEventEntry merged = it->second;
		if (entry.channel.has_value()) merged.channel = entry.channel;
		if (entry.maxVoices.has_value()) merged.maxVoices = entry.maxVoices;
		if (entry.policy.has_value()) merged.policy = entry.policy;
		std::vector<AudioEventRule> combined;
		combined.reserve(entry.rules.size() + merged.rules.size());
		combined.insert(combined.end(), entry.rules.begin(), entry.rules.end());
		combined.insert(combined.end(), merged.rules.begin(), merged.rules.end());
		merged.rules = std::move(combined);
		m_events[name] = std::move(merged);
	};

	for (const auto& [assetId, value] : map) {
		(void)assetId;
		const auto& obj = value.asObject();

		auto eventsIt = obj.find("events");
		if (eventsIt != obj.end() && eventsIt->second.isObject()) {
			const auto& eventsObj = eventsIt->second.asObject();
			for (const auto& [eventName, eventValue] : eventsObj) {
				addOrMerge(eventName, parseEventEntry(eventName, eventValue));
			}
			continue;
		}

		bool foundDirect = false;
		for (const auto& [key, entryValue] : obj) {
			if (key == "$type" || key == "events" || key == "name" || key == "channel" || key == "max_voices" || key == "policy" || key == "rules") {
				continue;
			}
			if (entryValue.isObject() && entryValue.asObject().count("rules") > 0) {
				addOrMerge(key, parseEventEntry(key, entryValue));
				foundDirect = true;
			}
		}
		if (foundDirect) continue;

		if (obj.count("rules") > 0) {
			auto nameIt = obj.find("name");
			if (nameIt != obj.end() && nameIt->second.isString()) {
				addOrMerge(nameIt->second.asString(), parseEventEntry(nameIt->second.asString(), value));
			}
		}
	}

	m_endSubscriptions[static_cast<size_t>(AudioType::Sfx)] =
		m_soundMaster->addEndedListener(AudioType::Sfx, [this](const ActiveVoiceInfo&) { onChannelEnded(AudioType::Sfx); });
	m_endSubscriptions[static_cast<size_t>(AudioType::Ui)] =
		m_soundMaster->addEndedListener(AudioType::Ui, [this](const ActiveVoiceInfo&) { onChannelEnded(AudioType::Ui); });
}

void AudioEventManager::resetPlaybackState() {
	for (auto& queue : m_queuesByType) queue.clear();
	m_resumeOnNextEndByType = {false, false, false};
	m_lastPlayedAt.clear();
	m_lastRandomPickByRule.clear();
}

void AudioEventManager::dispose() {
	for (auto& sub : m_endSubscriptions) {
		if (sub.active) sub.unsubscribe();
	}
	m_events.clear();
	resetPlaybackState();
}

bool AudioEventManager::onEvent(const std::string& name, const Value& payload, const std::string& emitterId) {
	if (emitterId == "view" || emitterId == "amg") return false;
	auto it = m_events.find(name);
	if (it == m_events.end()) return false;
	const AudioEventEntry& entry = it->second;

	for (const auto& rule : entry.rules) {
		if (!ruleMatches(rule.when, payload)) continue;
		if (rule.action.kind == AudioActionSpec::Kind::MusicTransition) {
			const auto& t = rule.action.transition;
			MusicTransitionRequest request;
			request.to = t.audioId;
			request.sync = t.sync;
			request.fadeMs = t.fadeMs;
			request.startAtLoopStart = t.startAtLoopStart;
			request.startFresh = t.startFresh;
			m_soundMaster->requestMusicTransition(request);
			return true;
		}
	}

	auto actionOpt = pickAction(name, entry, payload);
	if (!actionOpt.has_value()) return false;
	const AudioAction action = actionOpt.value();

	const AudioType channel = entry.channel.value_or(AudioType::Sfx);
	const i32 maxVoices = entry.maxVoices.value_or(1);
	const AudioPlaybackMode policy = entry.policy.value_or(AudioPlaybackMode::Replace);

	auto assetIt = m_assets->audio.find(action.audioId);
	if (assetIt == m_assets->audio.end()) {
		throw std::runtime_error("Audio asset not found: " + action.audioId);
	}
	const i32 fallbackPriority = assetIt->second.meta.priority;
	const i32 priority = action.priority.has_value() ? action.priority.value() : fallbackPriority;
	const size_t active = m_soundMaster->activeCountByType(channel);

	if (policy == AudioPlaybackMode::Stop) {
		m_soundMaster->stop(channel, AudioStopSelector::All);
		m_queuesByType[static_cast<size_t>(channel)].clear();
		return true;
	}

	if (active >= static_cast<size_t>(maxVoices)) {
		switch (policy) {
			case AudioPlaybackMode::Ignore:
				return true;
			case AudioPlaybackMode::Replace: {
				const auto infos = m_soundMaster->getActiveVoiceInfosByType(channel);
				if (infos.empty()) {
					throw std::runtime_error("Active voice list empty for channel");
				}
				size_t minIdx = 0;
				i32 minPr = infos[0].priority;
				f64 oldest = infos[0].startedAt;
				for (size_t i = 1; i < infos.size(); ++i) {
					const auto& info = infos[i];
					if (info.priority < minPr || (info.priority == minPr && info.startedAt < oldest)) {
						minPr = info.priority;
						minIdx = i;
						oldest = info.startedAt;
					}
				}
				if (priority < minPr) return true;
				m_soundMaster->stop(channel, AudioStopSelector::ByVoice, infos[minIdx].voiceId);
				break;
			}
			case AudioPlaybackMode::Pause: {
				m_soundMaster->pause(channel);
				m_resumeOnNextEndByType[static_cast<size_t>(channel)] = true;
				break;
			}
			case AudioPlaybackMode::Queue: {
				enqueue(channel, AudioEventQueueItem{
					name,
					action.audioId,
					action.modulationPreset,
					std::nullopt,
					priority,
					action.cooldownMs,
					readPayloadString(payload, "actorId"),
					nowMs(),
				});
				return true;
			}
			case AudioPlaybackMode::Stop:
				break;
		}
	}

	if (action.cooldownMs.has_value()) {
		const std::string actorKey = readPayloadString(payload, "actorId").value_or("global");
		const std::string key = name + ":" + actorKey + ":" + action.audioId;
		const f64 now = nowMs();
		const f64 last = m_lastPlayedAt[key];
		if (now - last < action.cooldownMs.value()) {
			return true;
		}
		m_lastPlayedAt[key] = now;
	}

	SoundMasterPlayRequest request;
	request.priority = priority;
	if (action.modulationPreset.has_value()) {
		request.modulationPreset = action.modulationPreset;
	}
	m_soundMaster->play(action.audioId, request);
	return true;
}

void AudioEventManager::playDirect(const AssetId& id, const SoundMasterPlayRequest& request) {
	m_soundMaster->play(id, request);
}

AudioEventEntry AudioEventManager::parseEventEntry(const std::string& name, const BinValue& value) const {
	if (!value.isObject()) {
		throw std::runtime_error("Audio event entry is not an object: " + name);
	}
	const auto& obj = value.asObject();
	AudioEventEntry entry;
	entry.name = name;

	auto chIt = obj.find("channel");
	if (chIt != obj.end() && chIt->second.isString()) {
		entry.channel = audioTypeFromString(chIt->second.asString());
	}
	auto maxIt = obj.find("max_voices");
	if (maxIt != obj.end() && maxIt->second.isNumber()) {
		entry.maxVoices = maxIt->second.toI32();
	}
	auto polIt = obj.find("policy");
	if (polIt != obj.end() && polIt->second.isString()) {
		entry.policy = parsePlaybackMode(polIt->second.asString());
	}

	auto rulesIt = obj.find("rules");
	if (rulesIt != obj.end() && rulesIt->second.isArray()) {
		for (const auto& ruleValue : rulesIt->second.asArray()) {
			entry.rules.push_back(parseRule(ruleValue));
		}
	}

	return entry;
}

AudioEventRule AudioEventManager::parseRule(const BinValue& value) const {
	if (!value.isObject()) {
		throw std::runtime_error("Audio event rule is not an object");
	}
	const auto& obj = value.asObject();
	AudioEventRule rule;
	auto whenIt = obj.find("when");
	if (whenIt != obj.end()) {
		rule.when = parseMatcher(whenIt->second);
	}
	auto goIt = obj.find("go");
	if (goIt == obj.end()) {
		throw std::runtime_error("Audio event rule is missing 'go'");
	}
	rule.action = parseActionSpec(goIt->second);
	return rule;
}

AudioActionSpec AudioEventManager::parseActionSpec(const BinValue& value) const {
	if (!value.isObject()) {
		throw std::runtime_error("Audio action spec is not an object");
	}
	const auto& obj = value.asObject();
	AudioActionSpec spec;

	auto transitionIt = obj.find("music_transition");
	if (transitionIt != obj.end() && transitionIt->second.isObject()) {
		spec.kind = AudioActionSpec::Kind::MusicTransition;
		spec.transition = parseMusicTransition(transitionIt->second);
		return spec;
	}

	auto oneOfIt = obj.find("one_of");
	if (oneOfIt != obj.end()) {
		spec.kind = AudioActionSpec::Kind::OneOf;
		spec.oneOf = parseOneOf(value);
		return spec;
	}

	spec.kind = AudioActionSpec::Kind::Action;
	spec.action = parseAction(value);
	return spec;
}

AudioAction AudioEventManager::parseAction(const BinValue& value) const {
	if (!value.isObject()) {
		throw std::runtime_error("Audio action is not an object");
	}
	const auto& obj = value.asObject();
	AudioAction action;
	action.audioId = obj.at("audio_id").asString();
	auto modIt = obj.find("modulation_preset");
	if (modIt != obj.end() && modIt->second.isString()) {
		action.modulationPreset = modIt->second.asString();
	}
	auto prIt = obj.find("priority");
	if (prIt != obj.end() && prIt->second.isNumber()) {
		action.priority = prIt->second.toI32();
	}
	auto cdIt = obj.find("cooldown_ms");
	if (cdIt != obj.end() && cdIt->second.isNumber()) {
		action.cooldownMs = cdIt->second.toI32();
	}
	return action;
}

AudioActionOneOf AudioEventManager::parseOneOf(const BinValue& value) const {
	const auto& obj = value.asObject();
	AudioActionOneOf spec;
	auto itemsIt = obj.find("one_of");
	if (itemsIt == obj.end() || !itemsIt->second.isArray()) {
		throw std::runtime_error("Audio one_of spec missing items");
	}
	bool hasWeighted = false;
	for (const auto& item : itemsIt->second.asArray()) {
		if (item.isString()) {
			AudioActionWeighted weighted;
			weighted.action.audioId = item.asString();
			spec.items.push_back(std::move(weighted));
			continue;
		}
		if (!item.isObject()) {
			throw std::runtime_error("Audio one_of item is not an object");
		}
		const auto& itemObj = item.asObject();
		AudioActionWeighted weighted;
		weighted.action.audioId = itemObj.at("audio_id").asString();
		auto modIt = itemObj.find("modulation_preset");
		if (modIt != itemObj.end() && modIt->second.isString()) {
			weighted.action.modulationPreset = modIt->second.asString();
		}
		auto prIt = itemObj.find("priority");
		if (prIt != itemObj.end() && prIt->second.isNumber()) {
			weighted.action.priority = prIt->second.toI32();
		}
		auto cdIt = itemObj.find("cooldown_ms");
		if (cdIt != itemObj.end() && cdIt->second.isNumber()) {
			weighted.action.cooldownMs = cdIt->second.toI32();
		}
		auto wtIt = itemObj.find("weight");
		if (wtIt != itemObj.end() && wtIt->second.isNumber()) {
			weighted.weight = static_cast<f32>(std::max(0.0, wtIt->second.toNumber()));
			if (weighted.weight != 1.0f) hasWeighted = true;
		}
		spec.items.push_back(std::move(weighted));
	}

	auto pickIt = obj.find("pick");
	if (pickIt != obj.end() && pickIt->second.isString()) {
		spec.pickMode = pickIt->second.asString() == "weighted" ? AudioPickMode::Weighted : AudioPickMode::Uniform;
	} else if (hasWeighted) {
		spec.pickMode = AudioPickMode::Weighted;
	}

	auto avoidIt = obj.find("avoid_repeat");
	if (avoidIt != obj.end() && avoidIt->second.isBool()) {
		spec.avoidRepeat = avoidIt->second.asBool();
	}

	return spec;
}

MusicTransitionSpec AudioEventManager::parseMusicTransition(const BinValue& value) const {
	const auto& obj = value.asObject();
	MusicTransitionSpec spec;
	spec.audioId = obj.at("audio_id").asString();
	auto syncIt = obj.find("sync");
	if (syncIt != obj.end()) {
		spec.sync = parseMusicSync(syncIt->second);
	}
	auto fadeIt = obj.find("fade_ms");
	if (fadeIt != obj.end() && fadeIt->second.isNumber()) {
		spec.fadeMs = fadeIt->second.toI32();
	}
	auto loopIt = obj.find("start_at_loop_start");
	if (loopIt != obj.end() && loopIt->second.isBool()) {
		spec.startAtLoopStart = loopIt->second.asBool();
	}
	auto freshIt = obj.find("start_fresh");
	if (freshIt != obj.end() && freshIt->second.isBool()) {
		spec.startFresh = freshIt->second.asBool();
	}
	return spec;
}

MusicTransitionSync AudioEventManager::parseMusicSync(const BinValue& value) const {
	MusicTransitionSync sync;
	if (value.isString()) {
		const std::string& str = value.asString();
		if (str == "loop") {
			sync.kind = MusicTransitionSync::Kind::Loop;
		} else {
			sync.kind = MusicTransitionSync::Kind::Immediate;
		}
		return sync;
	}
	if (!value.isObject()) {
		return sync;
	}
	const auto& obj = value.asObject();
	auto delayIt = obj.find("delay_ms");
	if (delayIt != obj.end() && delayIt->second.isNumber()) {
		sync.kind = MusicTransitionSync::Kind::Delay;
		sync.delayMs = delayIt->second.toI32();
		return sync;
	}
	auto stIt = obj.find("stinger");
	if (stIt != obj.end() && stIt->second.isString()) {
		sync.kind = MusicTransitionSync::Kind::Stinger;
		sync.stinger = stIt->second.asString();
		auto returnIt = obj.find("return_to");
		if (returnIt != obj.end() && returnIt->second.isString()) {
			sync.returnTo = returnIt->second.asString();
		}
		auto prevIt = obj.find("return_to_previous");
		if (prevIt != obj.end() && prevIt->second.isBool()) {
			sync.returnToPrevious = prevIt->second.asBool();
		}
	}
	return sync;
}

AudioCaseMatcher AudioEventManager::parseMatcher(const BinValue& value) const {
	AudioCaseMatcher matcher;
	if (!value.isObject()) {
		return matcher;
	}
	const auto& obj = value.asObject();

	auto equalsIt = obj.find("equals");
	if (equalsIt != obj.end() && equalsIt->second.isObject()) {
		for (const auto& [key, val] : equalsIt->second.asObject()) {
			matcher.equals.emplace_back(key, val);
		}
	}

	auto anyOfIt = obj.find("any_of");
	if (anyOfIt != obj.end() && anyOfIt->second.isObject()) {
		for (const auto& [key, val] : anyOfIt->second.asObject()) {
			if (!val.isArray()) continue;
			matcher.anyOf.emplace_back(key, val.asArray());
		}
	}

	auto inIt = obj.find("in");
	if (inIt != obj.end() && inIt->second.isObject()) {
		for (const auto& [key, val] : inIt->second.asObject()) {
			if (!val.isArray()) continue;
			matcher.anyOf.emplace_back(key, val.asArray());
		}
	}

	auto tagIt = obj.find("has_tag");
	if (tagIt != obj.end() && tagIt->second.isArray()) {
		for (const auto& val : tagIt->second.asArray()) {
			if (val.isString()) {
				matcher.requiredTags.push_back(val.asString());
			}
		}
	}

	auto andIt = obj.find("and");
	if (andIt != obj.end() && andIt->second.isArray()) {
		for (const auto& val : andIt->second.asArray()) {
			matcher.andMatchers.push_back(parseMatcher(val));
		}
	}

	auto orIt = obj.find("or");
	if (orIt != obj.end() && orIt->second.isArray()) {
		for (const auto& val : orIt->second.asArray()) {
			matcher.orMatchers.push_back(parseMatcher(val));
		}
	}

	auto notIt = obj.find("not");
	if (notIt != obj.end()) {
		matcher.notMatcher = std::make_shared<AudioCaseMatcher>(parseMatcher(notIt->second));
	}

	return matcher;
}

bool AudioEventManager::ruleMatches(const AudioCaseMatcher& matcher, const Value& payload) const {
	const Table* payloadTable = nullptr;
	if (auto* t = std::get_if<std::shared_ptr<Table>>(&payload)) {
		payloadTable = t->get();
	}

	for (const auto& [key, expected] : matcher.equals) {
		if (!payloadTable) return false;
		Value actual = payloadTable->getString(key);
		if (!valueEquals(expected, actual)) return false;
	}

	for (const auto& entry : matcher.anyOf) {
		if (!payloadTable) return false;
		Value actual = payloadTable->getString(entry.first);
		if (!matchesAnyOf(entry.second, actual)) return false;
	}

	if (!matcher.requiredTags.empty()) {
		if (!payloadTable) return false;
		Value tagsVal = payloadTable->getString("tags");
		if (!std::holds_alternative<std::shared_ptr<Table>>(tagsVal)) return false;
		auto tagsTable = std::get<std::shared_ptr<Table>>(tagsVal);
		const int len = tagsTable->length();
		for (const auto& tag : matcher.requiredTags) {
			bool found = false;
			for (int i = 1; i <= len; ++i) {
				Value v = tagsTable->get(static_cast<double>(i));
				if (auto* s = std::get_if<StringValue>(&v)) {
					if ((*s)->value == tag) { found = true; break; }
				}
			}
			if (!found) return false;
		}
	}

	for (const auto& sub : matcher.andMatchers) {
		if (!ruleMatches(sub, payload)) return false;
	}

	if (matcher.notMatcher && ruleMatches(*matcher.notMatcher, payload)) return false;

	if (!matcher.orMatchers.empty()) {
		bool any = false;
		for (const auto& sub : matcher.orMatchers) {
			if (ruleMatches(sub, payload)) { any = true; break; }
		}
		if (!any) return false;
	}

	return true;
}

bool AudioEventManager::valueEquals(const BinValue& expected, const Value& actual) const {
	if (expected.isNull()) return isNil(actual);
	if (expected.isBool()) {
		if (auto* b = std::get_if<bool>(&actual)) return expected.asBool() == *b;
		return false;
	}
	if (expected.isNumber()) {
		if (auto* n = std::get_if<double>(&actual)) return expected.toNumber() == *n;
		return false;
	}
	if (expected.isString()) {
		if (auto* s = std::get_if<StringValue>(&actual)) return expected.asString() == (*s)->value;
		return false;
	}
	return false;
}

bool AudioEventManager::matchesAnyOf(const std::vector<BinValue>& expected, const Value& actual) const {
	if (std::holds_alternative<std::shared_ptr<Table>>(actual)) {
		auto table = std::get<std::shared_ptr<Table>>(actual);
		const int len = table->length();
		for (int i = 1; i <= len; ++i) {
			Value v = table->get(static_cast<double>(i));
			for (const auto& exp : expected) {
				if (valueEquals(exp, v)) return true;
			}
		}
		return false;
	}
	for (const auto& exp : expected) {
		if (valueEquals(exp, actual)) return true;
	}
	return false;
}

std::optional<std::string> AudioEventManager::readPayloadString(const Value& payload, const std::string& key) const {
	if (!std::holds_alternative<std::shared_ptr<Table>>(payload)) return std::nullopt;
	Value v = std::get<std::shared_ptr<Table>>(payload)->getString(key);
	if (auto* s = std::get_if<StringValue>(&v)) return (*s)->value;
	return std::nullopt;
}

std::optional<ModulationInput> AudioEventManager::readPayloadModulation(const Value& payload, const std::string& key) const {
	if (!std::holds_alternative<std::shared_ptr<Table>>(payload)) return std::nullopt;
	Value v = std::get<std::shared_ptr<Table>>(payload)->getString(key);
	if (!std::holds_alternative<std::shared_ptr<Table>>(v)) return std::nullopt;
	auto table = std::get<std::shared_ptr<Table>>(v);
	ModulationInput input;
	auto readNum = [&](const std::string& field, std::optional<f32>& out) {
		Value val = table->getString(field);
		if (isNil(val)) return;
		if (auto* n = std::get_if<double>(&val)) {
			out = static_cast<f32>(*n);
			return;
		}
		throw std::runtime_error("Modulation param '" + field + "' is not a number");
	};
	auto readRange = [&](const std::string& field, std::optional<ModulationRange>& out) {
		Value val = table->getString(field);
		if (isNil(val)) return;
		if (!std::holds_alternative<std::shared_ptr<Table>>(val)) {
			throw std::runtime_error("Modulation range '" + field + "' is not an array");
		}
		auto arr = std::get<std::shared_ptr<Table>>(val);
		if (arr->length() < 2) {
			throw std::runtime_error("Modulation range '" + field + "' is missing bounds");
		}
		Value v0 = arr->get(1.0);
		Value v1 = arr->get(2.0);
		if (!std::holds_alternative<double>(v0) || !std::holds_alternative<double>(v1)) {
			throw std::runtime_error("Modulation range '" + field + "' bounds are not numbers");
		}
		out = ModulationRange{static_cast<f32>(std::get<double>(v0)), static_cast<f32>(std::get<double>(v1))};
	};

	readNum("pitchDelta", input.pitchDelta);
	readNum("volumeDelta", input.volumeDelta);
	readNum("offset", input.offset);
	readNum("playbackRate", input.playbackRate);
	readRange("pitchRange", input.pitchRange);
	readRange("volumeRange", input.volumeRange);
	readRange("offsetRange", input.offsetRange);
	readRange("playbackRateRange", input.playbackRateRange);
	return input;
}

std::optional<AudioAction> AudioEventManager::pickAction(const std::string& eventName, const AudioEventEntry& entry, const Value& payload) {
	for (size_t i = 0; i < entry.rules.size(); ++i) {
		const auto& rule = entry.rules[i];
		if (!ruleMatches(rule.when, payload)) continue;
		if (rule.action.kind == AudioActionSpec::Kind::Action) {
			return rule.action.action;
		}
		if (rule.action.kind == AudioActionSpec::Kind::OneOf) {
			const auto& spec = rule.action.oneOf;
			if (spec.items.empty()) return std::nullopt;
			std::vector<f32> weights;
			weights.reserve(spec.items.size());
			for (const auto& item : spec.items) weights.push_back(item.weight);
			const std::string actorKey = readPayloadString(payload, "actorId").value_or("global");
			const std::string ruleKey = eventName + "#" + std::to_string(i) + "#" + actorKey;
			std::optional<size_t> lastIndex;
			auto lastIt = m_lastRandomPickByRule.find(ruleKey);
			if (lastIt != m_lastRandomPickByRule.end()) lastIndex = lastIt->second;

			size_t pick = 0;
			if (spec.pickMode == AudioPickMode::Weighted) {
				pick = pickWeightedIndex(weights, spec.avoidRepeat ? lastIndex : std::nullopt);
			} else {
				pick = pickUniformIndex(spec.items.size(), spec.avoidRepeat ? lastIndex : std::nullopt);
			}
			m_lastRandomPickByRule[ruleKey] = pick;
			return spec.items[pick].action;
		}
	}
	return std::nullopt;
}

size_t AudioEventManager::pickUniformIndex(size_t n, std::optional<size_t> avoid) const {
	if (n <= 1) return 0;
	size_t idx = static_cast<size_t>(m_unitDist(m_rng) * n);
	if (avoid.has_value() && idx == avoid.value()) {
		idx = (idx + 1 + static_cast<size_t>(m_unitDist(m_rng) * (n - 1))) % n;
	}
	return idx;
}

size_t AudioEventManager::pickWeightedIndex(const std::vector<f32>& weights, std::optional<size_t> avoid) const {
	const size_t n = weights.size();
	if (n <= 1) return 0;
	if (m_weightScratch.size() < n) m_weightScratch.resize(n);
	f32 total = 0.0f;
	for (size_t i = 0; i < n; ++i) {
		f32 w = std::max(0.0f, weights[i]);
		if (avoid.has_value() && avoid.value() == i && n > 1) w = 0.0f;
		m_weightScratch[i] = w;
		total += w;
	}
	if (total <= 0.0f) {
		return pickUniformIndex(n, avoid);
	}
	f32 r = m_unitDist(m_rng) * total;
	for (size_t i = 0; i < n; ++i) {
		r -= m_weightScratch[i];
		if (r <= 0.0f) return i;
	}
	return n - 1;
}

void AudioEventManager::enqueue(AudioType type, AudioEventQueueItem item) {
	const size_t idx = static_cast<size_t>(type);
	item.enqueuedAt = nowMs();
	m_queuesByType[idx].push_back(std::move(item));
}

void AudioEventManager::onChannelEnded(AudioType type) {
	const size_t idx = static_cast<size_t>(type);
	if (m_resumeOnNextEndByType[idx]) {
		m_resumeOnNextEndByType[idx] = false;
		auto snapshots = m_soundMaster->drainPausedSnapshots(type);
		for (const auto& snapshot : snapshots) {
			ModulationInput input;
			input.pitchDelta = snapshot.params.pitchDelta;
			input.volumeDelta = snapshot.params.volumeDelta;
			input.offset = static_cast<f32>(snapshot.offset);
			input.playbackRate = snapshot.params.playbackRate;
			SoundMasterPlayRequest request;
			request.params = input;
			request.priority = snapshot.priority;
			m_soundMaster->play(snapshot.id, request);
		}
		return;
	}

	handleQueued(type);
}

void AudioEventManager::handleQueued(AudioType type) {
	const size_t idx = static_cast<size_t>(type);
	auto& queue = m_queuesByType[idx];
	if (queue.empty()) return;
	while (!queue.empty()) {
		const AudioEventQueueItem item = queue.front();
		auto entryIt = m_events.find(item.name);
		if (entryIt == m_events.end()) {
			throw std::runtime_error("Queued audio event missing: " + item.name);
		}
		const i32 maxVoices = entryIt->second.maxVoices.value_or(1);
		if (m_soundMaster->activeCountByType(type) >= static_cast<size_t>(maxVoices)) return;
		queue.erase(queue.begin());

		const std::string actorKey = item.payloadActorId.value_or("global");
		if (item.cooldownMs.has_value()) {
			const std::string key = item.name + ":" + actorKey + ":" + item.audioId;
			const f64 now = nowMs();
			const f64 last = m_lastPlayedAt[key];
			if (now - last < item.cooldownMs.value()) {
				continue;
			}
			m_lastPlayedAt[key] = now;
		}

		SoundMasterPlayRequest request;
		request.priority = item.priority;
		if (item.modulationParams.has_value()) {
			request.params = item.modulationParams;
		} else if (item.modulationPreset.has_value()) {
			request.modulationPreset = item.modulationPreset;
		}
		m_soundMaster->play(item.audioId, request);
	}
}

f64 AudioEventManager::nowMs() const {
	return m_soundMaster->currentTimeSec() * 1000.0;
}

} // namespace bmsx
