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
		return static_cast<int>(std::floor(std::get<double>(args[index])));
	};

	m_runtime.registerNativeFunction("display_width", [this](const std::vector<Value>&) -> std::vector<Value> {
		return {static_cast<double>(display_width())};
	});

	m_runtime.registerNativeFunction("display_height", [this](const std::vector<Value>&) -> std::vector<Value> {
		return {static_cast<double>(display_height())};
	});

	m_runtime.registerNativeFunction("stat", [this](const std::vector<Value>& args) -> std::vector<Value> {
		int index = static_cast<int>(std::floor(std::get<double>(args.at(0))));
		return {stat(index)};
	});

	m_runtime.registerNativeFunction("cls", [this](const std::vector<Value>& args) -> std::vector<Value> {
		int colorIndex = args.empty() ? 0 : static_cast<int>(std::floor(std::get<double>(args.at(0))));
		cls(colorIndex);
		return {};
	});

	m_runtime.registerNativeFunction("put_rect", [this](const std::vector<Value>& args) -> std::vector<Value> {
		int x0 = static_cast<int>(std::floor(std::get<double>(args.at(0))));
		int y0 = static_cast<int>(std::floor(std::get<double>(args.at(1))));
		int x1 = static_cast<int>(std::floor(std::get<double>(args.at(2))));
		int y1 = static_cast<int>(std::floor(std::get<double>(args.at(3))));
		int z = static_cast<int>(std::floor(std::get<double>(args.at(4))));
		int colorIndex = static_cast<int>(std::floor(std::get<double>(args.at(5))));
		put_rect(x0, y0, x1, y1, z, colorIndex);
		return {};
	});

	m_runtime.registerNativeFunction("put_rectfill", [this](const std::vector<Value>& args) -> std::vector<Value> {
		int x0 = static_cast<int>(std::floor(std::get<double>(args.at(0))));
		int y0 = static_cast<int>(std::floor(std::get<double>(args.at(1))));
		int x1 = static_cast<int>(std::floor(std::get<double>(args.at(2))));
		int y1 = static_cast<int>(std::floor(std::get<double>(args.at(3))));
		int z = static_cast<int>(std::floor(std::get<double>(args.at(4))));
		int colorIndex = static_cast<int>(std::floor(std::get<double>(args.at(5))));
		put_rectfill(x0, y0, x1, y1, z, colorIndex);
		return {};
	});

	m_runtime.registerNativeFunction("put_rectfillcolor", [this](const std::vector<Value>& args) -> std::vector<Value> {
		int x0 = static_cast<int>(std::floor(std::get<double>(args.at(0))));
		int y0 = static_cast<int>(std::floor(std::get<double>(args.at(1))));
		int x1 = static_cast<int>(std::floor(std::get<double>(args.at(2))));
		int y1 = static_cast<int>(std::floor(std::get<double>(args.at(3))));
		int z = static_cast<int>(std::floor(std::get<double>(args.at(4))));
		Color color = resolve_color(args.at(5));
		put_rectfillcolor(x0, y0, x1, y1, z, color);
		return {};
	});

	m_runtime.registerNativeFunction("put_sprite", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& imgId = std::get<std::string>(args.at(0));
		float x = static_cast<float>(std::get<double>(args.at(1)));
		float y = static_cast<float>(std::get<double>(args.at(2)));
		float z = static_cast<float>(std::get<double>(args.at(3)));
		ImgRenderSubmission submission;
		submission.imgid = imgId;
		submission.pos = {x, y, z};
		submission.scale = {1.0f, 1.0f};

		if (args.size() > 4 && std::holds_alternative<std::shared_ptr<Table>>(args[4])) {
			auto options = std::get<std::shared_ptr<Table>>(args[4]);
			Value scaleValue = options->get(std::string("scale"));
			if (!isNil(scaleValue)) {
				if (std::holds_alternative<double>(scaleValue)) {
					float scale = static_cast<float>(std::get<double>(scaleValue));
					submission.scale = {scale, scale};
				} else if (std::holds_alternative<std::shared_ptr<Table>>(scaleValue)) {
					auto scaleTable = std::get<std::shared_ptr<Table>>(scaleValue);
					float scaleX = static_cast<float>(std::get<double>(scaleTable->get(std::string("x"))));
					float scaleY = static_cast<float>(std::get<double>(scaleTable->get(std::string("y"))));
					submission.scale = {scaleX, scaleY};
				}
			}
			Value flipH = options->get(std::string("flip_h"));
			Value flipV = options->get(std::string("flip_v"));
			if (!isNil(flipH) || !isNil(flipV)) {
				FlipOptions flip;
				flip.flip_h = std::holds_alternative<bool>(flipH) && std::get<bool>(flipH);
				flip.flip_v = std::holds_alternative<bool>(flipV) && std::get<bool>(flipV);
				submission.flip = flip;
			}
			Value colorizeValue = options->get(std::string("colorize"));
			if (!isNil(colorizeValue)) {
				submission.colorize = resolve_color(colorizeValue);
			}
		}

		put_sprite(submission);
		return {};
	});

	m_runtime.registerNativeFunction("put_glyphs", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const Value& glyphValue = args.at(0);
		std::vector<std::string> glyphs;
		if (std::holds_alternative<std::string>(glyphValue)) {
			glyphs.push_back(std::get<std::string>(glyphValue));
		} else {
			auto tbl = std::get<std::shared_ptr<Table>>(glyphValue);
			int length = tbl->length();
			for (int i = 1; i <= length; ++i) {
				glyphs.push_back(std::get<std::string>(tbl->get(static_cast<double>(i))));
			}
		}

		float x = static_cast<float>(std::get<double>(args.at(1)));
		float y = static_cast<float>(std::get<double>(args.at(2)));
		float z = static_cast<float>(std::get<double>(args.at(3)));
		GlyphRenderSubmission submission;
		submission.glyphs = std::move(glyphs);
		submission.x = x;
		submission.y = y;
		submission.z = z;
		submission.font = m_font.get();

		if (args.size() > 4 && std::holds_alternative<std::shared_ptr<Table>>(args[4])) {
			auto options = std::get<std::shared_ptr<Table>>(args[4]);
			Value colorValue = options->get(std::string("color"));
			if (!isNil(colorValue)) {
				submission.color = resolve_color(colorValue);
			}
			Value backgroundValue = options->get(std::string("background_color"));
			if (!isNil(backgroundValue)) {
				submission.background_color = resolve_color(backgroundValue);
			}
			Value wrapValue = options->get(std::string("wrap_chars"));
			if (!isNil(wrapValue)) {
				submission.wrap_chars = static_cast<int>(std::floor(std::get<double>(wrapValue)));
			}
			Value centerValue = options->get(std::string("center_block_width"));
			if (!isNil(centerValue)) {
				submission.center_block_width = static_cast<int>(std::floor(std::get<double>(centerValue)));
			}
			Value startValue = options->get(std::string("glyph_start"));
			if (!isNil(startValue)) {
				submission.glyph_start = static_cast<int>(std::floor(std::get<double>(startValue)));
			}
			Value endValue = options->get(std::string("glyph_end"));
			if (!isNil(endValue)) {
				submission.glyph_end = static_cast<int>(std::floor(std::get<double>(endValue)));
			}
			Value layerValue = options->get(std::string("layer"));
			if (!isNil(layerValue)) {
				submission.layer = resolve_layer(layerValue);
			}
		}

		EngineCore::instance().view()->renderer.submit.glyphs(submission);
		return {};
	});

	m_runtime.registerNativeFunction("put_poly", [this](const std::vector<Value>& args) -> std::vector<Value> {
		std::vector<f32> points = read_polygon(args.at(0));
		float z = static_cast<float>(std::get<double>(args.at(1)));
		Color color = palette_color(static_cast<int>(std::floor(std::get<double>(args.at(2)))));
		std::optional<float> thickness;
		std::optional<RenderLayer> layer;
		if (args.size() > 3 && !isNil(args[3])) {
			thickness = static_cast<float>(std::get<double>(args.at(3)));
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
		return {};
	});

	m_runtime.registerNativeFunction("put_mesh", [this](const std::vector<Value>& args) -> std::vector<Value> {
		MeshRenderSubmission submission;
		submission.matrix = read_matrix(args.at(1));
		if (args.size() > 2 && std::holds_alternative<std::shared_ptr<Table>>(args[2])) {
			auto options = std::get<std::shared_ptr<Table>>(args[2]);
			Value receiveShadow = options->get(std::string("receive_shadow"));
			if (!isNil(receiveShadow)) {
				submission.receive_shadow = std::holds_alternative<bool>(receiveShadow) && std::get<bool>(receiveShadow);
			}
		}
		put_mesh(submission);
		return {};
	});

	m_runtime.registerNativeFunction("put_particle", [this](const std::vector<Value>& args) -> std::vector<Value> {
		ParticleRenderSubmission submission;
		submission.position = read_vec3(args.at(0));
		submission.size = static_cast<float>(std::get<double>(args.at(1)));
		submission.color = resolve_color(args.at(2));
		if (args.size() > 3 && std::holds_alternative<std::shared_ptr<Table>>(args[3])) {
			auto options = std::get<std::shared_ptr<Table>>(args[3]);
			Value ambientMode = options->get(std::string("ambient_mode"));
			Value ambientFactor = options->get(std::string("ambient_factor"));
			if (!isNil(ambientMode)) {
				submission.ambient_mode = static_cast<int>(std::floor(std::get<double>(ambientMode)));
			}
			if (!isNil(ambientFactor)) {
				submission.ambient_factor = static_cast<float>(std::get<double>(ambientFactor));
			}
		}
		put_particle(submission);
		return {};
	});

	m_runtime.registerNativeFunction("write", [this, readOptionalInt](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& text = std::get<std::string>(args.at(0));
		write(text, readOptionalInt(args, 1), readOptionalInt(args, 2), readOptionalInt(args, 3), readOptionalInt(args, 4));
		return {};
	});

	m_runtime.registerNativeFunction("write_color", [this, readOptionalInt](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& text = std::get<std::string>(args.at(0));
		Value colorValue = args.size() > 4 ? args.at(4) : Value{std::monostate{}};
		write_color(text, readOptionalInt(args, 1), readOptionalInt(args, 2), readOptionalInt(args, 3), colorValue);
		return {};
	});

	m_runtime.registerNativeFunction("write_with_font", [this, readOptionalInt](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& text = std::get<std::string>(args.at(0));
		write_with_font(text, readOptionalInt(args, 1), readOptionalInt(args, 2), readOptionalInt(args, 3), readOptionalInt(args, 4), m_font.get());
		return {};
	});

	m_runtime.registerNativeFunction("write_inline_with_font", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& text = std::get<std::string>(args.at(0));
		int x = static_cast<int>(std::floor(std::get<double>(args.at(1))));
		int y = static_cast<int>(std::floor(std::get<double>(args.at(2))));
		int z = static_cast<int>(std::floor(std::get<double>(args.at(3))));
		int colorIndex = static_cast<int>(std::floor(std::get<double>(args.at(4))));
		write_inline_with_font(text, x, y, z, colorIndex, m_font.get());
		return {};
	});

	m_runtime.registerNativeFunction("write_inline_span_with_font", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& text = std::get<std::string>(args.at(0));
		int start = static_cast<int>(std::floor(std::get<double>(args.at(1))));
		int end = static_cast<int>(std::floor(std::get<double>(args.at(2))));
		int x = static_cast<int>(std::floor(std::get<double>(args.at(3))));
		int y = static_cast<int>(std::floor(std::get<double>(args.at(4))));
		int z = static_cast<int>(std::floor(std::get<double>(args.at(5))));
		int colorIndex = static_cast<int>(std::floor(std::get<double>(args.at(6))));
		write_inline_span_with_font(text, start, end, x, y, z, colorIndex, m_font.get());
		return {};
	});

	m_runtime.registerNativeFunction("action_triggered", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& action = std::get<std::string>(args.at(0));
		std::optional<int> playerIndex;
		if (args.size() > 1 && !isNil(args[1])) {
			playerIndex = static_cast<int>(std::floor(std::get<double>(args.at(1))));
		}
		return {action_triggered(action, playerIndex)};
	});

	m_runtime.registerNativeFunction("cartdata", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& ns = std::get<std::string>(args.at(0));
		cartdata(ns);
		return {};
	});

	m_runtime.registerNativeFunction("dset", [this](const std::vector<Value>& args) -> std::vector<Value> {
		int index = static_cast<int>(std::floor(std::get<double>(args.at(0))));
		double value = std::get<double>(args.at(1));
		dset(index, value);
		return {};
	});

	m_runtime.registerNativeFunction("dget", [this](const std::vector<Value>& args) -> std::vector<Value> {
		int index = static_cast<int>(std::floor(std::get<double>(args.at(0))));
		return {dget(index)};
	});

	m_runtime.registerNativeFunction("sfx", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& id = std::get<std::string>(args.at(0));
		sfx(id);
		return {};
	});

	m_runtime.registerNativeFunction("stop_sfx", [this](const std::vector<Value>&) -> std::vector<Value> {
		stop_sfx();
		return {};
	});

	m_runtime.registerNativeFunction("music", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& id = std::get<std::string>(args.at(0));
		music(id);
		return {};
	});

	m_runtime.registerNativeFunction("stop_music", [this](const std::vector<Value>&) -> std::vector<Value> {
		stop_music();
		return {};
	});

	m_runtime.registerNativeFunction("set_master_volume", [this](const std::vector<Value>& args) -> std::vector<Value> {
		double volume = std::get<double>(args.at(0));
		set_master_volume(volume);
		return {};
	});

	m_runtime.registerNativeFunction("pause_audio", [this](const std::vector<Value>&) -> std::vector<Value> {
		pause_audio();
		return {};
	});

	m_runtime.registerNativeFunction("resume_audio", [this](const std::vector<Value>&) -> std::vector<Value> {
		resume_audio();
		return {};
	});

	m_runtime.registerNativeFunction("reboot", [this](const std::vector<Value>&) -> std::vector<Value> {
		reboot();
		return {};
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
	if (std::holds_alternative<double>(colorValue)) {
		m_textCursorColorIndex = static_cast<int>(std::floor(std::get<double>(colorValue)));
	}
	Color color = !isNil(colorValue) && !std::holds_alternative<double>(colorValue)
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

Color VMApi::resolve_color(const Value& value) const {
	if (std::holds_alternative<double>(value)) {
		return palette_color(static_cast<int>(std::floor(std::get<double>(value))));
	}
	auto tbl = std::get<std::shared_ptr<Table>>(value);
	Color color;
	color.r = static_cast<f32>(std::get<double>(tbl->get(std::string("r"))));
	color.g = static_cast<f32>(std::get<double>(tbl->get(std::string("g"))));
	color.b = static_cast<f32>(std::get<double>(tbl->get(std::string("b"))));
	color.a = static_cast<f32>(std::get<double>(tbl->get(std::string("a"))));
	return color;
}

RenderLayer VMApi::resolve_layer(const Value& value) const {
	if (std::holds_alternative<std::string>(value)) {
		const std::string& key = std::get<std::string>(value);
		if (key == "ui") return RenderLayer::UI;
		if (key == "ide") return RenderLayer::IDE;
	}
	return RenderLayer::World;
}

std::vector<f32> VMApi::read_polygon(const Value& value) const {
	std::vector<f32> points;
	if (std::holds_alternative<std::shared_ptr<Table>>(value)) {
		auto tbl = std::get<std::shared_ptr<Table>>(value);
		int length = tbl->length();
		for (int i = 1; i + 1 <= length; i += 2) {
			float x = static_cast<float>(std::get<double>(tbl->get(static_cast<double>(i))));
			float y = static_cast<float>(std::get<double>(tbl->get(static_cast<double>(i + 1))));
			points.push_back(x);
			points.push_back(y);
		}
		return points;
	}
	if (std::holds_alternative<std::shared_ptr<NativeObject>>(value)) {
		auto obj = std::get<std::shared_ptr<NativeObject>>(value);
		for (int i = 1; ; i += 2) {
			Value xValue = obj->get(static_cast<double>(i));
			Value yValue = obj->get(static_cast<double>(i + 1));
			if (isNil(xValue) || isNil(yValue)) {
				break;
			}
			float x = static_cast<float>(std::get<double>(xValue));
			float y = static_cast<float>(std::get<double>(yValue));
			points.push_back(x);
			points.push_back(y);
		}
		return points;
	}
	throw std::runtime_error("put_poly expects a table or native object.");
}

Vec3 VMApi::read_vec3(const Value& value) const {
	if (std::holds_alternative<std::shared_ptr<Table>>(value)) {
		auto tbl = std::get<std::shared_ptr<Table>>(value);
		Vec3 out;
		out.x = static_cast<f32>(std::get<double>(tbl->get(std::string("x"))));
		out.y = static_cast<f32>(std::get<double>(tbl->get(std::string("y"))));
		out.z = static_cast<f32>(std::get<double>(tbl->get(std::string("z"))));
		return out;
	}
	if (std::holds_alternative<std::shared_ptr<NativeObject>>(value)) {
		auto obj = std::get<std::shared_ptr<NativeObject>>(value);
		Vec3 out;
		out.x = static_cast<f32>(std::get<double>(obj->get(1.0)));
		out.y = static_cast<f32>(std::get<double>(obj->get(2.0)));
		out.z = static_cast<f32>(std::get<double>(obj->get(3.0)));
		return out;
	}
	throw std::runtime_error("put_particle expects a table or native object.");
}

std::array<f32, 16> VMApi::read_matrix(const Value& value) const {
	std::array<f32, 16> matrix{};
	if (std::holds_alternative<std::shared_ptr<Table>>(value)) {
		auto tbl = std::get<std::shared_ptr<Table>>(value);
		for (int i = 0; i < 16; ++i) {
			matrix[static_cast<size_t>(i)] = static_cast<f32>(std::get<double>(tbl->get(static_cast<double>(i + 1))));
		}
		return matrix;
	}
	if (std::holds_alternative<std::shared_ptr<NativeObject>>(value)) {
		auto obj = std::get<std::shared_ptr<NativeObject>>(value);
		for (int i = 0; i < 16; ++i) {
			matrix[static_cast<size_t>(i)] = static_cast<f32>(std::get<double>(obj->get(static_cast<double>(i + 1))));
		}
		return matrix;
	}
	throw std::runtime_error("put_mesh expects a matrix table.");
}

} // namespace bmsx
