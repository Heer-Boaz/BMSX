#include "vm_api.h"
#include "vm_runtime.h"
#include "../core/engine.h"
#include <array>

namespace bmsx {

// Pointer action names
static const std::vector<std::string> POINTER_ACTIONS = {
	"pointer_primary",
	"pointer_secondary",
	"pointer_aux",
	"pointer_back",
	"pointer_forward",
};

static const std::array<Color, 16> MSX1_PALETTE = {
	Color::fromRGBA8(0, 0, 0, 0),
	Color::fromRGBA8(0, 0, 0, 255),
	Color::fromRGBA8(0, 241, 20, 255),
	Color::fromRGBA8(68, 249, 86, 255),
	Color::fromRGBA8(85, 79, 255, 255),
	Color::fromRGBA8(128, 111, 255, 255),
	Color::fromRGBA8(250, 80, 51, 255),
	Color::fromRGBA8(12, 255, 255, 255),
	Color::fromRGBA8(255, 81, 52, 255),
	Color::fromRGBA8(255, 115, 86, 255),
	Color::fromRGBA8(226, 210, 4, 255),
	Color::fromRGBA8(242, 217, 71, 255),
	Color::fromRGBA8(4, 212, 19, 255),
	Color::fromRGBA8(231, 80, 229, 255),
	Color::fromRGBA8(208, 208, 208, 255),
	Color::fromRGBA8(255, 255, 255, 255),
};

static const Color& paletteColor(int index) {
	return MSX1_PALETTE[static_cast<size_t>(index)];
}

VMApi::VMApi(VMRuntime& runtime)
	: m_runtime(runtime)
	, m_persistentData(PERSISTENT_DATA_SIZE, 0.0)
{
	reset_print_cursor();
}

void VMApi::registerAllFunctions() {
	// Register display functions
	m_runtime.registerNativeFunction("display_width", [this](const std::vector<Value>&) -> std::vector<Value> {
		return {static_cast<double>(display_width())};
	});

	m_runtime.registerNativeFunction("display_height", [this](const std::vector<Value>&) -> std::vector<Value> {
		return {static_cast<double>(display_height())};
	});

	m_runtime.registerNativeFunction("cls", [this](const std::vector<Value>& args) -> std::vector<Value> {
		int colorIndex = args.empty() ? 0 : static_cast<int>(asNumber(args[0]));
		cls(colorIndex);
		return {};
	});

	m_runtime.registerNativeFunction("rect", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.size() < 6) return {};
		int x0 = static_cast<int>(asNumber(args[0]));
		int y0 = static_cast<int>(asNumber(args[1]));
		int x1 = static_cast<int>(asNumber(args[2]));
		int y1 = static_cast<int>(asNumber(args[3]));
		int z = static_cast<int>(asNumber(args[4]));
		int colorIndex = static_cast<int>(asNumber(args[5]));
		rect(x0, y0, x1, y1, z, colorIndex);
		return {};
	});

	m_runtime.registerNativeFunction("rectfill", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.size() < 6) return {};
		int x0 = static_cast<int>(asNumber(args[0]));
		int y0 = static_cast<int>(asNumber(args[1]));
		int x1 = static_cast<int>(asNumber(args[2]));
		int y1 = static_cast<int>(asNumber(args[3]));
		int z = static_cast<int>(asNumber(args[4]));
		int colorIndex = static_cast<int>(asNumber(args[5]));
		rectfill(x0, y0, x1, y1, z, colorIndex);
		return {};
	});

	m_runtime.registerNativeFunction("write", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& text = asString(args.at(0));
		int x = args.size() > 1 ? static_cast<int>(asNumber(args[1])) : m_textCursorX;
		int y = args.size() > 2 ? static_cast<int>(asNumber(args[2])) : m_textCursorY;
		int z = args.size() > 3 ? static_cast<int>(asNumber(args[3])) : 0;
		int colorIndex = args.size() > 4 ? static_cast<int>(asNumber(args[4])) : m_textCursorColorIndex;
		bool autoAdvance = args.size() <= 1;
		write(text, x, y, z, colorIndex);
		if (autoAdvance) {
			m_textCursorX = m_textCursorHomeX;
			m_textCursorY += 8;
		}
		return {};
	});

	// Register input functions
	m_runtime.registerNativeFunction("mousebtn", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {false};
		int btn = static_cast<int>(asNumber(args[0]));
		return {mousebtn(static_cast<VMPointerButton>(btn))};
	});

	m_runtime.registerNativeFunction("mousebtnp", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {false};
		int btn = static_cast<int>(asNumber(args[0]));
		return {mousebtnp(static_cast<VMPointerButton>(btn))};
	});

	m_runtime.registerNativeFunction("mousebtnr", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {false};
		int btn = static_cast<int>(asNumber(args[0]));
		return {mousebtnr(static_cast<VMPointerButton>(btn))};
	});

	m_runtime.registerNativeFunction("mousepos", [this](const std::vector<Value>&) -> std::vector<Value> {
		auto pos = mousepos();
		auto result = std::make_shared<Table>();
		result->set(std::string("x"), static_cast<double>(pos.x));
		result->set(std::string("y"), static_cast<double>(pos.y));
		return {result};
	});

	m_runtime.registerNativeFunction("action_triggered", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {false};
		std::string action = asString(args[0]);
		int playerIndex = args.size() > 1 ? static_cast<int>(asNumber(args[1])) : 1;
		return {action_triggered(action, playerIndex)};
	});

	// Register audio functions
	m_runtime.registerNativeFunction("sfx", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {};
		sfx(asString(args[0]));
		return {};
	});

	m_runtime.registerNativeFunction("stop_sfx", [this](const std::vector<Value>&) -> std::vector<Value> {
		stop_sfx();
		return {};
	});

	m_runtime.registerNativeFunction("music", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {};
		music(asString(args[0]));
		return {};
	});

	m_runtime.registerNativeFunction("stop_music", [this](const std::vector<Value>&) -> std::vector<Value> {
		stop_music();
		return {};
	});

	// Register storage functions
	m_runtime.registerNativeFunction("cartdata", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {};
		cartdata(asString(args[0]));
		return {};
	});

	m_runtime.registerNativeFunction("dset", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.size() < 2) return {};
		dset(static_cast<int>(asNumber(args[0])), asNumber(args[1]));
		return {};
	});

	m_runtime.registerNativeFunction("dget", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {0.0};
		return {dget(static_cast<int>(asNumber(args[0])))};
	});

	// Register system functions
	m_runtime.registerNativeFunction("stat", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {0.0};
		return {stat(static_cast<int>(asNumber(args[0])))};
	});

	m_runtime.registerNativeFunction("reboot", [this](const std::vector<Value>&) -> std::vector<Value> {
		reboot();
		return {};
	});
}

void VMApi::reset_print_cursor() {
	m_textCursorX = 0;
	m_textCursorY = 0;
	m_textCursorHomeX = 0;
	m_textCursorColorIndex = 15;
}

std::string VMApi::pointer_action(VMPointerButton button) const {
	int index = static_cast<int>(button);
	if (index >= 0 && index < static_cast<int>(POINTER_ACTIONS.size())) {
		return POINTER_ACTIONS[index];
	}
	return "pointer_primary";
}

// ==========================================================================
// Display functions implementation
// ==========================================================================

int VMApi::display_width() const {
	return m_runtime.viewport().x;
}

int VMApi::display_height() const {
	return m_runtime.viewport().y;
}

void VMApi::cls(int colorIndex) {
	auto* view = EngineCore::instance().view();
	RectBounds area{0.0f, 0.0f, static_cast<f32>(display_width()), static_cast<f32>(display_height())};
	view->fillRectangle(area, paletteColor(colorIndex), RenderLayer::World);
	reset_print_cursor();
}

void VMApi::rect(int x0, int y0, int x1, int y1, int /*z*/, int colorIndex) {
	auto* view = EngineCore::instance().view();
	RectBounds area{static_cast<f32>(x0), static_cast<f32>(y0), static_cast<f32>(x1), static_cast<f32>(y1)};
	view->drawRectangle(area, paletteColor(colorIndex), RenderLayer::World);
}

void VMApi::rectfill(int x0, int y0, int x1, int y1, int /*z*/, int colorIndex) {
	auto* view = EngineCore::instance().view();
	RectBounds area{static_cast<f32>(x0), static_cast<f32>(y0), static_cast<f32>(x1), static_cast<f32>(y1)};
	view->fillRectangle(area, paletteColor(colorIndex), RenderLayer::World);
}

void VMApi::write(const std::string& text, int x, int y, int z, int colorIndex) {
	auto* view = EngineCore::instance().view();
	GlyphRenderSubmission submission;
	submission.text = text;
	submission.x = static_cast<f32>(x);
	submission.y = static_cast<f32>(y);
	submission.z = static_cast<f32>(z);
	submission.color = paletteColor(colorIndex);
	view->renderer.submit.glyphs(submission);
}

// ==========================================================================
// Input functions implementation
// ==========================================================================

bool VMApi::mousebtn(VMPointerButton /*button*/) const {
	// TODO: Query input system
	return false;
}

bool VMApi::mousebtnp(VMPointerButton /*button*/) const {
	// TODO: Query input system
	return false;
}

bool VMApi::mousebtnr(VMPointerButton /*button*/) const {
	// TODO: Query input system
	return false;
}

VMPointerViewport VMApi::mousepos() const {
	// TODO: Query input system
	return {0, 0};
}

VMPointerVector VMApi::pointer_screen_position() const {
	// TODO: Query input system
	return {0.0f, 0.0f};
}

VMPointerVector VMApi::pointer_delta() const {
	// TODO: Query input system
	return {0.0f, 0.0f};
}

VMPointerWheel VMApi::mousewheel() const {
	// TODO: Query input system
	return {0.0f, 0.0f};
}

bool VMApi::action_triggered(const std::string& /*actionDefinition*/, int /*playerIndex*/) const {
	// TODO: Query input system
	return false;
}

// ==========================================================================
// Audio functions implementation
// ==========================================================================

void VMApi::sfx(const std::string& /*id*/) {
	// TODO: Play sound effect
}

void VMApi::stop_sfx() {
	// TODO: Stop sound effects
}

void VMApi::music(const std::string& /*id*/) {
	// TODO: Play music
}

void VMApi::stop_music() {
	// TODO: Stop music
}

// ==========================================================================
// Storage functions implementation
// ==========================================================================

void VMApi::cartdata(const std::string& ns) {
	m_cartDataNamespace = ns;
	// TODO: Load persistent data from storage
}

void VMApi::dset(int index, double value) {
	if (index >= 0 && index < PERSISTENT_DATA_SIZE) {
		m_persistentData[index] = value;
		// TODO: Save to persistent storage
	}
}

double VMApi::dget(int index) const {
	if (index >= 0 && index < PERSISTENT_DATA_SIZE) {
		return m_persistentData[index];
	}
	return 0.0;
}

// ==========================================================================
// System functions implementation
// ==========================================================================

double VMApi::stat(int index) const {
	switch (index) {
		case 0:  // Memory usage (KB)
			return 0.0;
		case 1:  // CPU usage (fraction)
			return 0.0;
		case 4:  // Clipboard contents (as string - not returning string here)
			return 0.0;
		case 7:  // Frame rate
			return 60.0;
		case 30: // Key input
			return 0.0;
		case 31: // Key input repeat
			return 0.0;
		case 32: // Mouse X
			return mousepos().x;
		case 33: // Mouse Y
			return mousepos().y;
		case 34: // Mouse button bitmask
			return 0.0;
		case 36: // Mouse wheel X
			return mousewheel().x;
		case 37: // Mouse wheel Y
			return mousewheel().y;
		default:
			return 0.0;
	}
}

void VMApi::reboot() {
	m_runtime.requestProgramReload();
}

} // namespace bmsx
