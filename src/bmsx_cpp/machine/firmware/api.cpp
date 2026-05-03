#include "machine/firmware/api.h"
#include "machine/bus/io.h"
#include "machine/common/numeric.h"
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

void Api::registerAllFunctions() {
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

void Api::cartdata(const std::string& ns) {
	m_cartDataNamespace = ns;
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


} // namespace bmsx
