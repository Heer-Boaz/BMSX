#include "vm_api.h"

#include "../core/engine.h"
#include "../input/input.h"
#include "vm_runtime.h"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <stdexcept>

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

} // namespace

VMApi::VMApi(VMRuntime& runtime)
	: m_runtime(runtime)
	, m_persistentData(PERSISTENT_DATA_SIZE, 0.0)
{
	m_font = std::make_unique<VMFont>(EngineCore::instance().assets());
	reset_print_cursor();
}

VMApi::~VMApi() = default;

void VMApi::registerAllFunctions() {
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

m_runtime.registerNativeFunction("put_rectfillcolor", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	int x0 = static_cast<int>(std::floor(asNumber(args.at(0))));
	int y0 = static_cast<int>(std::floor(asNumber(args.at(1))));
	int x1 = static_cast<int>(std::floor(asNumber(args.at(2))));
	int y1 = static_cast<int>(std::floor(asNumber(args.at(3))));
	int z = static_cast<int>(std::floor(asNumber(args.at(4))));
	Color color = resolve_color(args.at(5));
	put_rectfillcolor(x0, y0, x1, y1, z, color);
	(void)out;
});

m_runtime.registerNativeFunction("put_sprite", [this, key](const std::vector<Value>& args, std::vector<Value>& out) {
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
	}

	put_sprite(submission);
	(void)out;
});

m_runtime.registerNativeFunction("put_glyphs", [this, key](const std::vector<Value>& args, std::vector<Value>& out) {
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

	EngineCore::instance().view()->renderer.submit.glyphs(submission);
	(void)out;
});

m_runtime.registerNativeFunction("put_poly", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	std::vector<f32> points = read_polygon(args.at(0));
	float z = static_cast<float>(asNumber(args.at(1)));
	Color color = palette_color(static_cast<int>(std::floor(asNumber(args.at(2)))));
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

m_runtime.registerNativeFunction("write", [this, readOptionalInt](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& text = asText(args.at(0));
	write(text, readOptionalInt(args, 1), readOptionalInt(args, 2), readOptionalInt(args, 3), readOptionalInt(args, 4));
	(void)out;
});

m_runtime.registerNativeFunction("write_color", [this, readOptionalInt](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& text = asText(args.at(0));
	Value colorValue = args.size() > 4 ? args.at(4) : valueNil();
	write_color(text, readOptionalInt(args, 1), readOptionalInt(args, 2), readOptionalInt(args, 3), colorValue);
	(void)out;
});

m_runtime.registerNativeFunction("write_with_font", [this, readOptionalInt](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& text = asText(args.at(0));
	write_with_font(text, readOptionalInt(args, 1), readOptionalInt(args, 2), readOptionalInt(args, 3), readOptionalInt(args, 4), m_font.get());
	(void)out;
});

m_runtime.registerNativeFunction("write_inline_with_font", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& text = asText(args.at(0));
	int x = static_cast<int>(std::floor(asNumber(args.at(1))));
	int y = static_cast<int>(std::floor(asNumber(args.at(2))));
	int z = static_cast<int>(std::floor(asNumber(args.at(3))));
	int colorIndex = static_cast<int>(std::floor(asNumber(args.at(4))));
	write_inline_with_font(text, x, y, z, colorIndex, m_font.get());
	(void)out;
});

m_runtime.registerNativeFunction("write_inline_span_with_font", [this](const std::vector<Value>& args, std::vector<Value>& out) {
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

m_runtime.registerNativeFunction("action_triggered", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& action = asText(args.at(0));
	std::optional<int> playerIndex;
	if (args.size() > 1 && !isNil(args[1])) {
		playerIndex = static_cast<int>(std::floor(asNumber(args.at(1))));
	}
	out.push_back(valueBool(action_triggered(action, playerIndex)));
});

m_runtime.registerNativeFunction("cartdata", [this](const std::vector<Value>& args, std::vector<Value>& out) {
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

m_runtime.registerNativeFunction("sfx", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& id = asText(args.at(0));
	sfx(id);
	(void)out;
});

m_runtime.registerNativeFunction("stop_sfx", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	(void)args;
	stop_sfx();
	(void)out;
});

m_runtime.registerNativeFunction("music", [this](const std::vector<Value>& args, std::vector<Value>& out) {
	const std::string& id = asText(args.at(0));
	music(id);
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

int VMApi::display_width() const {
	return static_cast<int>(EngineCore::instance().view()->viewportSize.x);
}

int VMApi::display_height() const {
	return static_cast<int>(EngineCore::instance().view()->viewportSize.y);
}

double VMApi::stat(int /*index*/) const {
	throw std::runtime_error("stat is not implemented.");
}

void VMApi::cls(int colorIndex) {
	RectRenderSubmission submission;
	submission.kind = RectRenderSubmission::Kind::Fill;
	submission.area = {0.0f, 0.0f, static_cast<f32>(display_width()), static_cast<f32>(display_height())};
	submission.color = palette_color(colorIndex);
	EngineCore::instance().view()->renderer.submit.rect(submission);
	reset_print_cursor();
}

void VMApi::put_rect(int x0, int y0, int x1, int y1, int /*z*/, int colorIndex) {
	RectRenderSubmission submission;
	submission.kind = RectRenderSubmission::Kind::Rect;
	submission.area = {static_cast<f32>(x0), static_cast<f32>(y0), static_cast<f32>(x1), static_cast<f32>(y1)};
	submission.color = palette_color(colorIndex);
	EngineCore::instance().view()->renderer.submit.rect(submission);
}

void VMApi::put_rectfill(int x0, int y0, int x1, int y1, int /*z*/, int colorIndex) {
	RectRenderSubmission submission;
	submission.kind = RectRenderSubmission::Kind::Fill;
	submission.area = {static_cast<f32>(x0), static_cast<f32>(y0), static_cast<f32>(x1), static_cast<f32>(y1)};
	submission.color = palette_color(colorIndex);
	EngineCore::instance().view()->renderer.submit.rect(submission);
}

void VMApi::put_rectfillcolor(int x0, int y0, int x1, int y1, int /*z*/, const Color& color) {
	RectRenderSubmission submission;
	submission.kind = RectRenderSubmission::Kind::Fill;
	submission.area = {static_cast<f32>(x0), static_cast<f32>(y0), static_cast<f32>(x1), static_cast<f32>(y1)};
	submission.color = color;
	EngineCore::instance().view()->renderer.submit.rect(submission);
}

void VMApi::put_sprite(const ImgRenderSubmission& submission) {
	EngineCore::instance().view()->renderer.submit.sprite(submission);
}

void VMApi::put_poly(const PolyRenderSubmission& submission) {
	EngineCore::instance().view()->renderer.submit.poly(submission);
}

void VMApi::put_mesh(const MeshRenderSubmission& submission) {
	EngineCore::instance().view()->renderer.submit.mesh(submission);
}

void VMApi::put_particle(const ParticleRenderSubmission& submission) {
	EngineCore::instance().view()->renderer.submit.particle(submission);
}

void VMApi::write(const std::string& text, std::optional<int> x, std::optional<int> y,
                  std::optional<int> z, std::optional<int> colorIndex) {
	int baseX = m_textCursorX;
	int baseY = m_textCursorY;
	if (x.has_value() && y.has_value()) {
		m_textCursorHomeX = x.value();
		m_textCursorX = m_textCursorHomeX;
		m_textCursorY = y.value();
		baseX = m_textCursorX;
		baseY = m_textCursorY;
	}
	if (colorIndex.has_value() && colorIndex.value() != 0) {
		m_textCursorColorIndex = colorIndex.value();
	}
	Color color = palette_color(m_textCursorColorIndex);
	draw_multiline_text(text, baseX, baseY, z.value_or(0), color, *m_font);
	advance_print_cursor(m_font->lineHeight());
}

void VMApi::write_color(const std::string& text, std::optional<int> x, std::optional<int> y,
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

void VMApi::write_with_font(const std::string& text, std::optional<int> x, std::optional<int> y,
                            std::optional<int> z, std::optional<int> colorIndex, VMFont* font) {
	VMFont* renderFont = font ? font : m_font.get();
	int baseX = m_textCursorX;
	int baseY = m_textCursorY;
	if (x.has_value() && y.has_value()) {
		m_textCursorHomeX = x.value();
		m_textCursorX = m_textCursorHomeX;
		m_textCursorY = y.value();
		baseX = m_textCursorX;
		baseY = m_textCursorY;
	}
	if (colorIndex.has_value() && colorIndex.value() != 0) {
		m_textCursorColorIndex = colorIndex.value();
	}
	Color color = palette_color(m_textCursorColorIndex);
	draw_multiline_text(text, baseX, baseY, z.value_or(0), color, *renderFont);
	advance_print_cursor(renderFont->lineHeight());
}

void VMApi::write_inline_with_font(const std::string& text, int x, int y, int z, int colorIndex, VMFont* font) {
	GlyphRenderSubmission submission;
	submission.glyphs = {text};
	submission.x = static_cast<f32>(x);
	submission.y = static_cast<f32>(y);
	submission.z = static_cast<f32>(z);
	submission.color = palette_color(colorIndex);
	submission.font = font ? font : m_font.get();
	EngineCore::instance().view()->renderer.submit.glyphs(submission);
}

void VMApi::write_inline_span_with_font(const std::string& text, int start, int end,
                                        int x, int y, int z, int colorIndex, VMFont* font) {
	GlyphRenderSubmission submission;
	submission.glyphs = {text};
	submission.glyph_start = start;
	submission.glyph_end = end;
	submission.x = static_cast<f32>(x);
	submission.y = static_cast<f32>(y);
	submission.z = static_cast<f32>(z);
	submission.color = palette_color(colorIndex);
	submission.font = font ? font : m_font.get();
	EngineCore::instance().view()->renderer.submit.glyphs(submission);
}

bool VMApi::action_triggered(const std::string& actionDefinition, std::optional<int> playerIndex) const {
	int index = playerIndex.has_value() ? playerIndex.value() : m_runtime.playerIndex();
	PlayerInput* input = Input::instance().getPlayerInput(index);
	return input->checkActionTriggered(actionDefinition);
}

void VMApi::cartdata(const std::string& ns) {
	m_cartDataNamespace = ns;
}

void VMApi::dset(int index, double value) {
	m_persistentData.at(static_cast<size_t>(index)) = value;
}

double VMApi::dget(int index) const {
	return m_persistentData.at(static_cast<size_t>(index));
}

void VMApi::sfx(const std::string& id) {
	EngineCore::instance().audioEventManager()->playDirect(id);
}

void VMApi::stop_sfx() {
	EngineCore::instance().soundMaster()->stopEffect();
}

void VMApi::music(const std::string& id) {
	auto* soundMaster = EngineCore::instance().soundMaster();
	if (id.empty()) {
		soundMaster->stopMusic();
		return;
	}
	soundMaster->stopMusic();
	soundMaster->play(id);
}

void VMApi::stop_music() {
	EngineCore::instance().soundMaster()->stopMusic();
}

void VMApi::set_master_volume(double volume) {
	EngineCore::instance().soundMaster()->setMasterVolume(static_cast<f32>(volume));
}

void VMApi::pause_audio() {
	EngineCore::instance().soundMaster()->pauseAll();
}

void VMApi::resume_audio() {
	EngineCore::instance().soundMaster()->resume();
}

void VMApi::reboot() {
	m_runtime.requestProgramReload();
}

std::string VMApi::expand_tabs(const std::string& text) const {
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

void VMApi::draw_multiline_text(const std::string& text, int x, int y, int z, const Color& color, VMFont& font) {
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
			EngineCore::instance().view()->renderer.submit.glyphs(submission);
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

void VMApi::advance_print_cursor(int lineHeight) {
	m_textCursorY += lineHeight;
	int limit = display_height() - lineHeight;
	if (m_textCursorY >= limit) {
		m_textCursorY = 0;
	}
}

void VMApi::reset_print_cursor() {
	m_textCursorHomeX = 0;
	m_textCursorX = 0;
	m_textCursorY = 0;
	m_textCursorColorIndex = m_defaultPrintColorIndex;
}

Color VMApi::palette_color(int index) const {
	return paletteColor(index);
}

Color VMApi::resolve_color(const Value& value) {
	if (valueIsNumber(value)) {
		return palette_color(static_cast<int>(std::floor(asNumber(value))));
	}
	if (!valueIsTable(value)) {
		throw std::runtime_error("Color expects a number or table.");
	}
	auto* tbl = asTable(value);
	Color color;
	color.r = static_cast<f32>(asNumber(tbl->get(m_runtime.canonicalizeIdentifier("r"))));
	color.g = static_cast<f32>(asNumber(tbl->get(m_runtime.canonicalizeIdentifier("g"))));
	color.b = static_cast<f32>(asNumber(tbl->get(m_runtime.canonicalizeIdentifier("b"))));
	color.a = static_cast<f32>(asNumber(tbl->get(m_runtime.canonicalizeIdentifier("a"))));
	return color;
}

RenderLayer VMApi::resolve_layer(const Value& value) {
	if (valueIsString(value)) {
		const std::string& key = m_runtime.cpu().stringPool().toString(asStringId(value));
		if (key == "ui") return RenderLayer::UI;
		if (key == "ide") return RenderLayer::IDE;
	}
	return RenderLayer::World;
}

std::vector<f32> VMApi::read_polygon(const Value& value) {
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
	throw std::runtime_error("put_poly expects a table or native object.");
}

Vec3 VMApi::read_vec3(const Value& value) {
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
	throw std::runtime_error("put_particle expects a table or native object.");
}

std::array<f32, 16> VMApi::read_matrix(const Value& value) {
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
	throw std::runtime_error("put_mesh expects a matrix table.");
}

} // namespace bmsx
