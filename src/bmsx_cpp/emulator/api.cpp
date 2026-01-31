#include "api.h"

#include "../core/engine_core.h"
#include "../input/input.h"
#include "../render/shared/render_queues.h"
#include "runtime.h"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <stdexcept>
#include <utility>

namespace bmsx {
namespace {

enum class AudioPlaybackMode {
	Replace,
	Ignore,
	Queue,
	Stop,
	Pause,
};

static const std::array<Color, 16> MSX1_PALETTE = {
	Color::fromRGBA8(0, 0, 0, 0),         Color::fromRGBA8(0, 0, 0, 255),
	Color::fromRGBA8(0, 241, 20, 255),    Color::fromRGBA8(68, 249, 86, 255),
	Color::fromRGBA8(85, 79, 255, 255),   Color::fromRGBA8(128, 111, 255, 255),
	Color::fromRGBA8(250, 80, 51, 255),   Color::fromRGBA8(12, 255, 255, 255),
	Color::fromRGBA8(255, 81, 52, 255),   Color::fromRGBA8(255, 115, 86, 255),
	Color::fromRGBA8(226, 210, 4, 255),   Color::fromRGBA8(242, 217, 71, 255),
	Color::fromRGBA8(4, 212, 19, 255),    Color::fromRGBA8(231, 80, 229, 255),
	Color::fromRGBA8(208, 208, 208, 255), Color::fromRGBA8(255, 255, 255, 255),
};

static const Color& paletteColor(int index) {
	return MSX1_PALETTE[static_cast<size_t>(index)];
}

struct ParsedAudioOptions {
	SoundMasterPlayRequest request;
	std::optional<AudioPlaybackMode> policy;
	std::optional<int> maxVoices;
	std::optional<AudioType> channel;
};

struct AudioQueueItem {
	AssetId id;
	SoundMasterPlayRequest request;
	int maxVoices = 1;
};

static std::array<std::vector<AudioQueueItem>, 3> s_audioQueueByType;
static std::array<bool, 3> s_resumeOnNextEndByType{false, false, false};
static std::array<SubscriptionHandle, 3> s_audioPolicySubscriptions;
static bool s_audioPolicyListenersReady = false;

static size_t audioTypeIndex(AudioType type) {
	return static_cast<size_t>(type);
}

static void onAudioChannelEnded(AudioType type) {
	SoundMaster* soundMaster = EngineCore::instance().soundMaster();
	const size_t idx = audioTypeIndex(type);
	if (s_resumeOnNextEndByType[idx]) {
		s_resumeOnNextEndByType[idx] = false;
		soundMaster->resumeType(type);
		return;
	}
	auto& queue = s_audioQueueByType[idx];
	while (!queue.empty()) {
		AudioQueueItem item = queue.front();
		if (soundMaster->activeCountByType(type) >= static_cast<size_t>(item.maxVoices)) {
			return;
		}
		queue.erase(queue.begin());
		soundMaster->play(item.id, item.request);
	}
}

static void ensureAudioPolicyListeners(SoundMaster* soundMaster) {
	if (s_audioPolicyListenersReady) {
		return;
	}
	s_audioPolicyListenersReady = true;
	s_audioPolicySubscriptions[static_cast<size_t>(AudioType::Sfx)] =
		soundMaster->addEndedListener(AudioType::Sfx, [](const ActiveVoiceInfo&) { onAudioChannelEnded(AudioType::Sfx); });
	s_audioPolicySubscriptions[static_cast<size_t>(AudioType::Music)] =
		soundMaster->addEndedListener(AudioType::Music, [](const ActiveVoiceInfo&) { onAudioChannelEnded(AudioType::Music); });
	s_audioPolicySubscriptions[static_cast<size_t>(AudioType::Ui)] =
		soundMaster->addEndedListener(AudioType::Ui, [](const ActiveVoiceInfo&) { onAudioChannelEnded(AudioType::Ui); });
}

static AudioPlaybackMode parsePlaybackMode(const std::string& value) {
	if (value == "replace") return AudioPlaybackMode::Replace;
	if (value == "ignore") return AudioPlaybackMode::Ignore;
	if (value == "queue") return AudioPlaybackMode::Queue;
	if (value == "stop") return AudioPlaybackMode::Stop;
	if (value == "pause") return AudioPlaybackMode::Pause;
	throw BMSX_RUNTIME_ERROR("Unknown audio policy '" + value + "'");
}

static AudioType parseAudioChannel(const std::string& value) {
	if (value == "sfx") return AudioType::Sfx;
	if (value == "music") return AudioType::Music;
	if (value == "ui") return AudioType::Ui;
	throw BMSX_RUNTIME_ERROR("Unknown audio channel '" + value + "'");
}

static TextAlign parseTextAlign(const std::string& value) {
	if (value == "left") return TextAlign::Left;
	if (value == "right") return TextAlign::Right;
	if (value == "center") return TextAlign::Center;
	if (value == "start") return TextAlign::Start;
	if (value == "end") return TextAlign::End;
	throw BMSX_RUNTIME_ERROR("Unknown text align '" + value + "'");
}

static TextBaseline parseTextBaseline(const std::string& value) {
	if (value == "top") return TextBaseline::Top;
	if (value == "hanging") return TextBaseline::Hanging;
	if (value == "middle") return TextBaseline::Middle;
	if (value == "alphabetic") return TextBaseline::Alphabetic;
	if (value == "ideographic") return TextBaseline::Ideographic;
	if (value == "bottom") return TextBaseline::Bottom;
	throw BMSX_RUNTIME_ERROR("Unknown text baseline '" + value + "'");
}

static bool hasModulationFields(const Table& table) {
	auto key = [](std::string_view name) {
		return Runtime::instance().canonicalizeIdentifier(name);
	};
	if (!isNil(table.get(key("pitchDelta")))) return true;
	if (!isNil(table.get(key("volumeDelta")))) return true;
	if (!isNil(table.get(key("offset")))) return true;
	if (!isNil(table.get(key("playbackRate")))) return true;
	if (!isNil(table.get(key("pitchRange")))) return true;
	if (!isNil(table.get(key("volumeRange")))) return true;
	if (!isNil(table.get(key("offsetRange")))) return true;
	if (!isNil(table.get(key("playbackRateRange")))) return true;
	if (!isNil(table.get(key("filter")))) return true;
	return false;
}

static ModulationInput parseModulationInputTable(const Table& table) {
	auto key = [](std::string_view name) {
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

static ParsedAudioOptions parseAudioOptions(const Value& value) {
	ParsedAudioOptions out;
	if (isNil(value)) {
		return out;
	}
	if (!valueIsTable(value)) {
		throw BMSX_RUNTIME_ERROR("audio options must be a table");
	}
	const Table& table = *asTable(value);
	auto key = [](std::string_view name) {
		return Runtime::instance().canonicalizeIdentifier(name);
	};
	auto valueString = [](Value v) -> const std::string& {
		return Runtime::instance().cpu().stringPool().toString(asStringId(v));
	};

	Value channelVal = table.get(key("channel"));
	if (!isNil(channelVal)) {
		if (!valueIsString(channelVal)) {
			throw BMSX_RUNTIME_ERROR("audio channel must be a string");
		}
		out.channel = parseAudioChannel(valueString(channelVal));
	}

	Value policyVal = table.get(key("policy"));
	if (!isNil(policyVal)) {
		if (!valueIsString(policyVal)) {
			throw BMSX_RUNTIME_ERROR("audio policy must be a string");
		}
		out.policy = parsePlaybackMode(valueString(policyVal));
	}

	Value maxVal = table.get(key("max_voices"));
	if (!isNil(maxVal)) {
		if (!valueIsNumber(maxVal)) {
			throw BMSX_RUNTIME_ERROR("max_voices must be a number");
		}
		out.maxVoices = static_cast<int>(std::floor(valueToNumber(maxVal)));
	}

	Value priorityVal = table.get(key("priority"));
	if (!isNil(priorityVal)) {
		if (!valueIsNumber(priorityVal)) {
			throw BMSX_RUNTIME_ERROR("priority must be a number");
		}
		out.request.priority = static_cast<i32>(std::floor(valueToNumber(priorityVal)));
	}

	Value modulationParamsVal = table.get(key("modulation_params"));
	Value paramsVal = table.get(key("params"));
	Value modulationPresetVal = table.get(key("modulation_preset"));

	if (!isNil(modulationParamsVal)) {
		if (!valueIsTable(modulationParamsVal)) {
			throw BMSX_RUNTIME_ERROR("modulation_params must be a table");
		}
		out.request.params = parseModulationInputTable(*asTable(modulationParamsVal));
	} else if (!isNil(paramsVal)) {
		if (!valueIsTable(paramsVal)) {
			throw BMSX_RUNTIME_ERROR("params must be a table");
		}
		out.request.params = parseModulationInputTable(*asTable(paramsVal));
	} else if (hasModulationFields(table)) {
		out.request.params = parseModulationInputTable(table);
	}

	if (!out.request.params.has_value() && !isNil(modulationPresetVal)) {
		if (!valueIsString(modulationPresetVal)) {
			throw BMSX_RUNTIME_ERROR("modulation_preset must be a string");
		}
		out.request.modulationPreset = valueString(modulationPresetVal);
	}

	return out;
}

static MusicTransitionSync parseMusicSyncValue(const Value& value) {
	MusicTransitionSync sync;
	if (isNil(value)) {
		return sync;
	}
	auto key = [](std::string_view name) {
		return Runtime::instance().canonicalizeIdentifier(name);
	};
	auto valueString = [](Value v) -> const std::string& {
		return Runtime::instance().cpu().stringPool().toString(asStringId(v));
	};
	if (valueIsString(value)) {
		const std::string& text = valueString(value);
		if (text == "loop") {
			sync.kind = MusicTransitionSync::Kind::Loop;
		} else {
			sync.kind = MusicTransitionSync::Kind::Immediate;
		}
		return sync;
	}
	if (!valueIsTable(value)) {
		throw BMSX_RUNTIME_ERROR("music sync must be a string or table");
	}
	const Table& table = *asTable(value);
	Value delayVal = table.get(key("delay_ms"));
	if (!isNil(delayVal)) {
		if (!valueIsNumber(delayVal)) {
			throw BMSX_RUNTIME_ERROR("sync.delay_ms must be a number");
		}
		sync.kind = MusicTransitionSync::Kind::Delay;
		sync.delayMs = static_cast<i32>(std::floor(valueToNumber(delayVal)));
		return sync;
	}
	Value stingerVal = table.get(key("stinger"));
	if (!isNil(stingerVal)) {
		if (!valueIsString(stingerVal)) {
			throw BMSX_RUNTIME_ERROR("sync.stinger must be a string");
		}
		sync.kind = MusicTransitionSync::Kind::Stinger;
		sync.stinger = valueString(stingerVal);
		Value returnVal = table.get(key("return_to"));
		if (!isNil(returnVal)) {
			if (!valueIsString(returnVal)) {
				throw BMSX_RUNTIME_ERROR("sync.return_to must be a string");
			}
			sync.returnTo = valueString(returnVal);
		}
		Value prevVal = table.get(key("return_to_previous"));
		if (!isNil(prevVal)) {
			if (!valueIsBool(prevVal)) {
				throw BMSX_RUNTIME_ERROR("sync.return_to_previous must be a boolean");
			}
			sync.returnToPrevious = valueToBool(prevVal);
		}
	}
	return sync;
}

static std::optional<MusicTransitionRequest> parseMusicTransition(const Value& value, const std::string& id) {
	if (isNil(value)) {
		return std::nullopt;
	}
	if (!valueIsTable(value)) {
		throw BMSX_RUNTIME_ERROR("music options must be a table");
	}
	const Table& table = *asTable(value);
	auto key = [](std::string_view name) {
		return Runtime::instance().canonicalizeIdentifier(name);
	};
	auto valueString = [](Value v) -> const std::string& {
		return Runtime::instance().cpu().stringPool().toString(asStringId(v));
	};

	Value syncVal = table.get(key("sync"));
	Value fadeVal = table.get(key("fade_ms"));
	Value loopVal = table.get(key("start_at_loop_start"));
	Value freshVal = table.get(key("start_fresh"));
	Value audioIdVal = table.get(key("audio_id"));
	const bool hasTransition = !isNil(syncVal) || !isNil(fadeVal) || !isNil(loopVal) || !isNil(freshVal) || !isNil(audioIdVal);
	if (!hasTransition) {
		return std::nullopt;
	}

	MusicTransitionRequest request;
	if (!id.empty()) {
		request.to = id;
	} else if (!isNil(audioIdVal)) {
		if (!valueIsString(audioIdVal)) {
			throw BMSX_RUNTIME_ERROR("music_transition.audio_id must be a string");
		}
		request.to = valueString(audioIdVal);
	} else {
		throw BMSX_RUNTIME_ERROR("music_transition.audio_id is required");
	}

	if (!isNil(syncVal)) {
		request.sync = parseMusicSyncValue(syncVal);
	}
	if (!isNil(fadeVal)) {
		if (!valueIsNumber(fadeVal)) {
			throw BMSX_RUNTIME_ERROR("music_transition.fade_ms must be a number");
		}
		request.fadeMs = static_cast<i32>(std::floor(valueToNumber(fadeVal)));
	}
	if (!isNil(loopVal)) {
		if (!valueIsBool(loopVal)) {
			throw BMSX_RUNTIME_ERROR("music_transition.start_at_loop_start must be a boolean");
		}
		request.startAtLoopStart = valueToBool(loopVal);
	}
	if (!isNil(freshVal)) {
		if (!valueIsBool(freshVal)) {
			throw BMSX_RUNTIME_ERROR("music_transition.start_fresh must be a boolean");
		}
		request.startFresh = valueToBool(freshVal);
	}
	return request;
}

static void playWithPolicy(AudioType type, const AssetId& id, const ParsedAudioOptions& options) {
	SoundMaster* soundMaster = EngineCore::instance().soundMaster();
	const RuntimeAssets& assets = EngineCore::instance().assets();
	const AudioAsset* asset = assets.getAudio(id);
	if (!asset) {
		throw BMSX_RUNTIME_ERROR("Audio asset '" + id + "' not found.");
	}
	SoundMasterPlayRequest request = options.request;
	const i32 priority = request.priority.has_value() ? request.priority.value() : asset->meta.priority;
	request.priority = priority;

	const AudioPlaybackMode policy = options.policy.value_or(AudioPlaybackMode::Replace);
	const int maxVoices = options.maxVoices.value_or(1);
	if (maxVoices < 1) {
		throw BMSX_RUNTIME_ERROR("max_voices must be at least 1");
	}

	if (policy == AudioPlaybackMode::Stop) {
		soundMaster->stop(type, AudioStopSelector::All);
		s_audioQueueByType[audioTypeIndex(type)].clear();
		return;
	}

	const size_t active = soundMaster->activeCountByType(type);
	if (active >= static_cast<size_t>(maxVoices)) {
		if (policy == AudioPlaybackMode::Ignore) {
			return;
		}
		if (policy == AudioPlaybackMode::Replace) {
			const std::vector<ActiveVoiceInfo> infos = soundMaster->getActiveVoiceInfosByType(type);
			if (infos.empty()) {
				throw BMSX_RUNTIME_ERROR("No active voices returned for audio channel");
			}
			size_t minIdx = 0;
			i32 minPr = infos[0].priority;
			f64 oldestStart = infos[0].startedAt;
			for (size_t i = 1; i < infos.size(); ++i) {
				const auto& info = infos[i];
				if (info.priority < minPr || (info.priority == minPr && info.startedAt < oldestStart)) {
					minPr = info.priority;
					minIdx = i;
					oldestStart = info.startedAt;
				}
			}
			if (priority < minPr) {
				return;
			}
			const auto& victim = infos[minIdx];
			soundMaster->stop(type, AudioStopSelector::ByVoice, victim.voiceId);
		}
		if (policy == AudioPlaybackMode::Pause) {
			ensureAudioPolicyListeners(soundMaster);
			soundMaster->pause(type);
			s_resumeOnNextEndByType[audioTypeIndex(type)] = true;
		}
		if (policy == AudioPlaybackMode::Queue) {
			ensureAudioPolicyListeners(soundMaster);
			s_audioQueueByType[audioTypeIndex(type)].push_back(AudioQueueItem{ id, request, maxVoices });
			return;
		}
	}

	soundMaster->play(id, request);
}

} // namespace

Api::Api(Runtime& runtime)
	: m_runtime(runtime)
	, m_persistentData(PERSISTENT_DATA_SIZE, 0.0)
{
	m_font = std::make_unique<Font>(EngineCore::instance().assets());
	reset_print_cursor();
}

Api::~Api() = default;

void Api::registerAllFunctions() {
	auto readOptionalInt = [](const std::vector<Value>& args, size_t index) -> std::optional<int> {
		if (args.size() <= index || isNil(args[index])) {
			return std::nullopt;
		}
		return static_cast<int>(std::floor(asNumber(args[index])));
	};
	auto key = [this](std::string_view name) {
		return m_runtime.canonicalizeIdentifier(name);
	};
	auto asText = [this](Value value) -> const std::string& {
		return m_runtime.cpu().stringPool().toString(asStringId(value));
	};

m_runtime.registerNativeFunction("display_width", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	out.push_back(valueNumber(static_cast<double>(display_width())));
});

m_runtime.registerNativeFunction("display_height", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	out.push_back(valueNumber(static_cast<double>(display_height())));
});

m_runtime.registerNativeFunction("stat", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	int index = static_cast<int>(std::floor(asNumber(args.at(0))));
	out.push_back(valueNumber(stat(index)));
});

m_runtime.registerNativeFunction("cls", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	int colorIndex = args.empty() ? 0 : static_cast<int>(std::floor(asNumber(args.at(0))));
	cls(colorIndex);
	(void)out;
});

m_runtime.registerNativeFunction("put_rect", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	int x0 = static_cast<int>(std::floor(asNumber(args.at(0))));
	int y0 = static_cast<int>(std::floor(asNumber(args.at(1))));
	int x1 = static_cast<int>(std::floor(asNumber(args.at(2))));
	int y1 = static_cast<int>(std::floor(asNumber(args.at(3))));
	int z = static_cast<int>(std::floor(asNumber(args.at(4))));
	int colorIndex = static_cast<int>(std::floor(asNumber(args.at(5))));
	put_rect(x0, y0, x1, y1, z, colorIndex);
	(void)out;
});

m_runtime.registerNativeFunction("put_rectfill", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	int x0 = static_cast<int>(std::floor(asNumber(args.at(0))));
	int y0 = static_cast<int>(std::floor(asNumber(args.at(1))));
	int x1 = static_cast<int>(std::floor(asNumber(args.at(2))));
	int y1 = static_cast<int>(std::floor(asNumber(args.at(3))));
	int z = static_cast<int>(std::floor(asNumber(args.at(4))));
	int colorIndex = static_cast<int>(std::floor(asNumber(args.at(5))));
	put_rectfill(x0, y0, x1, y1, z, colorIndex);
	(void)out;
});

m_runtime.registerNativeFunction("put_rectfillcolor", [this, key](const std::vector<Value>& args, std::vector<Value>& out) {
	int x0 = static_cast<int>(std::floor(asNumber(args.at(0))));
	int y0 = static_cast<int>(std::floor(asNumber(args.at(1))));
	int x1 = static_cast<int>(std::floor(asNumber(args.at(2))));
	int y1 = static_cast<int>(std::floor(asNumber(args.at(3))));
	int z = static_cast<int>(std::floor(asNumber(args.at(4))));
	Color color = resolve_color(args.at(5));
	std::optional<RenderLayer> layer;
	if (args.size() > 6) {
		const Value optionsValue = args.at(6);
		if (!isNil(optionsValue)) {
			if (!valueIsTable(optionsValue)) {
				throw BMSX_RUNTIME_ERROR("put_rectfillcolor options must be a table.");
			}
			auto* options = asTable(optionsValue);
			Value layerValue = options->get(key("layer"));
			if (!isNil(layerValue)) {
				layer = resolve_layer(layerValue);
			}
		}
	}
	put_rectfillcolor(x0, y0, x1, y1, z, color, layer);
	(void)out;
});

m_runtime.registerNativeFunction("put_sprite", [this, key, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& imgId = asText(args.at(0));
	float x = static_cast<float>(asNumber(args.at(1)));
	float y = static_cast<float>(asNumber(args.at(2)));
		float z = static_cast<float>(asNumber(args.at(3)));
		ImgRenderSubmission submission;
		submission.imgid = imgId;
		submission.pos = {x, y, z};
		submission.scale = {1.0f, 1.0f};

		if (args.size() > 4 && valueIsTable(args[4])) {
			auto* options = asTable(args[4]);
			Value scaleValue = options->get(key("scale"));
			if (!isNil(scaleValue)) {
				if (valueIsNumber(scaleValue)) {
					float scale = static_cast<float>(asNumber(scaleValue));
					submission.scale = {scale, scale};
				} else if (valueIsTable(scaleValue)) {
					auto* scaleTable = asTable(scaleValue);
					float scaleX = static_cast<float>(asNumber(scaleTable->get(key("x"))));
					float scaleY = static_cast<float>(asNumber(scaleTable->get(key("y"))));
					submission.scale = {scaleX, scaleY};
				}
			}
			Value flipH = options->get(key("flip_h"));
			Value flipV = options->get(key("flip_v"));
			if (!isNil(flipH) || !isNil(flipV)) {
				FlipOptions flip;
				flip.flip_h = valueIsBool(flipH) && valueToBool(flipH);
				flip.flip_v = valueIsBool(flipV) && valueToBool(flipV);
				submission.flip = flip;
			}
			Value colorizeValue = options->get(key("colorize"));
			if (!isNil(colorizeValue)) {
				submission.colorize = resolve_color(colorizeValue);
			}
			Value parallaxWeightValue = options->get(key("parallax_weight"));
			if (!isNil(parallaxWeightValue)) {
				submission.parallax_weight = static_cast<float>(asNumber(parallaxWeightValue));
			}
	}

	put_sprite(submission);
	(void)out;
});

m_runtime.registerNativeFunction("put_glyphs", [this, key, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const Value& glyphValue = args.at(0);
	std::vector<std::string> glyphs;
	if (valueIsString(glyphValue)) {
		glyphs.push_back(asText(glyphValue));
		} else {
			auto* tbl = asTable(glyphValue);
			int length = tbl->length();
			for (int i = 1; i <= length; ++i) {
				glyphs.push_back(asText(tbl->get(valueNumber(static_cast<double>(i)))));
			}
		}

		float x = static_cast<float>(asNumber(args.at(1)));
		float y = static_cast<float>(asNumber(args.at(2)));
		float z = static_cast<float>(asNumber(args.at(3)));
		GlyphRenderSubmission submission;
		submission.glyphs = std::move(glyphs);
		submission.x = x;
		submission.y = y;
		submission.z = z;
		submission.font = m_font.get();

		if (args.size() > 4 && valueIsTable(args[4])) {
			auto* options = asTable(args[4]);
			Value colorValue = options->get(key("color"));
			if (!isNil(colorValue)) {
				submission.color = resolve_color(colorValue);
			}
			Value backgroundValue = options->get(key("background_color"));
			if (!isNil(backgroundValue)) {
				submission.background_color = resolve_color(backgroundValue);
			}
			Value wrapValue = options->get(key("wrap_chars"));
			if (!isNil(wrapValue)) {
				submission.wrap_chars = static_cast<int>(std::floor(asNumber(wrapValue)));
			}
			Value centerValue = options->get(key("center_block_width"));
			if (!isNil(centerValue)) {
				submission.center_block_width = static_cast<int>(std::floor(asNumber(centerValue)));
			}
			Value startValue = options->get(key("glyph_start"));
			if (!isNil(startValue)) {
				submission.glyph_start = static_cast<int>(std::floor(asNumber(startValue)));
			}
			Value endValue = options->get(key("glyph_end"));
			if (!isNil(endValue)) {
				submission.glyph_end = static_cast<int>(std::floor(asNumber(endValue)));
			}
			Value layerValue = options->get(key("layer"));
			if (!isNil(layerValue)) {
				submission.layer = resolve_layer(layerValue);
			}
	}

	RenderSubmission op{};
	op.type = RenderSubmissionType::Glyphs;
	op.glyphs = submission;
	submit(std::move(op));
	(void)out;
});

m_runtime.registerNativeFunction("put_poly", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	std::vector<f32> points = read_polygon(args.at(0));
	float z = static_cast<float>(asNumber(args.at(1)));
	Color color = resolve_color(args.at(2));
	std::optional<float> thickness;
		std::optional<RenderLayer> layer;
		if (args.size() > 3 && !isNil(args[3])) {
			thickness = static_cast<float>(asNumber(args.at(3)));
		}
		if (args.size() > 4 && !isNil(args[4])) {
			layer = resolve_layer(args.at(4));
		}
		PolyRenderSubmission submission;
		submission.points = std::move(points);
		submission.z = z;
		submission.color = color;
		if (thickness.has_value()) {
			submission.thickness = thickness.value();
		}
	if (layer.has_value()) {
		submission.layer = layer.value();
	}
	put_poly(submission);
	(void)out;
});

m_runtime.registerNativeFunction("put_mesh", [this, key](const std::vector<Value>& args, std::vector<Value>& out) {
	MeshRenderSubmission submission;
	submission.matrix = read_matrix(args.at(1));
	if (args.size() > 2 && valueIsTable(args[2])) {
		auto* options = asTable(args[2]);
			Value receiveShadow = options->get(key("receive_shadow"));
			if (!isNil(receiveShadow)) {
				submission.receive_shadow = valueIsBool(receiveShadow) && valueToBool(receiveShadow);
			}
	}
	put_mesh(submission);
	(void)out;
});

m_runtime.registerNativeFunction("put_particle", [this, key](const std::vector<Value>& args, std::vector<Value>& out) {
	ParticleRenderSubmission submission;
	submission.position = read_vec3(args.at(0));
	submission.size = static_cast<float>(asNumber(args.at(1)));
	submission.color = resolve_color(args.at(2));
		if (args.size() > 3 && valueIsTable(args[3])) {
			auto* options = asTable(args[3]);
			Value ambientMode = options->get(key("ambient_mode"));
			Value ambientFactor = options->get(key("ambient_factor"));
			if (!isNil(ambientMode)) {
				submission.ambient_mode = static_cast<int>(std::floor(asNumber(ambientMode)));
			}
			if (!isNil(ambientFactor)) {
				submission.ambient_factor = static_cast<float>(asNumber(ambientFactor));
			}
	}
	put_particle(submission);
	(void)out;
});

m_runtime.registerNativeFunction("write", [this, readOptionalInt, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& text = asText(args.at(0));
	const Value options = args.size() > 5 ? args.at(5) : valueNil();
	write(text, readOptionalInt(args, 1), readOptionalInt(args, 2), readOptionalInt(args, 3), readOptionalInt(args, 4), options);
	(void)out;
});

m_runtime.registerNativeFunction("write_color", [this, readOptionalInt, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& text = asText(args.at(0));
	Value colorValue = args.size() > 4 ? args.at(4) : valueNil();
	write_color(text, readOptionalInt(args, 1), readOptionalInt(args, 2), readOptionalInt(args, 3), colorValue);
	(void)out;
});

m_runtime.registerNativeFunction("write_with_font", [this, readOptionalInt, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& text = asText(args.at(0));
	write_with_font(text, readOptionalInt(args, 1), readOptionalInt(args, 2), readOptionalInt(args, 3), readOptionalInt(args, 4), m_font.get());
	(void)out;
});

m_runtime.registerNativeFunction("write_inline_with_font", [this, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& text = asText(args.at(0));
	int x = static_cast<int>(std::floor(asNumber(args.at(1))));
	int y = static_cast<int>(std::floor(asNumber(args.at(2))));
	int z = static_cast<int>(std::floor(asNumber(args.at(3))));
	int colorIndex = static_cast<int>(std::floor(asNumber(args.at(4))));
	write_inline_with_font(text, x, y, z, colorIndex, m_font.get());
	(void)out;
});

m_runtime.registerNativeFunction("write_inline_span_with_font", [this, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& text = asText(args.at(0));
	int start = static_cast<int>(std::floor(asNumber(args.at(1))));
	int end = static_cast<int>(std::floor(asNumber(args.at(2))));
		int x = static_cast<int>(std::floor(asNumber(args.at(3))));
	int y = static_cast<int>(std::floor(asNumber(args.at(4))));
	int z = static_cast<int>(std::floor(asNumber(args.at(5))));
	int colorIndex = static_cast<int>(std::floor(asNumber(args.at(6))));
	write_inline_span_with_font(text, start, end, x, y, z, colorIndex, m_font.get());
	(void)out;
});

m_runtime.registerNativeFunction("action_triggered", [this, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& action = asText(args.at(0));
	std::optional<int> playerIndex;
	if (args.size() > 1 && !isNil(args[1])) {
		playerIndex = static_cast<int>(std::floor(asNumber(args.at(1))));
	}
	out.push_back(valueBool(action_triggered(action, playerIndex)));
});

m_runtime.registerNativeFunction("consume_action", [this, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)out;
	std::optional<int> playerIndex;
	Value actionVal;
	if (args.size() == 1) {
		actionVal = args.at(0);
	} else {
		if (!isNil(args[0])) {
			playerIndex = static_cast<int>(std::floor(asNumber(args.at(0))));
		}
		actionVal = args.size() > 1 ? args.at(1) : valueNil();
	}
	if (isNil(actionVal)) {
		return;
	}
	std::string action;
	if (valueIsString(actionVal)) {
		action = asText(actionVal);
	} else if (valueIsTable(actionVal)) {
		auto* tbl = asTable(actionVal);
		auto key = [this](std::string_view name) { return m_runtime.canonicalizeIdentifier(name); };
		Value def = tbl->get(key("definition"));
		if (!isNil(def) && valueIsString(def)) {
			action = asText(def);
		} else {
			Value act = tbl->get(key("action"));
			if (!isNil(act) && valueIsString(act)) {
				action = asText(act);
			} else {
				Value name = tbl->get(key("name"));
				if (!isNil(name) && valueIsString(name)) {
					action = asText(name);
				} else {
					throw BMSX_RUNTIME_ERROR("consume_action expects an action string or ActionState");
				}
			}
		}
	} else if (valueIsNativeObject(actionVal)) {
		auto* obj = asNativeObject(actionVal);
		Value def = obj->get(valueNumber(1.0));
		if (!isNil(def) && valueIsString(def)) {
			action = asText(def);
		} else {
			auto key = [this](std::string_view name) { return m_runtime.canonicalizeIdentifier(name); };
			Value def2 = obj->get(key("definition"));
			if (!isNil(def2) && valueIsString(def2)) {
				action = asText(def2);
			} else {
				Value act = obj->get(key("action"));
				if (!isNil(act) && valueIsString(act)) {
					action = asText(act);
				} else {
					throw BMSX_RUNTIME_ERROR("consume_action expects an action string or ActionState");
				}
			}
		}
	} else {
		throw BMSX_RUNTIME_ERROR("consume_action expects an action string or ActionState");
	}
	consume_action(action, playerIndex);
});

m_runtime.registerNativeFunction("cartdata", [this, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& ns = asText(args.at(0));
	cartdata(ns);
	(void)out;
});

m_runtime.registerNativeFunction("dset", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	int index = static_cast<int>(std::floor(asNumber(args.at(0))));
	double value = asNumber(args.at(1));
	dset(index, value);
	(void)out;
});

m_runtime.registerNativeFunction("dget", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	int index = static_cast<int>(std::floor(asNumber(args.at(0))));
	out.push_back(valueNumber(dget(index)));
});

m_runtime.registerNativeFunction("sfx", [this, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& id = asText(args.at(0));
	Value optionsValue = args.size() > 1 ? args.at(1) : valueNil();
	ParsedAudioOptions options = parseAudioOptions(optionsValue);
	AudioType channel = options.channel.value_or(AudioType::Sfx);
	if (channel == AudioType::Music) {
		throw BMSX_RUNTIME_ERROR("sfx does not support music channel");
	}
	playWithPolicy(channel, id, options);
	(void)out;
});

m_runtime.registerNativeFunction("stop_sfx", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	stop_sfx();
	(void)out;
});

m_runtime.registerNativeFunction("music", [this, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	std::string id;
	if (!args.empty() && !isNil(args.at(0))) {
		id = asText(args.at(0));
	}
	Value optionsValue = args.size() > 1 ? args.at(1) : valueNil();
	std::optional<MusicTransitionRequest> transition = parseMusicTransition(optionsValue, id);
	if (transition.has_value()) {
		EngineCore::instance().soundMaster()->requestMusicTransition(transition.value());
		(void)out;
		return;
	}
	if (id.empty()) {
		EngineCore::instance().soundMaster()->stopMusic();
		(void)out;
		return;
	}
	ParsedAudioOptions options = parseAudioOptions(optionsValue);
	if (options.channel.has_value() && options.channel.value() != AudioType::Music) {
		throw BMSX_RUNTIME_ERROR("music does not support non-music channel");
	}
	playWithPolicy(AudioType::Music, id, options);
	(void)out;
});

m_runtime.registerNativeFunction("stop_music", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	stop_music();
	(void)out;
});

m_runtime.registerNativeFunction("set_master_volume", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	double volume = asNumber(args.at(0));
	set_master_volume(volume);
	(void)out;
});

m_runtime.registerNativeFunction("set_sprite_parallax_rig", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	if (args.size() != 9) {
		throw BMSX_RUNTIME_ERROR("set_sprite_parallax_rig expects 9 arguments.");
	}
	float vy = static_cast<float>(asNumber(args.at(0)));
	float scale = static_cast<float>(asNumber(args.at(1)));
	float impact = static_cast<float>(asNumber(args.at(2)));
	float impact_t = static_cast<float>(asNumber(args.at(3)));
	float bias_px = static_cast<float>(asNumber(args.at(4)));
	float parallax_strength = static_cast<float>(asNumber(args.at(5)));
	float scale_strength = static_cast<float>(asNumber(args.at(6)));
	float flip_strength = static_cast<float>(asNumber(args.at(7)));
	float flip_window = static_cast<float>(asNumber(args.at(8)));
	set_sprite_parallax_rig(vy, scale, impact, impact_t, bias_px, parallax_strength, scale_strength, flip_strength, flip_window);
	(void)out;
});

m_runtime.registerNativeFunction("pause_audio", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	pause_audio();
	(void)out;
});

m_runtime.registerNativeFunction("resume_audio", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	resume_audio();
	(void)out;
});

m_runtime.registerNativeFunction("reboot", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	reboot();
	(void)out;
});
}

int Api::display_width() const {
	return static_cast<int>(EngineCore::instance().view()->viewportSize.x);
}

int Api::display_height() const {
	return static_cast<int>(EngineCore::instance().view()->viewportSize.y);
}

double Api::stat(int /*index*/) const {
	throw BMSX_RUNTIME_ERROR("stat is not implemented.");
}

bool Api::isFrameCaptureActive() const {
	return m_frameCaptureActive;
}

void Api::beginFrameCapture() {
	m_frameCaptureActive = true;
	m_frameCommands.clear();
}

void Api::commitFrameCapture() {
	m_frameCaptureActive = false;
	if (m_frameCommands.empty()) {
		return;
	}
	m_frameCommandBuffer.clear();
	m_frameCommandBuffer.swap(m_frameCommands);
	for (const RenderSubmission& submission : m_frameCommandBuffer) {
		submitToRenderer(submission);
	}
}

void Api::abandonFrameCapture() {
	m_frameCaptureActive = false;
	m_frameCommands.clear();
}

void Api::playbackRenderQueue(const std::vector<RenderSubmission>& queue) {
	for (const RenderSubmission& submission : queue) {
		submitToRenderer(submission);
	}
}

void Api::cls(int colorIndex) {
	RectRenderSubmission submission;
	submission.kind = RectRenderSubmission::Kind::Fill;
	submission.area = {0.0f, 0.0f, static_cast<f32>(display_width()), static_cast<f32>(display_height())};
	submission.color = palette_color(colorIndex);
	RenderSubmission op{};
	op.type = RenderSubmissionType::Rect;
	op.rect = submission;
	submit(std::move(op));
	reset_print_cursor();
}

void Api::put_rect(int x0, int y0, int x1, int y1, int z, int colorIndex) {
	RectRenderSubmission submission;
	submission.kind = RectRenderSubmission::Kind::Rect;
	submission.area = {static_cast<f32>(x0), static_cast<f32>(y0), static_cast<f32>(x1), static_cast<f32>(y1), static_cast<f32>(z)};
	submission.color = palette_color(colorIndex);
	RenderSubmission op{};
	op.type = RenderSubmissionType::Rect;
	op.rect = submission;
	submit(std::move(op));
}

void Api::put_rectfill(int x0, int y0, int x1, int y1, int z, int colorIndex) {
	RectRenderSubmission submission;
	submission.kind = RectRenderSubmission::Kind::Fill;
	submission.area = {static_cast<f32>(x0), static_cast<f32>(y0), static_cast<f32>(x1), static_cast<f32>(y1), static_cast<f32>(z)};
	submission.color = palette_color(colorIndex);
	RenderSubmission op{};
	op.type = RenderSubmissionType::Rect;
	op.rect = submission;
	submit(std::move(op));
}

void Api::put_rectfillcolor(int x0, int y0, int x1, int y1, int z, const Color& color, std::optional<RenderLayer> layer) {
	RectRenderSubmission submission;
	submission.kind = RectRenderSubmission::Kind::Fill;
	submission.area = {static_cast<f32>(x0), static_cast<f32>(y0), static_cast<f32>(x1), static_cast<f32>(y1), static_cast<f32>(z)};
	submission.color = color;
	submission.layer = layer;
	RenderSubmission op{};
	op.type = RenderSubmissionType::Rect;
	op.rect = submission;
	submit(std::move(op));
}

void Api::put_sprite(const ImgRenderSubmission& submission) {
	RenderSubmission op{};
	op.type = RenderSubmissionType::Img;
	op.img = submission;
	submit(std::move(op));
}

void Api::put_poly(const PolyRenderSubmission& submission) {
	RenderSubmission op{};
	op.type = RenderSubmissionType::Poly;
	op.poly = submission;
	submit(std::move(op));
}

void Api::put_mesh(const MeshRenderSubmission& submission) {
	RenderSubmission op{};
	op.type = RenderSubmissionType::Mesh;
	op.mesh = submission;
	submit(std::move(op));
}

void Api::put_particle(const ParticleRenderSubmission& submission) {
	RenderSubmission op{};
	op.type = RenderSubmissionType::Particle;
	op.particle = submission;
	submit(std::move(op));
}

void Api::write(const std::string& text, std::optional<int> x, std::optional<int> y,
					std::optional<int> z, std::optional<int> colorIndex, const Value& options) {
	Font* renderFont = m_font.get();
	int baseX = m_textCursorX;
	int baseY = m_textCursorY;
	if (x.has_value() && y.has_value()) {
		m_textCursorHomeX = x.value();
		m_textCursorX = m_textCursorHomeX;
		m_textCursorY = y.value();
		baseX = m_textCursorX;
		baseY = m_textCursorY;
	}
	if (colorIndex.has_value()) {
		m_textCursorColorIndex = colorIndex.value();
	}
	Color color = palette_color(m_textCursorColorIndex);
	std::optional<Color> backgroundColor;
	std::optional<int> wrapChars;
	std::optional<int> centerBlockWidth;
	std::optional<int> glyphStart;
	std::optional<int> glyphEnd;
	std::optional<TextAlign> align;
	std::optional<TextBaseline> baseline;
	std::optional<RenderLayer> layer;
	std::optional<bool> autoAdvance;

	if (!isNil(options)) {
		if (!valueIsTable(options)) {
			throw BMSX_RUNTIME_ERROR("write options must be a table.");
		}
		auto* table = asTable(options);
		auto key = [this](std::string_view name) {
			return m_runtime.canonicalizeIdentifier(name);
		};
		Value colorValue = table->get(key("color"));
		if (!isNil(colorValue)) {
			color = resolve_color(colorValue);
		}
		Value backgroundValue = table->get(key("background_color"));
		if (!isNil(backgroundValue)) {
			backgroundColor = resolve_color(backgroundValue);
		}
		Value wrapValue = table->get(key("wrap_chars"));
		if (!isNil(wrapValue)) {
			wrapChars = static_cast<int>(std::floor(asNumber(wrapValue)));
		}
		Value centerValue = table->get(key("center_block_width"));
		if (!isNil(centerValue)) {
			centerBlockWidth = static_cast<int>(std::floor(asNumber(centerValue)));
		}
		Value startValue = table->get(key("glyph_start"));
		if (!isNil(startValue)) {
			glyphStart = static_cast<int>(std::floor(asNumber(startValue)));
		}
		Value endValue = table->get(key("glyph_end"));
		if (!isNil(endValue)) {
			glyphEnd = static_cast<int>(std::floor(asNumber(endValue)));
		}
		Value alignValue = table->get(key("align"));
		if (!isNil(alignValue)) {
			align = parseTextAlign(m_runtime.cpu().stringPool().toString(asStringId(alignValue)));
		}
		Value baselineValue = table->get(key("baseline"));
		if (!isNil(baselineValue)) {
			baseline = parseTextBaseline(m_runtime.cpu().stringPool().toString(asStringId(baselineValue)));
		}
		Value layerValue = table->get(key("layer"));
		if (!isNil(layerValue)) {
			layer = resolve_layer(layerValue);
		}
		Value autoValue = table->get(key("auto_advance"));
		if (!isNil(autoValue)) {
			autoAdvance = valueIsBool(autoValue) && valueToBool(autoValue);
		}
		Value fontValue = table->get(key("font"));
		if (!isNil(fontValue)) {
			throw BMSX_RUNTIME_ERROR("write options font is not supported in the C++ runtime.");
		}
	}

	const std::string expanded = expand_tabs(text);
	std::vector<std::string> lines;
	if (wrapChars.has_value() && wrapChars.value() > 0) {
		lines = RenderQueues::wrapGlyphs(expanded, wrapChars.value());
	} else {
		size_t start = 0;
		while (true) {
			size_t end = expanded.find('\n', start);
			if (end == std::string::npos) {
				lines.push_back(expanded.substr(start));
				break;
			}
			lines.push_back(expanded.substr(start, end - start));
			start = end + 1;
		}
	}

	GlyphRenderSubmission submission;
	submission.glyphs = std::move(lines);
	submission.x = static_cast<f32>(baseX);
	submission.y = static_cast<f32>(baseY);
	submission.z = static_cast<f32>(z.value_or(0));
	submission.font = renderFont;
	submission.color = color;
	submission.background_color = backgroundColor;
	submission.center_block_width = centerBlockWidth;
	submission.glyph_start = glyphStart;
	submission.glyph_end = glyphEnd;
	submission.align = align;
	submission.baseline = baseline;
	submission.layer = layer;
	RenderSubmission op{};
	op.type = RenderSubmissionType::Glyphs;
	op.glyphs = submission;
	submit(std::move(op));

	const bool shouldAdvance = autoAdvance.value_or(true);
	if (shouldAdvance) {
		const int lineCount = static_cast<int>(submission.glyphs.size());
		m_textCursorY = baseY + ((lineCount - 1) * renderFont->lineHeight());
		advance_print_cursor(renderFont->lineHeight());
	}
}

void Api::write_color(const std::string& text, std::optional<int> x, std::optional<int> y,
						std::optional<int> z, const Value& colorValue) {
	if (x.has_value() && y.has_value()) {
		m_textCursorHomeX = x.value();
		m_textCursorX = m_textCursorHomeX;
		m_textCursorY = y.value();
	}
	if (valueIsNumber(colorValue)) {
		m_textCursorColorIndex = static_cast<int>(std::floor(asNumber(colorValue)));
	}
	Color color = !isNil(colorValue) && !valueIsNumber(colorValue)
		? resolve_color(colorValue)
		: palette_color(m_textCursorColorIndex);
	draw_multiline_text(text, m_textCursorX, m_textCursorY, z.value_or(0), color, *m_font);
	advance_print_cursor(m_font->lineHeight());
}

void Api::write_with_font(const std::string& text, std::optional<int> x, std::optional<int> y,
							std::optional<int> z, std::optional<int> colorIndex, Font* font) {
	Font* renderFont = font ? font : m_font.get();
	int baseX = m_textCursorX;
	int baseY = m_textCursorY;
	if (x.has_value() && y.has_value()) {
		m_textCursorHomeX = x.value();
		m_textCursorX = m_textCursorHomeX;
		m_textCursorY = y.value();
		baseX = m_textCursorX;
		baseY = m_textCursorY;
	}
	if (colorIndex.has_value()) {
		m_textCursorColorIndex = colorIndex.value();
	}
	Color color = palette_color(m_textCursorColorIndex);
	draw_multiline_text(text, baseX, baseY, z.value_or(0), color, *renderFont);
	advance_print_cursor(renderFont->lineHeight());
}

void Api::write_inline_with_font(const std::string& text, int x, int y, int z, int colorIndex, Font* font) {
	GlyphRenderSubmission submission;
	submission.glyphs = {text};
	submission.x = static_cast<f32>(x);
	submission.y = static_cast<f32>(y);
	submission.z = static_cast<f32>(z);
	submission.color = palette_color(colorIndex);
	submission.font = font ? font : m_font.get();
	RenderSubmission op{};
	op.type = RenderSubmissionType::Glyphs;
	op.glyphs = submission;
	submit(std::move(op));
}

void Api::write_inline_span_with_font(const std::string& text, int start, int end,
										int x, int y, int z, int colorIndex, Font* font) {
	GlyphRenderSubmission submission;
	submission.glyphs = {text};
	submission.glyph_start = start;
	submission.glyph_end = end;
	submission.x = static_cast<f32>(x);
	submission.y = static_cast<f32>(y);
	submission.z = static_cast<f32>(z);
	submission.color = palette_color(colorIndex);
	submission.font = font ? font : m_font.get();
	RenderSubmission op{};
	op.type = RenderSubmissionType::Glyphs;
	op.glyphs = submission;
	submit(std::move(op));
}

bool Api::action_triggered(const std::string& actionDefinition, std::optional<int> playerIndex) const {
	int index = playerIndex.has_value() ? playerIndex.value() : m_runtime.playerIndex();
	return EngineCore::instance().action_triggered(index, actionDefinition);
}

void Api::consume_action(const std::string& action, std::optional<int> playerIndex) {
	int index = playerIndex.has_value() ? playerIndex.value() : m_runtime.playerIndex();
	EngineCore::instance().consume_action(index, action);
}

void Api::cartdata(const std::string& ns) {
	m_cartDataNamespace = ns;
}

void Api::dset(int index, double value) {
	m_persistentData.at(static_cast<size_t>(index)) = value;
}

double Api::dget(int index) const {
	return m_persistentData.at(static_cast<size_t>(index));
}

void Api::sfx(const std::string& id) {
	EngineCore::instance().soundMaster()->play(id);
}

void Api::stop_sfx() {
	EngineCore::instance().soundMaster()->stopEffect();
}

void Api::music(const std::string& id) {
	auto* soundMaster = EngineCore::instance().soundMaster();
	if (id.empty()) {
		soundMaster->stopMusic();
		return;
	}
	soundMaster->stopMusic();
	soundMaster->play(id);
}

void Api::stop_music() {
	EngineCore::instance().soundMaster()->stopMusic();
}

void Api::set_master_volume(double volume) {
	EngineCore::instance().soundMaster()->setMasterVolume(static_cast<f32>(volume));
}

void Api::set_sprite_parallax_rig(f32 vy, f32 scale, f32 impact, f32 impact_t,
									f32 bias_px, f32 parallax_strength,
									f32 scale_strength, f32 flip_strength,
									f32 flip_window) {
	EngineCore::instance().view()->setSpriteParallaxRig(
		vy, scale, impact, impact_t, bias_px, parallax_strength, scale_strength,
		flip_strength, flip_window);
}

void Api::pause_audio() {
	EngineCore::instance().soundMaster()->pauseAll();
}

void Api::resume_audio() {
	EngineCore::instance().soundMaster()->resume();
}

void Api::reboot() {
	m_runtime.requestProgramReload();
}

void Api::submit(RenderSubmission submission) {
	if (!m_frameCaptureActive) {
		submitToRenderer(submission);
		return;
	}
	m_frameCommands.push_back(std::move(submission));
}

void Api::submitToRenderer(const RenderSubmission& submission) {
	switch (submission.type) {
		case RenderSubmissionType::Img:
			EngineCore::instance().view()->renderer.submit.sprite(submission.img);
			return;
		case RenderSubmissionType::Mesh:
			EngineCore::instance().view()->renderer.submit.mesh(submission.mesh);
			return;
		case RenderSubmissionType::Particle:
			EngineCore::instance().view()->renderer.submit.particle(submission.particle);
			return;
		case RenderSubmissionType::Poly:
			EngineCore::instance().view()->renderer.submit.poly(submission.poly);
			return;
		case RenderSubmissionType::Rect:
			EngineCore::instance().view()->renderer.submit.rect(submission.rect);
			return;
		case RenderSubmissionType::Glyphs:
			EngineCore::instance().view()->renderer.submit.glyphs(submission.glyphs);
			return;
	}
}

std::string Api::expand_tabs(const std::string& text) const {
	if (text.find('\t') == std::string::npos) {
		return text;
	}
	std::string result;
	for (char ch : text) {
		if (ch == '\t') {
			result.append(2, ' ');
			continue;
		}
		result.push_back(ch);
	}
	return result;
}

void Api::draw_multiline_text(const std::string& text, int x, int y, int z, const Color& color, Font& font) {
	std::string expanded = text;
	size_t start = 0;
	int cursorY = y;
	while (start <= expanded.size()) {
		size_t end = expanded.find('\n', start);
		if (end == std::string::npos) {
			end = expanded.size();
		}
		std::string line = expand_tabs(expanded.substr(start, end - start));
		if (!line.empty()) {
			GlyphRenderSubmission submission;
			submission.glyphs = {line};
			submission.x = static_cast<f32>(x);
			submission.y = static_cast<f32>(cursorY);
			submission.z = static_cast<f32>(z);
			submission.color = color;
			submission.font = &font;
			RenderSubmission op{};
			op.type = RenderSubmissionType::Glyphs;
			op.glyphs = submission;
			submit(std::move(op));
		}
		if (end == expanded.size()) {
			break;
		}
		cursorY += font.lineHeight();
		start = end + 1;
	}
	m_textCursorX = m_textCursorHomeX;
	m_textCursorY = cursorY;
}

void Api::advance_print_cursor(int lineHeight) {
	m_textCursorY += lineHeight;
	int limit = display_height() - lineHeight;
	if (m_textCursorY >= limit) {
		m_textCursorY = 0;
	}
}

void Api::reset_print_cursor() {
	m_textCursorHomeX = 0;
	m_textCursorX = 0;
	m_textCursorY = 0;
	m_textCursorColorIndex = m_defaultPrintColorIndex;
}

Color Api::palette_color(int index) const {
	return paletteColor(index);
}

Color Api::resolve_color(const Value& value) {
	if (valueIsNumber(value)) {
		return palette_color(static_cast<int>(std::floor(asNumber(value))));
	}
	if (!valueIsTable(value)) {
		throw BMSX_RUNTIME_ERROR("Color expects a number or table.");
	}
	auto* tbl = asTable(value);
	Color color;
	color.r = static_cast<f32>(asNumber(tbl->get(m_runtime.canonicalizeIdentifier("r"))));
	color.g = static_cast<f32>(asNumber(tbl->get(m_runtime.canonicalizeIdentifier("g"))));
	color.b = static_cast<f32>(asNumber(tbl->get(m_runtime.canonicalizeIdentifier("b"))));
	color.a = static_cast<f32>(asNumber(tbl->get(m_runtime.canonicalizeIdentifier("a"))));
	return color;
}

RenderLayer Api::resolve_layer(const Value& value) {
	if (valueIsString(value)) {
		const std::string& key = m_runtime.cpu().stringPool().toString(asStringId(value));
		if (key == "ui") return RenderLayer::UI;
		if (key == "ide") return RenderLayer::IDE;
	}
	return RenderLayer::World;
}

std::vector<f32> Api::read_polygon(const Value& value) {
	std::vector<f32> points;
	if (valueIsTable(value)) {
		auto* tbl = asTable(value);
		const int length = tbl->length();
		for (int i = 1; i + 1 <= length; i += 2) {
			float x = static_cast<float>(asNumber(tbl->get(valueNumber(static_cast<double>(i)))));
			float y = static_cast<float>(asNumber(tbl->get(valueNumber(static_cast<double>(i + 1)))));
			points.push_back(x);
			points.push_back(y);
		}
		return points;
	}
	if (valueIsNativeObject(value)) {
		auto* obj = asNativeObject(value);
		for (int i = 1; ; i += 2) {
			Value xValue = obj->get(valueNumber(static_cast<double>(i)));
			Value yValue = obj->get(valueNumber(static_cast<double>(i + 1)));
			if (isNil(xValue) || isNil(yValue)) {
				break;
			}
			float x = static_cast<float>(asNumber(xValue));
			float y = static_cast<float>(asNumber(yValue));
			points.push_back(x);
			points.push_back(y);
		}
		return points;
	}
	throw BMSX_RUNTIME_ERROR("put_poly expects a table or native object.");
}

Vec3 Api::read_vec3(const Value& value) {
	if (valueIsTable(value)) {
		auto* tbl = asTable(value);
		Vec3 out;
		out.x = static_cast<f32>(asNumber(tbl->get(m_runtime.canonicalizeIdentifier("x"))));
		out.y = static_cast<f32>(asNumber(tbl->get(m_runtime.canonicalizeIdentifier("y"))));
		out.z = static_cast<f32>(asNumber(tbl->get(m_runtime.canonicalizeIdentifier("z"))));
		return out;
	}
	if (valueIsNativeObject(value)) {
		auto* obj = asNativeObject(value);
		Vec3 out;
		out.x = static_cast<f32>(asNumber(obj->get(valueNumber(1.0))));
		out.y = static_cast<f32>(asNumber(obj->get(valueNumber(2.0))));
		out.z = static_cast<f32>(asNumber(obj->get(valueNumber(3.0))));
		return out;
	}
	throw BMSX_RUNTIME_ERROR("put_particle expects a table or native object.");
}

std::array<f32, 16> Api::read_matrix(const Value& value) {
	std::array<f32, 16> matrix{};
	if (valueIsTable(value)) {
		auto* tbl = asTable(value);
		for (int i = 0; i < 16; ++i) {
			matrix[static_cast<size_t>(i)] = static_cast<f32>(asNumber(tbl->get(valueNumber(static_cast<double>(i + 1)))));
		}
		return matrix;
	}
	if (valueIsNativeObject(value)) {
		auto* obj = asNativeObject(value);
		for (int i = 0; i < 16; ++i) {
			matrix[static_cast<size_t>(i)] = static_cast<f32>(asNumber(obj->get(valueNumber(static_cast<double>(i + 1)))));
		}
		return matrix;
	}
	throw BMSX_RUNTIME_ERROR("put_mesh expects a matrix table.");
}

} // namespace bmsx
