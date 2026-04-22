#include "machine/firmware/api.h"
#include "machine/runtime/timing/config.h"
#include "machine/firmware/input_state_tables.h"

#include "core/engine.h"
#include "core/utf8.h"
#include "input/manager.h"
#include "machine/runtime/runtime.h"
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

struct ButtonInputRequest {
	const std::string& button;
	InputSource source;
};

ButtonInputRequest readButtonInputRequest(Runtime& runtime, NativeArgsView args) {
	const size_t offset = args.size() >= 3 ? 1 : 0;
	const StringPool& strings = runtime.machine().cpu().stringPool();
	const std::string& button = strings.toString(asStringId(args.at(offset)));
	const std::string& source = strings.toString(asStringId(args.at(offset + 1)));
	return {button, parseInputSource(source)};
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

} // namespace

Api::Api(Runtime& runtime)
	: m_runtime(runtime)
	, m_persistentData(PERSISTENT_DATA_SIZE, 0.0)
{
	m_font = std::make_unique<Font>(EngineCore::instance().systemAssets());
}

Api::~Api() = default;

void Api::initializeRuntimeKeys() {
	m_keys.x = m_runtime.luaKey("x");
	m_keys.y = m_runtime.luaKey("y");
	m_keys.z = m_runtime.luaKey("z");
	m_keys.r = m_runtime.luaKey("r");
	m_keys.g = m_runtime.luaKey("g");
	m_keys.b = m_runtime.luaKey("b");
	m_keys.a = m_runtime.luaKey("a");
	m_keys.definition = m_runtime.luaKey("definition");
	m_keys.action = m_runtime.luaKey("action");
	m_keys.name = m_runtime.luaKey("name");
	m_keys.valid = m_runtime.luaKey("valid");
	m_keys.inside = m_runtime.luaKey("inside");
	m_keys.value = m_runtime.luaKey("value");
	m_inputStateKeys = createInputStateTableKeys(m_runtime);
}

void Api::markRoots(GcHeap& heap) {
	for (Value handle : m_playerInputHandles) {
		if (!isNil(handle)) {
			heap.markValue(handle);
		}
	}
}

void Api::appendRootValues(NativeResults& out) const {
	for (Value handle : m_playerInputHandles) {
		if (!isNil(handle)) {
			out.push_back(handle);
		}
	}
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
	return static_cast<double>(m_runtime.timing.cpuHz);
}

void Api::set_cpu_freq_hz(double cpuHz) {
	if (!std::isfinite(cpuHz) || cpuHz <= 0.0 || std::floor(cpuHz) != cpuHz) {
		throw BMSX_RUNTIME_ERROR("[api.set_cpu_freq_hz] cpuHz must be a positive integer.");
	}
	const i64 normalizedCpuHz = static_cast<i64>(cpuHz);
	applyActiveMachineTiming(m_runtime, normalizedCpuHz);
}

Value Api::get_player_input_handle(int playerIndex) {
	const int index = playerIndex - 1;
	Value cached = m_playerInputHandles[static_cast<size_t>(index)];
	if (!isNil(cached)) {
		return cached;
	}

	CPU& cpu = m_runtime.machine().cpu();
	auto key = [this](std::string_view name) {
		return m_runtime.luaKey(name);
	};
	auto exactString = [&cpu](std::string_view text) {
		return valueString(cpu.internString(text));
	};
	PlayerInput* input = Input::instance().getPlayerInput(playerIndex);
	auto makeModifierStateTable = [&cpu, key](const PlayerInput::ModifierState& state) -> Value {
		Table* table = cpu.createTable(0, 4);
		table->set(key("shift"), valueBool(state.shift));
		table->set(key("ctrl"), valueBool(state.ctrl));
		table->set(key("alt"), valueBool(state.alt));
		table->set(key("meta"), valueBool(state.meta));
		return valueTable(table);
	};

	const Value getModifiersStateFn = cpu.createNativeFunction("player_input.getModifiersState", [input, makeModifierStateTable](NativeArgsView args, NativeResults& out) {
		(void)args;
		out.push_back(makeModifierStateTable(input->getModifiersState()));
	});
	const Value getButtonStateFn = cpu.createNativeFunction("player_input.getButtonState", [this, input](NativeArgsView args, NativeResults& out) {
		const ButtonInputRequest request = readButtonInputRequest(m_runtime, args);
		const ButtonState state = input->getButtonState(request.button, request.source);
		out.push_back(buildButtonStateTable(m_runtime, m_inputStateKeys, state, false, 0));
	});
	const Value getButtonRepeatStateFn = cpu.createNativeFunction("player_input.getButtonRepeatState", [this, input](NativeArgsView args, NativeResults& out) {
		const ButtonInputRequest request = readButtonInputRequest(m_runtime, args);
		const ActionState state = input->getButtonRepeatState(request.button, request.source);
		out.push_back(buildButtonStateTable(m_runtime, m_inputStateKeys, state, *state.repeatpressed, *state.repeatcount));
	});
	const Value consumeButtonFn = cpu.createNativeFunction("player_input.consumeButton", [this, input](NativeArgsView args, NativeResults& out) {
		const ButtonInputRequest request = readButtonInputRequest(m_runtime, args);
		input->consumeRawButton(request.button, request.source);
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

	const Value handle = cpu.createNativeObject(
		nullptr,
		[this, getModifiersStateKey, getButtonStateKey, getButtonRepeatStateKey, consumeButtonKey, getModifiersStateIdentifierKey, getButtonStateIdentifierKey, getButtonRepeatStateIdentifierKey, consumeButtonIdentifierKey, getModifiersStateFn, getButtonStateFn, getButtonRepeatStateFn, consumeButtonFn](const Value& keyValue) -> Value {
			if (!valueIsString(keyValue)) {
				throw BMSX_RUNTIME_ERROR("Player input methods require a string key.");
			}
			if (keyValue == getModifiersStateKey || keyValue == getModifiersStateIdentifierKey) return getModifiersStateFn;
			if (keyValue == getButtonStateKey || keyValue == getButtonStateIdentifierKey) return getButtonStateFn;
			if (keyValue == getButtonRepeatStateKey || keyValue == getButtonRepeatStateIdentifierKey) return getButtonRepeatStateFn;
			if (keyValue == consumeButtonKey || keyValue == consumeButtonIdentifierKey) return consumeButtonFn;
			throw BMSX_RUNTIME_ERROR("Unknown player input method '" + m_runtime.machine().cpu().stringPool().toString(asStringId(keyValue)) + "'.");
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
		return m_runtime.luaKey(name);
	};
	auto asText = [this](Value value) -> const std::string& {
		return m_runtime.machine().cpu().stringPool().toString(asStringId(value));
	};

m_runtime.registerNativeFunction("display_width", [this](NativeArgsView args, NativeResults& out) {
	(void)args;
	out.push_back(valueNumber(static_cast<double>(display_width())));
});

m_runtime.registerNativeFunction("display_height", [this](NativeArgsView args, NativeResults& out) {
	(void)args;
	out.push_back(valueNumber(static_cast<double>(display_height())));
});

m_runtime.registerNativeFunction("get_lua_entry_path", [this](NativeArgsView args, NativeResults& out) {
	(void)args;
	out.push_back(valueString(m_runtime.machine().cpu().internString(get_lua_entry_path())));
});

m_runtime.registerNativeFunction("get_lua_resource_source", [this, asText](NativeArgsView args, NativeResults& out) {
	const std::string& path = asText(args.at(0));
	out.push_back(valueString(m_runtime.machine().cpu().internString(get_lua_resource_source(path))));
});

m_runtime.registerNativeFunction("get_cpu_freq_hz", [this](NativeArgsView args, NativeResults& out) {
	(void)args;
	out.push_back(valueNumber(get_cpu_freq_hz()));
});

m_runtime.registerNativeFunction("set_cpu_freq_hz", [this](NativeArgsView args, NativeResults& out) {
	set_cpu_freq_hz(asNumber(args.at(0)));
	(void)out;
});

m_runtime.registerNativeFunction("put_mesh", [this, key](NativeArgsView args, NativeResults& out) {
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

m_runtime.registerNativeFunction("put_particle", [this, key](NativeArgsView args, NativeResults& out) {
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

m_runtime.registerNativeFunction("get_default_font", [this](NativeArgsView args, NativeResults& out) {
	(void)args;
	out.push_back(build_font_descriptor(m_font.get()));
});

m_runtime.registerNativeFunction("create_font", [this](NativeArgsView args, NativeResults& out) {
	BFont* font = create_font(args.at(0));
	out.push_back(build_font_descriptor(font));
	(void)out;
});

m_runtime.registerNativeFunction("cartdata", [this, asText](NativeArgsView args, NativeResults& out) {
	const std::string& ns = asText(args.at(0));
	cartdata(ns);
	(void)out;
});

m_runtime.registerNativeFunction("dset", [this](NativeArgsView args, NativeResults& out) {
	int index = static_cast<int>(std::floor(asNumber(args.at(0))));
	double value = asNumber(args.at(1));
	dset(index, value);
	(void)out;
});

m_runtime.registerNativeFunction("dget", [this](NativeArgsView args, NativeResults& out) {
	int index = static_cast<int>(std::floor(asNumber(args.at(0))));
	out.push_back(valueNumber(dget(index)));
});

m_runtime.registerNativeFunction("set_sprite_parallax_rig", [this](NativeArgsView args, NativeResults& out) {
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

m_runtime.registerNativeFunction("reboot", [this](NativeArgsView args, NativeResults& out) {
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

void Api::set_sprite_parallax_rig(f32 vy, f32 scale, f32 impact, f32 impact_t,
									f32 bias_px, f32 parallax_strength,
									f32 scale_strength, f32 flip_strength,
									f32 flip_window) {
	EngineCore::instance().view()->setSpriteParallaxRig(
		vy, scale, impact, impact_t, bias_px, parallax_strength, scale_strength,
		flip_strength, flip_window);
}

void Api::reboot() {
	m_runtime.requestProgramReload();
}

Value Api::build_font_descriptor(BFont* font) {
	CPU& cpu = m_runtime.machine().cpu();
	auto key = [this](std::string_view name) {
		return m_runtime.luaKey(name);
	};
	auto str = [&cpu](const std::string& value) {
		return valueString(cpu.internString(value));
	};
	Table* glyphs = cpu.createTable(0, static_cast<int>(font->glyphMap().size()));
	for (const auto& [codepoint, _imgid] : font->glyphMap()) {
		std::string glyphKey;
		appendUtf8Codepoint(glyphKey, codepoint);
		const FontGlyph& glyph = font->getGlyph(codepoint);
		Table* glyphEntry = cpu.createTable(0, 4);
		glyphEntry->set(key("imgid"), str(glyph.imgid));
		glyphEntry->set(key("width"), valueNumber(static_cast<double>(glyph.width)));
		glyphEntry->set(key("height"), valueNumber(static_cast<double>(glyph.height)));
		glyphEntry->set(key("advance"), valueNumber(static_cast<double>(glyph.advance)));
		glyphs->set(str(glyphKey), valueTable(glyphEntry));
	}
	{
		const FontGlyph& tabGlyph = font->getGlyph(static_cast<u32>('\t'));
		Table* glyphEntry = cpu.createTable(0, 4);
		glyphEntry->set(key("imgid"), str(tabGlyph.imgid));
		glyphEntry->set(key("width"), valueNumber(static_cast<double>(tabGlyph.width)));
		glyphEntry->set(key("height"), valueNumber(static_cast<double>(tabGlyph.height)));
		glyphEntry->set(key("advance"), valueNumber(static_cast<double>(tabGlyph.advance)));
		glyphs->set(str("\t"), valueTable(glyphEntry));
	}
	Table* descriptor = cpu.createTable(0, 4);
	descriptor->set(key("id"), valueNumber(static_cast<double>(fontId(font))));
	descriptor->set(key("line_height"), valueNumber(static_cast<double>(font->lineHeight())));
	descriptor->set(key("advance_padding"), valueNumber(static_cast<double>(font->advancePadding())));
	descriptor->set(key("glyphs"), valueTable(glyphs));
	return valueTable(descriptor);
}

Value Api::make_font_handle(BFont* font) {
	return m_runtime.machine().cpu().createNativeObject(
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
		return m_runtime.luaKey(name);
	};
	auto asText = [this](Value value) -> const std::string& {
		return m_runtime.machine().cpu().stringPool().toString(asStringId(value));
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
	color.r = static_cast<f32>(asNumber(tbl->get(m_keys.r)));
	color.g = static_cast<f32>(asNumber(tbl->get(m_keys.g)));
	color.b = static_cast<f32>(asNumber(tbl->get(m_keys.b)));
	color.a = static_cast<f32>(asNumber(tbl->get(m_keys.a)));
	return color;
}

Vec3 Api::read_vec3(const Value& value) {
	if (valueIsTable(value)) {
		auto* tbl = asTable(value);
		Vec3 out;
		out.x = static_cast<f32>(asNumber(tbl->get(m_keys.x)));
		out.y = static_cast<f32>(asNumber(tbl->get(m_keys.y)));
		out.z = static_cast<f32>(asNumber(tbl->get(m_keys.z)));
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
