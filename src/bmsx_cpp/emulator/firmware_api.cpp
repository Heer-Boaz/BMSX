#include "firmware_api.h"

#include "../core/engine_core.h"
#include "../input/input.h"
#include "runtime.h"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <unordered_set>
#include <utility>

namespace bmsx {
namespace {

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

static bool matchesLuaPathAlias(const std::string& path, const std::string& alias) {
	if (path == alias) {
		return true;
	}
	if (path.size() <= alias.size()) {
		return false;
	}
	const size_t offset = path.size() - alias.size();
	return path.compare(offset, alias.size(), alias) == 0 && path[offset - 1] == '/';
}

template<typename Fn>
void forEachLuaSource(const RuntimeAssets& assets, Fn&& fn) {
	for (const auto& entry : assets.lua) {
		fn(entry.second);
	}
}

const LuaSourceAsset* resolveLuaSourceByPath(const RuntimeAssets& assets, const std::string& path) {
	const LuaSourceAsset* direct = assets.getLua(path);
	if (direct) {
		return direct;
	}
	const LuaSourceAsset* resolved = nullptr;
	forEachLuaSource(assets, [&](const LuaSourceAsset& asset) {
		if (!matchesLuaPathAlias(asset.path, path)) {
			return;
		}
		if (resolved && resolved->path != asset.path) {
			throw BMSX_RUNTIME_ERROR("Ambiguous lua path '" + path + "'.");
		}
		resolved = &asset;
	});
	return resolved;
}

std::string summarizeLuaPaths(const RuntimeAssets& assets, size_t limit) {
	std::vector<std::string> values;
	values.reserve(limit);
	std::unordered_set<std::string> seen;
	forEachLuaSource(assets, [&](const LuaSourceAsset& asset) {
		if (values.size() >= limit) {
			return;
		}
		if (!seen.insert(asset.path).second) {
			return;
		}
		values.push_back(asset.path);
	});
	std::string out;
	for (size_t i = 0; i < values.size(); ++i) {
		if (i > 0) {
			out += ", ";
		}
		out += values[i];
	}
	return out;
}

InputSource parseInputSource(const std::string& source) {
	if (source == "keyboard") return InputSource::Keyboard;
	if (source == "gamepad") return InputSource::Gamepad;
	if (source == "pointer") return InputSource::Pointer;
	throw BMSX_RUNTIME_ERROR("Unknown input source '" + source + "'.");
}

struct ParsedAudioOptions {
	SoundMasterPlayRequest request;
	std::optional<AudioPlaybackMode> policy;
	std::optional<int> maxVoices;
	std::optional<AudioType> channel;
};

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

static u32 readUtf8Codepoint(const std::string& text, size_t& index) {
	const size_t size = text.size();
	u8 c0 = static_cast<u8>(text[index]);
	index += 1u;
	if (c0 < 0x80) {
		return c0;
	}
	if ((c0 & 0xE0) == 0xC0) {
		if (index >= size) {
			return static_cast<u32>('?');
		}
		u8 c1 = static_cast<u8>(text[index]);
		index += 1u;
		if ((c1 & 0xC0u) != 0x80u) {
			return static_cast<u32>('?');
		}
		return ((c0 & 0x1F) << 6) | (c1 & 0x3F);
	}
	if ((c0 & 0xF0) == 0xE0) {
		if (index + 1u >= size) {
			return static_cast<u32>('?');
		}
		u8 c1 = static_cast<u8>(text[index]);
		u8 c2 = static_cast<u8>(text[index + 1u]);
		index += 2u;
		if ((c1 & 0xC0u) != 0x80u || (c2 & 0xC0u) != 0x80u) {
			return static_cast<u32>('?');
		}
		return ((c0 & 0x0F) << 12) | ((c1 & 0x3F) << 6) | (c2 & 0x3F);
	}
	if (index + 2u >= size) {
		return static_cast<u32>('?');
	}
	u8 c1 = static_cast<u8>(text[index]);
	u8 c2 = static_cast<u8>(text[index + 1u]);
	u8 c3 = static_cast<u8>(text[index + 2u]);
	index += 3u;
	if ((c1 & 0xC0u) != 0x80u || (c2 & 0xC0u) != 0x80u || (c3 & 0xC0u) != 0x80u) {
		return static_cast<u32>('?');
	}
	return ((c0 & 0x07) << 18) | ((c1 & 0x3F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F);
}

static u32 utf8SingleCodepoint(const std::string& text) {
	if (text.empty()) {
		throw BMSX_RUNTIME_ERROR("Font glyph key must not be empty.");
	}
	size_t index = 0;
	u32 codepoint = readUtf8Codepoint(text, index);
	if (index != text.size()) {
		throw BMSX_RUNTIME_ERROR("Font glyph keys must contain exactly one UTF-8 codepoint.");
	}
	return codepoint;
}

static void utf8AppendCodepoint(std::string& out, u32 codepoint) {
	if (codepoint <= 0x7Fu) {
		out.push_back(static_cast<char>(codepoint));
		return;
	}
	if (codepoint <= 0x7FFu) {
		out.push_back(static_cast<char>(0xC0u | ((codepoint >> 6) & 0x1Fu)));
		out.push_back(static_cast<char>(0x80u | (codepoint & 0x3Fu)));
		return;
	}
	if (codepoint <= 0xFFFFu) {
		out.push_back(static_cast<char>(0xE0u | ((codepoint >> 12) & 0x0Fu)));
		out.push_back(static_cast<char>(0x80u | ((codepoint >> 6) & 0x3Fu)));
		out.push_back(static_cast<char>(0x80u | (codepoint & 0x3Fu)));
		return;
	}
	out.push_back(static_cast<char>(0xF0u | ((codepoint >> 18) & 0x07u)));
	out.push_back(static_cast<char>(0x80u | ((codepoint >> 12) & 0x3Fu)));
	out.push_back(static_cast<char>(0x80u | ((codepoint >> 6) & 0x3Fu)));
	out.push_back(static_cast<char>(0x80u | (codepoint & 0x3Fu)));
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
	Value crossfadeVal = table.get(key("crossfade_ms"));
	Value loopVal = table.get(key("start_at_loop_start"));
	Value freshVal = table.get(key("start_fresh"));
	Value audioIdVal = table.get(key("audio_id"));
	const bool hasTransition = !isNil(syncVal) || !isNil(fadeVal) || !isNil(crossfadeVal) || !isNil(loopVal) || !isNil(freshVal) || !isNil(audioIdVal);
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
	if (!isNil(crossfadeVal)) {
		if (!valueIsNumber(crossfadeVal)) {
			throw BMSX_RUNTIME_ERROR("music_transition.crossfade_ms must be a number");
		}
		request.crossfadeMs = static_cast<i32>(std::floor(valueToNumber(crossfadeVal)));
	}
	if (!isNil(fadeVal) && !isNil(crossfadeVal)) {
		throw BMSX_RUNTIME_ERROR("music_transition cannot specify both fade_ms and crossfade_ms");
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

static std::optional<i32> parseStopMusicFadeMs(const Value& value) {
	if (isNil(value)) {
		return std::nullopt;
	}
	if (!valueIsTable(value)) {
		throw BMSX_RUNTIME_ERROR("stop_music options must be a table");
	}
	const Table& table = *asTable(value);
	auto key = [](std::string_view name) {
		return Runtime::instance().canonicalizeIdentifier(name);
	};
	Value fadeVal = table.get(key("fade_ms"));
	Value crossfadeVal = table.get(key("crossfade_ms"));
	if (!isNil(fadeVal) && !valueIsNumber(fadeVal)) {
		throw BMSX_RUNTIME_ERROR("stop_music.fade_ms must be a number");
	}
	if (!isNil(crossfadeVal)) {
		throw BMSX_RUNTIME_ERROR("stop_music does not support crossfade_ms");
	}
	if (isNil(fadeVal)) {
		return std::nullopt;
	}
	return static_cast<i32>(std::floor(valueToNumber(fadeVal)));
}

} // namespace

Api::Api(Runtime& runtime)
	: m_runtime(runtime)
	, m_persistentData(PERSISTENT_DATA_SIZE, 0.0)
{
	m_font = std::make_unique<Font>(EngineCore::instance().systemAssets());
}

Api::~Api() = default;

void Api::markRoots(GcHeap& heap) {
	for (Value handle : m_playerInputHandles) {
		if (!isNil(handle)) {
			heap.markValue(handle);
		}
	}
}

void Api::appendRootValues(std::vector<Value>& out) const {
	for (Value handle : m_playerInputHandles) {
		if (!isNil(handle)) {
			out.push_back(handle);
		}
	}
}

Value Api::get_player_input(std::optional<int> playerIndex) {
	const int index = playerIndex.has_value() ? playerIndex.value() : 1;
	if (index < 1 || index > PLAYERS_MAX) {
		throw BMSX_RUNTIME_ERROR("Player index out of range.");
	}
	return get_player_input_handle(index);
}

std::string Api::pointer_button_code(int button) const {
	switch (button) {
		case 0: return "pointer_primary";
		case 1: return "pointer_secondary";
		case 2: return "pointer_aux";
		case 3: return "pointer_back";
		case 4: return "pointer_forward";
		default:
			throw BMSX_RUNTIME_ERROR("Unsupported pointer button index " + std::to_string(button) + ".");
	}
}

bool Api::mousebtn(int button) const {
	const ButtonState state = Input::instance().getPlayerInput(1)->getButtonState(pointer_button_code(button), InputSource::Pointer);
	return state.pressed;
}

bool Api::mousebtnp(int button) const {
	const ButtonState state = Input::instance().getPlayerInput(1)->getButtonState(pointer_button_code(button), InputSource::Pointer);
	return state.justpressed;
}

bool Api::mousebtnr(int button) const {
	const ButtonState state = Input::instance().getPlayerInput(1)->getButtonState(pointer_button_code(button), InputSource::Pointer);
	return state.justreleased;
}

std::string Api::get_lua_entry_path() const {
	const RuntimeAssets& assets = EngineCore::instance().assets();
	const std::string& entryPath = assets.entryPoint;
	if (entryPath.empty()) {
		throw BMSX_RUNTIME_ERROR("[api.get_lua_entry_path] Lua entry path is empty.");
	}
	const LuaSourceAsset* source = resolveLuaSourceByPath(assets, entryPath);
	if (!source) {
		throw BMSX_RUNTIME_ERROR("[api.get_lua_entry_path] Missing Lua entry '" + entryPath + "'. Available: " + summarizeLuaPaths(assets, 16));
	}
	return source->path;
}

std::string Api::get_lua_resource_source(const std::string& path) const {
	const RuntimeAssets& assets = EngineCore::instance().assets();
	const LuaSourceAsset* source = resolveLuaSourceByPath(assets, path);
	if (!source) {
		throw BMSX_RUNTIME_ERROR("[api.get_lua_resource_source] Missing Lua resource for path '" + path + "'. Available: " + summarizeLuaPaths(assets, 16));
	}
	return source->source;
}

double Api::get_cpu_freq_hz() const {
	return static_cast<double>(m_runtime.cpuHz());
}

void Api::set_cpu_freq_hz(double cpuHz) {
	if (!std::isfinite(cpuHz) || cpuHz <= 0.0 || std::floor(cpuHz) != cpuHz) {
		throw BMSX_RUNTIME_ERROR("[api.set_cpu_freq_hz] cpuHz must be a positive integer.");
	}
	const i64 normalizedCpuHz = static_cast<i64>(cpuHz);
	m_runtime.applyActiveMachineTiming(normalizedCpuHz);
}

Value Api::get_player_input_handle(int playerIndex) {
	const int index = playerIndex - 1;
	Value cached = m_playerInputHandles[static_cast<size_t>(index)];
	if (!isNil(cached)) {
		return cached;
	}

	auto key = [this](std::string_view name) {
		return m_runtime.canonicalizeIdentifier(name);
	};
	auto exactString = [this](std::string_view text) {
		return valueString(m_runtime.cpu().internString(text));
	};
	auto makeButtonStateTable = [this, key](const ButtonState& state, bool repeatPressed, int repeatCount) -> Value {
		Table* table = m_runtime.cpu().createTable(0, 13);
		table->set(key("pressed"), valueBool(state.pressed));
		table->set(key("justpressed"), valueBool(state.justpressed));
		table->set(key("justreleased"), valueBool(state.justreleased));
		table->set(key("waspressed"), valueBool(state.waspressed));
		table->set(key("wasreleased"), valueBool(state.wasreleased));
		table->set(key("repeatpressed"), valueBool(repeatPressed));
		table->set(key("repeatcount"), valueNumber(static_cast<double>(repeatCount)));
		table->set(key("consumed"), valueBool(state.consumed));
		table->set(key("value"), valueNumber(static_cast<double>(state.value)));
		if (state.presstime.has_value()) {
			table->set(key("presstime"), valueNumber(state.presstime.value()));
		}
		if (state.timestamp.has_value()) {
			table->set(key("timestamp"), valueNumber(state.timestamp.value()));
		}
		if (state.pressedAtMs.has_value()) {
			table->set(key("pressedAtMs"), valueNumber(state.pressedAtMs.value()));
		}
		if (state.releasedAtMs.has_value()) {
			table->set(key("releasedAtMs"), valueNumber(state.releasedAtMs.value()));
		}
		if (state.pressId.has_value()) {
			table->set(key("pressId"), valueNumber(static_cast<double>(state.pressId.value())));
		}
		if (state.value2d.has_value()) {
			Table* value2d = m_runtime.cpu().createTable(0, 2);
			value2d->set(key("x"), valueNumber(static_cast<double>(state.value2d->x)));
			value2d->set(key("y"), valueNumber(static_cast<double>(state.value2d->y)));
			table->set(key("value2d"), valueTable(value2d));
		}
		return valueTable(table);
	};
	auto makeModifierStateTable = [this, key](const PlayerInput::ModifierState& state) -> Value {
		Table* table = m_runtime.cpu().createTable(0, 4);
		table->set(key("shift"), valueBool(state.shift));
		table->set(key("ctrl"), valueBool(state.ctrl));
		table->set(key("alt"), valueBool(state.alt));
		table->set(key("meta"), valueBool(state.meta));
		return valueTable(table);
	};

	const Value getModifiersStateFn = m_runtime.cpu().createNativeFunction("player_input.getModifiersState", [this, playerIndex, makeModifierStateTable](const std::vector<Value>& args, std::vector<Value>& out) {
		(void)args;
		PlayerInput* input = Input::instance().getPlayerInput(playerIndex);
		out.push_back(makeModifierStateTable(input->getModifiersState()));
	});
	const Value getButtonStateFn = m_runtime.cpu().createNativeFunction("player_input.getButtonState", [this, playerIndex, makeButtonStateTable](const std::vector<Value>& args, std::vector<Value>& out) {
		const size_t offset = args.size() >= 3 ? 1 : 0;
		const std::string& button = m_runtime.cpu().stringPool().toString(asStringId(args.at(offset)));
		const std::string& source = m_runtime.cpu().stringPool().toString(asStringId(args.at(offset + 1)));
		PlayerInput* input = Input::instance().getPlayerInput(playerIndex);
		const ButtonState state = input->getButtonState(button, parseInputSource(source));
		out.push_back(makeButtonStateTable(state, false, 0));
	});
	const Value getButtonRepeatStateFn = m_runtime.cpu().createNativeFunction("player_input.getButtonRepeatState", [this, playerIndex, makeButtonStateTable](const std::vector<Value>& args, std::vector<Value>& out) {
		const size_t offset = args.size() >= 3 ? 1 : 0;
		const std::string& button = m_runtime.cpu().stringPool().toString(asStringId(args.at(offset)));
		const std::string& source = m_runtime.cpu().stringPool().toString(asStringId(args.at(offset + 1)));
		PlayerInput* input = Input::instance().getPlayerInput(playerIndex);
		const ActionState state = input->getButtonRepeatState(button, parseInputSource(source));
		out.push_back(makeButtonStateTable(state, state.repeatpressed.value_or(false), state.repeatcount.value_or(0)));
	});
	const Value consumeButtonFn = m_runtime.cpu().createNativeFunction("player_input.consumeButton", [this, playerIndex](const std::vector<Value>& args, std::vector<Value>& out) {
		const size_t offset = args.size() >= 3 ? 1 : 0;
		const std::string& button = m_runtime.cpu().stringPool().toString(asStringId(args.at(offset)));
		const std::string& source = m_runtime.cpu().stringPool().toString(asStringId(args.at(offset + 1)));
		Input::instance().getPlayerInput(playerIndex)->consumeButton(button, parseInputSource(source));
		(void)out;
	});
	const Value getModifiersStateKey = exactString("getModifiersState");
	const Value getButtonStateKey = exactString("getButtonState");
	const Value getButtonRepeatStateKey = exactString("getButtonRepeatState");
	const Value consumeButtonKey = exactString("consumeButton");
	const Value getModifiersStateIdentifierKey = key("getModifiersState");
	const Value getButtonStateIdentifierKey = key("getButtonState");
	const Value getButtonRepeatStateIdentifierKey = key("getButtonRepeatState");
	const Value consumeButtonIdentifierKey = key("consumeButton");

	const Value handle = m_runtime.cpu().createNativeObject(
		nullptr,
		[this, getModifiersStateKey, getButtonStateKey, getButtonRepeatStateKey, consumeButtonKey, getModifiersStateIdentifierKey, getButtonStateIdentifierKey, getButtonRepeatStateIdentifierKey, consumeButtonIdentifierKey, getModifiersStateFn, getButtonStateFn, getButtonRepeatStateFn, consumeButtonFn](const Value& keyValue) -> Value {
			if (!valueIsString(keyValue)) {
				throw BMSX_RUNTIME_ERROR("Player input methods require a string key.");
			}
			if (keyValue == getModifiersStateKey || keyValue == getModifiersStateIdentifierKey) return getModifiersStateFn;
			if (keyValue == getButtonStateKey || keyValue == getButtonStateIdentifierKey) return getButtonStateFn;
			if (keyValue == getButtonRepeatStateKey || keyValue == getButtonRepeatStateIdentifierKey) return getButtonRepeatStateFn;
			if (keyValue == consumeButtonKey || keyValue == consumeButtonIdentifierKey) return consumeButtonFn;
			throw BMSX_RUNTIME_ERROR("Unknown player input method '" + m_runtime.cpu().stringPool().toString(asStringId(keyValue)) + "'.");
		},
		[](const Value&, const Value&) {
			throw BMSX_RUNTIME_ERROR("Player input handle is read-only.");
		},
		nullptr,
		nullptr,
		[getModifiersStateFn, getButtonStateFn, getButtonRepeatStateFn, consumeButtonFn](GcHeap& heap) {
			heap.markValue(getModifiersStateFn);
			heap.markValue(getButtonStateFn);
			heap.markValue(getButtonRepeatStateFn);
			heap.markValue(consumeButtonFn);
		}
	);
	m_playerInputHandles[static_cast<size_t>(index)] = handle;
	return handle;
}

void Api::registerAllFunctions() {
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

m_runtime.registerNativeFunction("get_player_input", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	std::optional<int> playerIndex;
	if (!args.empty() && !isNil(args.at(0))) {
		playerIndex = static_cast<int>(std::floor(asNumber(args.at(0))));
	}
	out.push_back(get_player_input(playerIndex));
});

m_runtime.registerNativeFunction("mousebtn", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	const int button = static_cast<int>(std::floor(asNumber(args.at(0))));
	out.push_back(valueBool(mousebtn(button)));
});

m_runtime.registerNativeFunction("mousebtnp", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	const int button = static_cast<int>(std::floor(asNumber(args.at(0))));
	out.push_back(valueBool(mousebtnp(button)));
});

m_runtime.registerNativeFunction("mousebtnr", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	const int button = static_cast<int>(std::floor(asNumber(args.at(0))));
	out.push_back(valueBool(mousebtnr(button)));
});

m_runtime.registerNativeFunction("pointer_screen_position", [this, key](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	PlayerInput* input = Input::instance().getPlayerInput(1);
	const ButtonState state = input->getButtonState("pointer_position", InputSource::Pointer);
	Table* table = m_runtime.cpu().createTable(0, 3);
	if (!state.value2d.has_value()) {
		table->set(key("x"), valueNumber(0.0));
		table->set(key("y"), valueNumber(0.0));
		table->set(key("valid"), valueBool(false));
		out.push_back(valueTable(table));
		return;
	}
	table->set(key("x"), valueNumber(static_cast<double>(state.value2d->x)));
	table->set(key("y"), valueNumber(static_cast<double>(state.value2d->y)));
	table->set(key("valid"), valueBool(true));
	out.push_back(valueTable(table));
});

m_runtime.registerNativeFunction("pointer_delta", [this, key](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	PlayerInput* input = Input::instance().getPlayerInput(1);
	const ButtonState state = input->getButtonState("pointer_delta", InputSource::Pointer);
	Table* table = m_runtime.cpu().createTable(0, 3);
	if (!state.value2d.has_value()) {
		table->set(key("x"), valueNumber(0.0));
		table->set(key("y"), valueNumber(0.0));
		table->set(key("valid"), valueBool(false));
		out.push_back(valueTable(table));
		return;
	}
	table->set(key("x"), valueNumber(static_cast<double>(state.value2d->x)));
	table->set(key("y"), valueNumber(static_cast<double>(state.value2d->y)));
	table->set(key("valid"), valueBool(true));
	out.push_back(valueTable(table));
});

m_runtime.registerNativeFunction("pointer_viewport_position", [this, key](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	PlayerInput* input = Input::instance().getPlayerInput(1);
	const ButtonState state = input->getButtonState("pointer_position", InputSource::Pointer);
	Table* table = m_runtime.cpu().createTable(0, 4);
	if (!state.value2d.has_value()) {
		table->set(key("x"), valueNumber(0.0));
		table->set(key("y"), valueNumber(0.0));
		table->set(key("valid"), valueBool(false));
		table->set(key("inside"), valueBool(false));
		out.push_back(valueTable(table));
		return;
	}
	const double x = static_cast<double>(state.value2d->x);
	const double y = static_cast<double>(state.value2d->y);
	const double width = EngineCore::instance().view()->viewportSize.x;
	const double height = EngineCore::instance().view()->viewportSize.y;
	const bool inside = x >= 0.0 && x < width && y >= 0.0 && y < height;
	table->set(key("x"), valueNumber(x));
	table->set(key("y"), valueNumber(y));
	table->set(key("valid"), valueBool(true));
	table->set(key("inside"), valueBool(inside));
	out.push_back(valueTable(table));
});

m_runtime.registerNativeFunction("mousepos", [this, key](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	PlayerInput* input = Input::instance().getPlayerInput(1);
	const ButtonState state = input->getButtonState("pointer_position", InputSource::Pointer);
	Table* table = m_runtime.cpu().createTable(0, 4);
	if (!state.value2d.has_value()) {
		table->set(key("x"), valueNumber(0.0));
		table->set(key("y"), valueNumber(0.0));
		table->set(key("valid"), valueBool(false));
		table->set(key("inside"), valueBool(false));
		out.push_back(valueTable(table));
		return;
	}
	const double x = static_cast<double>(state.value2d->x);
	const double y = static_cast<double>(state.value2d->y);
	const double width = EngineCore::instance().view()->viewportSize.x;
	const double height = EngineCore::instance().view()->viewportSize.y;
	const bool inside = x >= 0.0 && x < width && y >= 0.0 && y < height;
	table->set(key("x"), valueNumber(x));
	table->set(key("y"), valueNumber(y));
	table->set(key("valid"), valueBool(true));
	table->set(key("inside"), valueBool(inside));
	out.push_back(valueTable(table));
});

m_runtime.registerNativeFunction("mousewheel", [this, key](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	PlayerInput* input = Input::instance().getPlayerInput(1);
	const ButtonState state = input->getButtonState("pointer_wheel", InputSource::Pointer);
	Table* table = m_runtime.cpu().createTable(0, 2);
	table->set(key("value"), valueNumber(static_cast<double>(state.value)));
	table->set(key("valid"), valueBool(state.value != 0.0f));
	out.push_back(valueTable(table));
});

m_runtime.registerNativeFunction("get_lua_entry_path", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	out.push_back(valueString(m_runtime.cpu().internString(get_lua_entry_path())));
});

m_runtime.registerNativeFunction("get_lua_resource_source", [this, asText](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& path = asText(args.at(0));
	out.push_back(valueString(m_runtime.cpu().internString(get_lua_resource_source(path))));
});

m_runtime.registerNativeFunction("get_cpu_freq_hz", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	out.push_back(valueNumber(get_cpu_freq_hz()));
});

m_runtime.registerNativeFunction("set_cpu_freq_hz", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	set_cpu_freq_hz(asNumber(args.at(0)));
	(void)out;
});

m_runtime.registerNativeFunction("stat", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	int index = static_cast<int>(std::floor(asNumber(args.at(0))));
	out.push_back(valueNumber(stat(index)));
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

	m_runtime.registerNativeFunction("get_default_font", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		(void)args;
		out.push_back(build_font_descriptor(m_font.get()));
	});

	m_runtime.registerNativeFunction("create_font", [this](const std::vector<Value>& args, std::vector<Value>& out) {
		BFont* font = create_font(args.at(0));
		out.push_back(build_font_descriptor(font));
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
	EngineCore::instance().soundMaster()->playWithPolicy(channel, id, options.request, options.policy, options.maxVoices);
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
	EngineCore::instance().soundMaster()->playWithPolicy(AudioType::Music, id, options.request, options.policy, options.maxVoices);
	(void)out;
});

m_runtime.registerNativeFunction("stop_music", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	const Value optionsValue = args.empty() ? valueNil() : args.at(0);
	stop_music(parseStopMusicFadeMs(optionsValue));
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

BFont* Api::resolveFontId(uint32_t id) const {
	if (id == 0u) {
		return m_font.get();
	}
	const size_t runtimeIndex = static_cast<size_t>(id - 1u);
	if (runtimeIndex >= m_runtime_fonts.size()) {
		throw BMSX_RUNTIME_ERROR("Unknown font id " + std::to_string(id) + ".");
	}
	return m_runtime_fonts[runtimeIndex].get();
}

BFont* Api::resolveFontHandle(const Value& value) {
	return resolve_font(value);
}

uint32_t Api::getFontId(BFont* font) const {
	return fontId(font);
}

uint32_t Api::fontId(BFont* font) const {
	if (font == m_font.get()) {
		return 0u;
	}
	for (size_t index = 0; index < m_runtime_fonts.size(); index += 1) {
		if (m_runtime_fonts[index].get() == font) {
			return static_cast<uint32_t>(index + 1u);
		}
	}
	throw BMSX_RUNTIME_ERROR("Unknown font handle.");
}

void Api::put_mesh(const MeshRenderSubmission& submission) {
	EngineCore::instance().view()->renderer.submit.mesh(submission);
}

void Api::put_particle(const ParticleRenderSubmission& submission) {
	EngineCore::instance().view()->renderer.submit.particle(submission);
}

bool Api::action_triggered(const std::string& actionDefinition, std::optional<int> playerIndex) const {
	int index = playerIndex.has_value() ? playerIndex.value() : 1;
	return EngineCore::instance().action_triggered(index, actionDefinition);
}

void Api::consume_action(const std::string& action, std::optional<int> playerIndex) {
	int index = playerIndex.has_value() ? playerIndex.value() : 1;
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

void Api::restorePersistentData(const std::string& ns, const std::vector<double>& values) {
	m_cartDataNamespace = ns;
	m_persistentData.assign(PERSISTENT_DATA_SIZE, 0.0);
	const size_t count = std::min(values.size(), m_persistentData.size());
	for (size_t index = 0; index < count; ++index) {
		m_persistentData[index] = values[index];
	}
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

void Api::stop_music(std::optional<i32> fadeMs) {
	EngineCore::instance().soundMaster()->stopMusic(fadeMs);
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

Value Api::build_font_descriptor(BFont* font) {
	auto key = [this](std::string_view name) {
		return m_runtime.canonicalizeIdentifier(name);
	};
	auto str = [this](const std::string& value) {
		return valueString(m_runtime.cpu().internString(value));
	};
	Table* glyphs = m_runtime.cpu().createTable(0, static_cast<int>(font->glyphMap().size()));
	for (const auto& [codepoint, _imgid] : font->glyphMap()) {
		std::string glyphKey;
		utf8AppendCodepoint(glyphKey, codepoint);
		const FontGlyph& glyph = font->getGlyph(codepoint);
		Table* glyphEntry = m_runtime.cpu().createTable(0, 4);
		glyphEntry->set(key("imgid"), str(glyph.imgid));
		glyphEntry->set(key("width"), valueNumber(static_cast<double>(glyph.width)));
		glyphEntry->set(key("height"), valueNumber(static_cast<double>(glyph.height)));
		glyphEntry->set(key("advance"), valueNumber(static_cast<double>(glyph.advance)));
		glyphs->set(str(glyphKey), valueTable(glyphEntry));
	}
	{
		const FontGlyph& tabGlyph = font->getGlyph(static_cast<u32>('\t'));
		Table* glyphEntry = m_runtime.cpu().createTable(0, 4);
		glyphEntry->set(key("imgid"), str(tabGlyph.imgid));
		glyphEntry->set(key("width"), valueNumber(static_cast<double>(tabGlyph.width)));
		glyphEntry->set(key("height"), valueNumber(static_cast<double>(tabGlyph.height)));
		glyphEntry->set(key("advance"), valueNumber(static_cast<double>(tabGlyph.advance)));
		glyphs->set(str("\t"), valueTable(glyphEntry));
	}
	Table* descriptor = m_runtime.cpu().createTable(0, 4);
	descriptor->set(key("id"), valueNumber(static_cast<double>(fontId(font))));
	descriptor->set(key("line_height"), valueNumber(static_cast<double>(font->lineHeight())));
	descriptor->set(key("advance_padding"), valueNumber(static_cast<double>(font->advancePadding())));
	descriptor->set(key("glyphs"), valueTable(glyphs));
	return valueTable(descriptor);
}

Value Api::make_font_handle(BFont* font) {
	return m_runtime.cpu().createNativeObject(
		font,
		[](const Value&) {
			return valueNil();
		},
		[](const Value&, const Value&) {
		}
	);
}

BFont* Api::resolve_font(const Value& value) {
	if (isNil(value)) {
		return m_font.get();
	}
	if (!valueIsNativeObject(value)) {
		throw BMSX_RUNTIME_ERROR("Font must be a native font handle.");
	}
	NativeObject* obj = asNativeObject(value);
	if (obj->raw == m_font.get()) {
		return m_font.get();
	}
	for (size_t index = 0; index < m_runtime_fonts.size(); index += 1) {
		BFont* font = m_runtime_fonts[index].get();
		if (obj->raw == font) {
			return font;
		}
	}
	throw BMSX_RUNTIME_ERROR("Unknown font handle.");
}

BFont* Api::create_font(const Value& definition) {
	if (!valueIsTable(definition)) {
		throw BMSX_RUNTIME_ERROR("create_font(definition) requires a table.");
	}
	auto key = [this](std::string_view name) {
		return m_runtime.canonicalizeIdentifier(name);
	};
	auto asText = [this](Value value) -> const std::string& {
		return m_runtime.cpu().stringPool().toString(asStringId(value));
	};
	Table* definitionTable = asTable(definition);
	Value glyphsValue = definitionTable->get(key("glyphs"));
	if (!valueIsTable(glyphsValue)) {
		throw BMSX_RUNTIME_ERROR("create_font(definition) requires definition.glyphs to be a table.");
	}
	Table* glyphsTable = asTable(glyphsValue);
	GlyphMap glyphMap;
	glyphsTable->forEachEntry([&](const Value& glyphKey, const Value& glyphValue) {
		if (!valueIsString(glyphKey)) {
			throw BMSX_RUNTIME_ERROR("create_font(definition) requires glyph keys to be strings.");
		}
		if (!valueIsString(glyphValue)) {
			throw BMSX_RUNTIME_ERROR("create_font(definition) requires glyph values to be image id strings.");
		}
		const std::string& glyph = asText(glyphKey);
		glyphMap[utf8SingleCodepoint(glyph)] = asText(glyphValue);
	});

	int advancePadding = 0;
	Value advancePaddingValue = definitionTable->get(key("advance_padding"));
	if (!isNil(advancePaddingValue)) {
		if (!valueIsNumber(advancePaddingValue)) {
			throw BMSX_RUNTIME_ERROR("create_font(definition) requires advance_padding to be a number.");
		}
		advancePadding = static_cast<int>(std::floor(asNumber(advancePaddingValue)));
	}

	std::unique_ptr<BFont> font = std::make_unique<BFont>(EngineCore::instance().assets(), std::move(glyphMap), advancePadding);
	BFont* handle = font.get();
	m_runtime_fonts.push_back(std::move(font));
	return handle;
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
