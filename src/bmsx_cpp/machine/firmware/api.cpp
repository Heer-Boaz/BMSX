#include "machine/firmware/api.h"
#include "machine/runtime/timing/config.h"
#include "machine/firmware/input_state_tables.h"

#include "core/utf8.h"
#include "input/manager.h"
#include "machine/runtime/runtime.h"
#include "render/gameview.h"
#include "render/shared/hardware/lighting.h"
#include "render/shared/queues.h"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstring>
#include <stdexcept>
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
	m_font = std::make_unique<Font>();
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
	m_keys.slot = m_runtime.luaKey("slot");
	m_keys.u = m_runtime.luaKey("u");
	m_keys.v = m_runtime.luaKey("v");
	m_keys.w = m_runtime.luaKey("w");
	m_keys.h = m_runtime.luaKey("h");
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

RuntimeStorageState Api::captureStorageState() const {
	RuntimeStorageState state;
	state.storageNamespace = m_cartDataNamespace;
	for (size_t index = 0; index < m_persistentData.size(); ++index) {
		const double value = m_persistentData[index];
		if (value == 0.0) {
			continue;
		}
		state.entries.push_back(RuntimeStorageStateEntry{
			static_cast<int>(index),
			value,
		});
	}
	return state;
}

void Api::restoreStorageState(const RuntimeStorageState& state) {
	m_cartDataNamespace = state.storageNamespace;
	m_persistentData.assign(PERSISTENT_DATA_SIZE, 0.0);
	for (const RuntimeStorageStateEntry& entry : state.entries) {
		m_persistentData.at(static_cast<size_t>(entry.index)) = entry.value;
	}
}

double Api::get_cpu_freq_hz() const {
	return static_cast<double>(m_runtime.timing.cpuHz);
}

void Api::set_cpu_freq_hz(double cpuHz) {
	applyActiveMachineTiming(m_runtime, static_cast<i64>(cpuHz));
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

m_runtime.registerNativeFunction("skybox", [this](NativeArgsView args, NativeResults& out) {
	skybox(
		read_image_slot_source(args.at(0), "skybox posx"),
		read_image_slot_source(args.at(1), "skybox negx"),
		read_image_slot_source(args.at(2), "skybox posy"),
		read_image_slot_source(args.at(3), "skybox negy"),
		read_image_slot_source(args.at(4), "skybox posz"),
		read_image_slot_source(args.at(5), "skybox negz")
	);
	(void)out;
});

m_runtime.registerNativeFunction("set_camera", [this](NativeArgsView args, NativeResults& out) {
	set_camera(read_matrix(args.at(0)), read_matrix(args.at(1)), read_vec3(args.at(2)));
	(void)out;
});

m_runtime.registerNativeFunction("put_ambient_light", [this, asText](NativeArgsView args, NativeResults& out) {
	put_ambient_light(asText(args.at(0)), read_light_color(args.at(1)), static_cast<f32>(asNumber(args.at(2))));
	(void)out;
});

m_runtime.registerNativeFunction("put_directional_light", [this, asText](NativeArgsView args, NativeResults& out) {
	put_directional_light(
		asText(args.at(0)),
		read_vec3(args.at(1)),
		read_light_color(args.at(2)),
		static_cast<f32>(asNumber(args.at(3)))
	);
	(void)out;
});

m_runtime.registerNativeFunction("put_point_light", [this, asText](NativeArgsView args, NativeResults& out) {
	put_point_light(
		asText(args.at(0)),
		read_vec3(args.at(1)),
		read_light_color(args.at(2)),
		static_cast<f32>(asNumber(args.at(3))),
		static_cast<f32>(asNumber(args.at(4)))
	);
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

m_runtime.registerNativeFunction("reboot", [this](NativeArgsView args, NativeResults& out) {
	(void)args;
	reboot();
	(void)out;
});
}

int Api::display_width() const {
	return static_cast<int>(m_runtime.view().viewportSize.x);
}

int Api::display_height() const {
	return static_cast<int>(m_runtime.view().viewportSize.y);
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
	RenderQueues::submitMesh(submission);
}

void Api::skybox(const VdpSlotSource& posx,
				const VdpSlotSource& negx,
				const VdpSlotSource& posy,
				const VdpSlotSource& negy,
				const VdpSlotSource& posz,
				const VdpSlotSource& negz) {
	m_runtime.machine().vdp().setSkyboxSources(SkyboxFaceSources{
		posx,
		negx,
		posy,
		negy,
		posz,
		negz,
	});
}

void Api::set_camera(const std::array<f32, 16>& view, const std::array<f32, 16>& proj, const Vec3& eye) {
	m_runtime.machine().vdp().setCameraBank0(view, proj, eye.x, eye.y, eye.z);
}

void Api::put_ambient_light(const std::string& id, const std::array<f32, 3>& color, f32 intensity) {
	::bmsx::putHardwareAmbientLight(id, AmbientLight{
		color,
		intensity,
	});
}

void Api::put_directional_light(const std::string& id, const Vec3& orientation, const std::array<f32, 3>& color, f32 intensity) {
	::bmsx::putHardwareDirectionalLight(id, DirectionalLight{
		color,
		intensity,
		{ orientation.x, orientation.y, orientation.z },
	});
}

void Api::put_point_light(const std::string& id, const Vec3& position, const std::array<f32, 3>& color, f32 range, f32 intensity) {
	::bmsx::putHardwarePointLight(id, PointLight{
		color,
		intensity,
		position,
		range,
	});
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

BFont* Api::resolve_font(const Value& value) { // TODO: TOTALLY NO PARITY WITH TS-VERSION!!!!
	if (isNil(value)) {
		return m_font.get();
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
	auto key = [this](std::string_view name) {
		return m_runtime.luaKey(name);
	};
	auto asText = [this](Value value) -> const std::string& {
		return m_runtime.machine().cpu().stringPool().toString(asStringId(value));
	};
	Table* definitionTable = asTable(definition);
	Value glyphsValue = definitionTable->get(key("glyphs"));
	Table* glyphsTable = asTable(glyphsValue);
	GlyphMap glyphMap;
	glyphsTable->forEachEntry([&](const Value& glyphKey, const Value& glyphValue) {
		const std::string& glyph = asText(glyphKey);
		glyphMap[utf8SingleCodepoint(glyph)] = asText(glyphValue);
	});

	const Value advancePaddingValue = definitionTable->get(key("advance_padding"));
	const i32 advancePadding = isNil(advancePaddingValue) ? 0 : static_cast<i32>(std::floor(asNumber(advancePaddingValue)));
	std::unique_ptr<BFont> font = std::make_unique<BFont>(m_runtime.activeRom(), std::move(glyphMap), advancePadding);
	BFont* handle = font.get();
	m_runtime_fonts.push_back(std::move(font));
	return handle;
}

Color Api::palette_color(int index) const {
	return paletteColor(index);
}

Color Api::resolve_color(const Value& value) {
	if (valueIsNumber(value)) {
		return palette_color(static_cast<int>(asNumber(value)));
	}
	auto* tbl = asTable(value);
	Color color;
	color.r = static_cast<f32>(asNumber(tbl->get(m_keys.r)));
	color.g = static_cast<f32>(asNumber(tbl->get(m_keys.g)));
	color.b = static_cast<f32>(asNumber(tbl->get(m_keys.b)));
	color.a = static_cast<f32>(asNumber(tbl->get(m_keys.a)));
	return color;
}

VdpSlotSource Api::read_image_slot_source(const Value& value, const char* label) {
	if (!valueIsTable(value)) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " expects a slot/u/v/w/h table.");
	}
	auto* tbl = asTable(value);
	const Value slot = tbl->get(m_keys.slot);
	const Value u = tbl->get(m_keys.u);
	const Value v = tbl->get(m_keys.v);
	const Value w = tbl->get(m_keys.w);
	const Value h = tbl->get(m_keys.h);
	if (isNil(slot) || isNil(u) || isNil(v) || isNil(w) || isNil(h)) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " requires slot/u/v/w/h.");
	}
	return VdpSlotSource{
		static_cast<u32>(asNumber(slot)),
		static_cast<u32>(asNumber(u)),
		static_cast<u32>(asNumber(v)),
		static_cast<u32>(asNumber(w)),
		static_cast<u32>(asNumber(h)),
	};
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
	throw BMSX_RUNTIME_ERROR("vec3 expects a table or native object.");
}

std::array<f32, 3> Api::read_light_color(const Value& value) {
	if (valueIsNumber(value)) {
		const Color color = palette_color(static_cast<int>(asNumber(value)));
		return {color.r, color.g, color.b};
	}
	if (valueIsTable(value)) {
		auto* tbl = asTable(value);
		const Value red = tbl->get(m_keys.r);
		if (!isNil(red)) {
			return {
				static_cast<f32>(asNumber(red)),
				static_cast<f32>(asNumber(tbl->get(m_keys.g))),
				static_cast<f32>(asNumber(tbl->get(m_keys.b))),
			};
		}
	}
	const Vec3 color = read_vec3(value);
	return {color.x, color.y, color.z};
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
