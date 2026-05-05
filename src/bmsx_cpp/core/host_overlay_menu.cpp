#include "core/host_overlay_menu.h"

#include "core/console.h"
#include "render/shared/bitmap_font.h"
#include "core/rom_boot_manager.h"
#include "input/manager.h"
#include "machine/bus/io.h"
#include "machine/runtime/runtime.h"
#include "platform/platform.h"
#include "render/gameview.h"
#include <array>
#include <cstdio>

namespace bmsx {
namespace {

constexpr i32 kMenuOptionCount = 13;
constexpr const char* kToggleValues[] = {"OFF", "ON"};
constexpr const char* kDitherValues[] = {"OFF", "PSX RGB555", "RGB777 OUTPUT", "MSX10 3:4:3"};
constexpr const char* kTitleText = "CORE OPTIONS";
constexpr const char* kFpsPrefix = "FPS: ";
constexpr i32 kUsageLabelWidth = 28;
constexpr i32 kUsageBarWidth = 54;
constexpr i32 kUsageBarHeight = 5;
constexpr i32 kUsageX = 8;
constexpr i32 kUsageBarX = kUsageX + kUsageLabelWidth;
constexpr i32 kUsageY = 8;
constexpr f32 kUsageZ = 9000.0f;
constexpr i32 kUsagePanelWidth = 112;
constexpr i32 kUsagePanelHeight = 42;
constexpr i32 kUsageRowHeight = 10;
constexpr i32 kUsageLowPercentTenthsLimit = 100;
constexpr i32 kUsagePercentTenthsFlag = 1000000;
constexpr std::array<const char*, 4> kUsageLabels{"CPU", "RAM", "VRAM", "VDP"};

struct HostMenuButton {
	const char* gamepad;
	const char* keyboard;
};

constexpr HostMenuButton kButtonStart{"start", "Enter"};
constexpr HostMenuButton kButtonSelect{"select", "Backspace"};
constexpr HostMenuButton kButtonLb{"lb", "ShiftLeft"};
constexpr HostMenuButton kButtonRb{"rb", "ShiftRight"};
constexpr HostMenuButton kButtonUp{"up", "ArrowUp"};
constexpr HostMenuButton kButtonDown{"down", "ArrowDown"};
constexpr HostMenuButton kButtonLeft{"left", "ArrowLeft"};
constexpr HostMenuButton kButtonRight{"right", "ArrowRight"};
constexpr HostMenuButton kButtonA{"a", "KeyX"};
constexpr HostMenuButton kButtonB{"b", "KeyC"};

constexpr std::array<HostMenuButton, 4> kToggleButtons{kButtonStart, kButtonSelect, kButtonLb, kButtonRb};
constexpr std::array<HostMenuButton, 7> kMenuButtons{kButtonUp, kButtonDown, kButtonLeft, kButtonRight, kButtonA, kButtonB, kButtonStart};

const Color kPanelColor{0.03f, 0.03f, 0.03f, 0.80f};
const Color kHighlightColor{0.12f, 0.25f, 0.38f, 0.86f};
const Color kTextColor{0.94f, 0.94f, 0.94f, 1.0f};
const Color kDimColor{0.70f, 0.70f, 0.70f, 1.0f};
const Color kTitleColor{0.36f, 0.78f, 1.0f, 1.0f};
const Color kUsagePanelColor{0.0f, 0.0f, 0.0f, 1.0f};
const Color kUsageTextColor{1.0f, 1.0f, 1.0f, 1.0f};
const Color kUsageDimColor{208.0f / 255.0f, 208.0f / 255.0f, 208.0f / 255.0f, 1.0f};
const Color kUsageOkColor{4.0f / 255.0f, 212.0f / 255.0f, 19.0f / 255.0f, 1.0f};
const Color kUsageWarnColor{226.0f / 255.0f, 210.0f / 255.0f, 4.0f / 255.0f, 1.0f};
const Color kUsageDangerColor{1.0f, 81.0f / 255.0f, 52.0f / 255.0f, 1.0f};

enum class HostMenuOptionId : i32 {
	ShowUsageGizmo,
	CrtPost,
	CrtNoise,
	CrtColorBleed,
	CrtScanlines,
	CrtBlur,
	CrtGlow,
	CrtFringing,
	CrtAperture,
	Dither,
	HostShowFps,
	RebootCart,
	ExitGame,
};

struct HostMenuOptionDef {
	HostMenuOptionId id;
	const char* label;
	const char* const* values;
	i32 valueCount;
};

constexpr std::array<HostMenuOptionDef, kMenuOptionCount> kOptions{{
	{HostMenuOptionId::ShowUsageGizmo, "Show Usage Gizmo", kToggleValues, 2},
	{HostMenuOptionId::CrtPost, "CRT Post-processing", kToggleValues, 2},
	{HostMenuOptionId::CrtNoise, "CRT Noise", kToggleValues, 2},
	{HostMenuOptionId::CrtColorBleed, "CRT Color Bleed", kToggleValues, 2},
	{HostMenuOptionId::CrtScanlines, "CRT Scanlines", kToggleValues, 2},
	{HostMenuOptionId::CrtBlur, "CRT Blur", kToggleValues, 2},
	{HostMenuOptionId::CrtGlow, "CRT Glow", kToggleValues, 2},
	{HostMenuOptionId::CrtFringing, "CRT Fringing", kToggleValues, 2},
	{HostMenuOptionId::CrtAperture, "CRT Aperture", kToggleValues, 2},
	{HostMenuOptionId::Dither, "Dither", kDitherValues, 4},
	{HostMenuOptionId::HostShowFps, "HOST: SHOW FPS", kToggleValues, 2},
	{HostMenuOptionId::RebootCart, "REBOOT CART", nullptr, 0},
	{HostMenuOptionId::ExitGame, "EXIT GAME", nullptr, 0},
}};

bool buttonPressed(PlayerInput& player, const HostMenuButton& button) {
	if (player.getRawButtonState(button.gamepad, InputSource::Gamepad).pressed) {
		return true;
	}
	return player.getRawButtonState(button.keyboard, InputSource::Keyboard).pressed;
}

bool buttonJustPressed(PlayerInput& player, const HostMenuButton& button) {
	return player.getRawButtonState(button.gamepad, InputSource::Gamepad).justpressed || player.getRawButtonState(button.keyboard, InputSource::Keyboard).justpressed;
}

bool buttonEdge(PlayerInput& player, const HostMenuButton& button) {
	const ActionState gamepad = player.getButtonRepeatState(button.gamepad, InputSource::Gamepad);
	const ActionState keyboard = player.getButtonRepeatState(button.keyboard, InputSource::Keyboard);
	return gamepad.justpressed || keyboard.justpressed || actionFlag(gamepad.repeatpressed) || actionFlag(keyboard.repeatpressed);
}

i32 boolIndex(bool value) {
	return value ? 1 : 0;
}

bool boolFromIndex(i32 index) {
	return index != 0;
}

i32 optionIndex(ConsoleCore& console, GameView& view, i32 option) {
	switch (kOptions[static_cast<size_t>(option)].id) {
		case HostMenuOptionId::ShowUsageGizmo: return boolIndex(view.showResourceUsageGizmo);
		case HostMenuOptionId::CrtPost: return boolIndex(view.crt_postprocessing_enabled);
		case HostMenuOptionId::CrtNoise: return boolIndex(view.applyNoise);
		case HostMenuOptionId::CrtColorBleed: return boolIndex(view.applyColorBleed);
		case HostMenuOptionId::CrtScanlines: return boolIndex(view.applyScanlines);
		case HostMenuOptionId::CrtBlur: return boolIndex(view.applyBlur);
		case HostMenuOptionId::CrtGlow: return boolIndex(view.applyGlow);
		case HostMenuOptionId::CrtFringing: return boolIndex(view.applyFringing);
		case HostMenuOptionId::CrtAperture: return boolIndex(view.applyAperture);
		case HostMenuOptionId::Dither: return static_cast<i32>(console.runtime().machine().memory().readIoU32(IO_VDP_DITHER));
		case HostMenuOptionId::HostShowFps: return boolIndex(console.hostShowFps);
		case HostMenuOptionId::RebootCart: return 0;
		case HostMenuOptionId::ExitGame: return 0;
	}
	return 0;
}

void setOptionIndex(ConsoleCore& console, GameView& view, i32 option, i32 value) {
	switch (kOptions[static_cast<size_t>(option)].id) {
		case HostMenuOptionId::ShowUsageGizmo: view.showResourceUsageGizmo = boolFromIndex(value); break;
		case HostMenuOptionId::CrtPost: view.crt_postprocessing_enabled = boolFromIndex(value); break;
		case HostMenuOptionId::CrtNoise: view.applyNoise = boolFromIndex(value); break;
		case HostMenuOptionId::CrtColorBleed: view.applyColorBleed = boolFromIndex(value); break;
		case HostMenuOptionId::CrtScanlines: view.applyScanlines = boolFromIndex(value); break;
		case HostMenuOptionId::CrtBlur: view.applyBlur = boolFromIndex(value); break;
		case HostMenuOptionId::CrtGlow: view.applyGlow = boolFromIndex(value); break;
		case HostMenuOptionId::CrtFringing: view.applyFringing = boolFromIndex(value); break;
		case HostMenuOptionId::CrtAperture: view.applyAperture = boolFromIndex(value); break;
		case HostMenuOptionId::Dither: console.runtime().machine().memory().writeValue(IO_VDP_DITHER, valueNumber(static_cast<double>(value))); break;
		case HostMenuOptionId::HostShowFps: console.hostShowFps = boolFromIndex(value); break;
		case HostMenuOptionId::RebootCart: break;
		case HostMenuOptionId::ExitGame: break;
	}
}

template <size_t N>
void consumeButtons(PlayerInput& player, const std::array<HostMenuButton, N>& buttons) {
	for (const HostMenuButton& button : buttons) {
		player.consumeRawButton(button.gamepad, InputSource::Gamepad);
		player.consumeRawButton(button.keyboard, InputSource::Keyboard);
	}
}

void configureRect(RectRenderSubmission& submission, const Color& color) {
	submission.kind = RectRenderSubmission::Kind::Fill;
	submission.color = color;
	submission.layer = RenderLayer::IDE;
}

void configureGlyphs(GlyphRenderSubmission& submission, const char* text, const Color& color) {
	submission.glyphs.clear();
	submission.glyphs.emplace_back(text);
	submission.glyph_start = 0;
	submission.glyph_end = static_cast<i32>(submission.glyphs[0].size());
	submission.z = 922.0f;
	submission.color = color;
	submission.layer = RenderLayer::IDE;
}

const Color& usageColor(double ratio) {
	if (ratio >= 0.9) return kUsageDangerColor;
	if (ratio >= 0.7) return kUsageWarnColor;
	return kUsageOkColor;
}

i32 usageFillWidth(double used, double total) {
	i32 fillWidth = static_cast<i32>(static_cast<double>(kUsageBarWidth) * used / total);
	if (used > 0.0 && fillWidth == 0) {
		fillWidth = 1;
	}
	if (fillWidth > kUsageBarWidth) {
		fillWidth = kUsageBarWidth;
	}
	return fillWidth;
}

i32 usagePercentCode(double used, double total) {
	if (used == 0.0) {
		return 0;
	}
	i32 tenths = static_cast<i32>((used * 1000.0 / total) + 0.5);
	if (tenths < kUsageLowPercentTenthsLimit) {
		if (tenths == 0) {
			tenths = 1;
		}
		return kUsagePercentTenthsFlag + tenths;
	}
	return static_cast<i32>((used * 100.0 / total) + 0.5);
}

void formatUsagePercentCode(char* target, size_t targetSize, i32 code) {
	if (code >= kUsagePercentTenthsFlag) {
		const i32 tenths = code - kUsagePercentTenthsFlag;
		const i32 whole = tenths / 10;
		std::snprintf(target, targetSize, "%d.%d%%", whole, tenths - whole * 10);
		return;
	}
	std::snprintf(target, targetSize, "%d%%", code);
}

} // namespace

HostOverlayMenu::HostOverlayMenu() {
	configureRect(m_panelRect, kPanelColor);
	configureRect(m_highlightRect, kHighlightColor);
	configureRect(m_usagePanelRect, kUsagePanelColor);
	m_usagePanelRect.area = RectBounds{
		static_cast<f32>(kUsageX - 4),
		static_cast<f32>(kUsageY - 4),
		static_cast<f32>(kUsageX - 4 + kUsagePanelWidth),
		static_cast<f32>(kUsageY - 4 + kUsagePanelHeight),
		kUsageZ
	};
	configureGlyphs(m_titleGlyphs, kTitleText, kTitleColor);
	configureGlyphs(m_fpsGlyphs, "", kTitleColor);
	for (GlyphRenderSubmission& glyphs : m_optionGlyphs) {
		configureGlyphs(glyphs, "", kTextColor);
	}
	m_usagePercentCode.fill(-1);
	for (i32 index = 0; index < UsageBarCount; index += 1) {
		const i32 rowY = kUsageY + index * kUsageRowHeight;
		RectRenderSubmission& background = m_usageBarBackgrounds[static_cast<size_t>(index)];
		RectRenderSubmission& fill = m_usageBarFills[static_cast<size_t>(index)];
		configureRect(background, kUsageDimColor);
		configureRect(fill, kUsageOkColor);
		background.area = RectBounds{
			static_cast<f32>(kUsageBarX),
			static_cast<f32>(rowY + 1),
			static_cast<f32>(kUsageBarX + kUsageBarWidth),
			static_cast<f32>(rowY + 1 + kUsageBarHeight),
			kUsageZ + 1.0f
		};
		fill.area = RectBounds{
			static_cast<f32>(kUsageBarX),
			static_cast<f32>(rowY + 1),
			static_cast<f32>(kUsageBarX),
			static_cast<f32>(rowY + 1 + kUsageBarHeight),
			kUsageZ + 2.0f
		};
		GlyphRenderSubmission& label = m_usageLabels[static_cast<size_t>(index)];
		GlyphRenderSubmission& percent = m_usagePercents[static_cast<size_t>(index)];
		configureGlyphs(label, kUsageLabels[static_cast<size_t>(index)], kUsageDimColor);
		configureGlyphs(percent, "", kUsageTextColor);
		label.x = static_cast<f32>(kUsageX);
		label.y = static_cast<f32>(rowY + 1);
		label.z = kUsageZ + 3.0f;
		percent.x = static_cast<f32>(kUsageBarX + kUsageBarWidth + 1);
		percent.y = static_cast<f32>(rowY + 1);
		percent.z = kUsageZ + 3.0f;
	}
}

HostOverlayMenu& hostOverlayMenu() {
	static HostOverlayMenu menu;
	return menu;
}

size_t HostOverlayMenu::queuedCommandCount() const {
	return m_commandCount;
}

RenderQueues::Host2DEntry HostOverlayMenu::commandAt(size_t index) const {
	return m_commands[index];
}

void HostOverlayMenu::clearRenderCommands() {
	m_commandCount = 0;
}

void HostOverlayMenu::queueCommand(RenderQueues::Host2DKind kind, const RectRenderSubmission* rect, const GlyphRenderSubmission* glyphs) {
	RenderQueues::Host2DEntry& entry = m_commands[m_commandCount];
	entry.kind = kind;
	entry.img = nullptr;
	entry.poly = nullptr;
	entry.rect = rect;
	entry.glyphs = glyphs;
	m_commandCount += 1;
}

bool HostOverlayMenu::tickInput(ConsoleCore& console) {
	GameView* view = console.view();
	PlayerInput& player = *Input::instance().getPlayerInput(1);
	const bool comboEdge = buttonPressed(player, kButtonStart) &&
		buttonPressed(player, kButtonSelect) &&
		buttonPressed(player, kButtonLb) &&
		buttonPressed(player, kButtonRb) &&
		(buttonJustPressed(player, kButtonStart) ||
			buttonJustPressed(player, kButtonSelect) ||
			buttonJustPressed(player, kButtonLb) ||
			buttonJustPressed(player, kButtonRb));
	if (comboEdge) {
		toggle();
		consumeButtons(player, kToggleButtons);
	}
	if (!m_active) {
		return false;
	}
	if (buttonJustPressed(player, kButtonB)) {
		toggle();
		consumeButtons(player, kMenuButtons);
		return false;
	}
	if (buttonEdge(player, kButtonUp)) {
		m_selected = m_selected == 0 ? kMenuOptionCount - 1 : m_selected - 1;
		m_dirtyText = true;
	}
	if (buttonEdge(player, kButtonDown)) {
		m_selected = (m_selected + 1) % kMenuOptionCount;
		m_dirtyText = true;
	}
	if (buttonEdge(player, kButtonLeft)) {
		changeSelected(console, *view, -1);
	}
	if (buttonEdge(player, kButtonRight)) {
		changeSelected(console, *view, 1);
	}
	if (buttonJustPressed(player, kButtonA)) {
		activateSelected(console);
	}
	consumeButtons(player, kMenuButtons);
	return true;
}

void HostOverlayMenu::queueRenderCommands(ConsoleCore& console, GameView& view) {
	clearRenderCommands();
	const RenderQueues::Host2DKind rectKind = RenderQueues::Host2DKind::Rect;
	const RenderQueues::Host2DKind glyphsKind = RenderQueues::Host2DKind::Glyphs;
	if (m_dirtyText) {
		rebuildText(console, view);
	}
	BFont* font = view.default_font;
	const i32 lineHeight = font->lineHeight() > 10 ? 10 : font->lineHeight();
	const i32 padding = 4;
	const i32 titleHeight = lineHeight;
	const i32 titleGap = 4;
	i32 boxWidth = font->measure(kTitleText);
	for (const std::string& line : m_lineText) {
		const i32 width = font->measure(line);
		if (width > boxWidth) {
			boxWidth = width;
		}
	}
	boxWidth += padding * 2;
	const i32 boxHeight = kMenuOptionCount * lineHeight + padding * 2;
	const i32 totalHeight = titleHeight + titleGap + boxHeight;
	const i32 left = (static_cast<i32>(view.viewportSize.x) - boxWidth) / 2;
	const i32 top = (static_cast<i32>(view.viewportSize.y) - totalHeight) / 2;
	const i32 boxTop = top + titleHeight + titleGap;
	m_panelRect.area = RectBounds{static_cast<f32>(left), static_cast<f32>(boxTop), static_cast<f32>(left + boxWidth), static_cast<f32>(boxTop + boxHeight), 920.0f};
	queueCommand(rectKind, &m_panelRect, nullptr);
	m_titleGlyphs.font = font;
	m_titleGlyphs.x = static_cast<f32>(left + padding);
	m_titleGlyphs.y = static_cast<f32>(top);
	queueCommand(glyphsKind, nullptr, &m_titleGlyphs);
	for (i32 index = 0; index < kMenuOptionCount; index += 1) {
		const i32 y = boxTop + padding + index * lineHeight;
		if (index == m_selected) {
			m_highlightRect.area = RectBounds{static_cast<f32>(left), static_cast<f32>(y - 2), static_cast<f32>(left + boxWidth), static_cast<f32>(y + lineHeight - 2), 921.0f};
			queueCommand(rectKind, &m_highlightRect, nullptr);
		}
		GlyphRenderSubmission& glyphs = m_optionGlyphs[static_cast<size_t>(index)];
		glyphs.font = font;
		glyphs.x = static_cast<f32>(left + padding);
		glyphs.y = static_cast<f32>(y);
		glyphs.color = index == m_selected ? kTextColor : kDimColor;
		queueCommand(glyphsKind, nullptr, &glyphs);
	}
}

bool HostOverlayMenu::queueFrameOverlayCommands(ConsoleCore& console, GameView& view) {
	clearRenderCommands();
	const RenderQueues::Host2DKind rectKind = RenderQueues::Host2DKind::Rect;
	const RenderQueues::Host2DKind glyphsKind = RenderQueues::Host2DKind::Glyphs;
	if (m_active) {
		return false;
	}
	bool queued = false;
	BFont* font = view.default_font;
	if (console.hostShowFps) {
		const i32 fpsTenths = static_cast<i32>((console.fps() * 10.0) + 0.5);
		if (m_fpsTextTenths != fpsTenths || m_fpsGlyphs.font != font) {
			m_fpsTextTenths = fpsTenths;
			const i32 whole = fpsTenths / 10;
			char buffer[32];
			std::snprintf(buffer, sizeof(buffer), "%s%d.%d", kFpsPrefix, whole, fpsTenths - whole * 10);
			m_fpsText = buffer;
			m_fpsGlyphs.glyphs[0] = m_fpsText;
			m_fpsGlyphs.glyph_end = static_cast<i32>(m_fpsGlyphs.glyphs[0].size());
			m_fpsGlyphs.font = font;
			m_fpsTextWidth = font->measure(m_fpsText);
		}
		m_fpsGlyphs.x = view.viewportSize.x - 8.0f - static_cast<f32>(m_fpsTextWidth);
		m_fpsGlyphs.y = 8.0f;
		queueCommand(glyphsKind, nullptr, &m_fpsGlyphs);
		queued = true;
	}
	if (view.showResourceUsageGizmo) {
		Runtime& runtime = console.runtime();
		const i32 vdpBudget = static_cast<i32>(
			(static_cast<double>(runtime.timing.vdpWorkUnitsPerSec) * 1000000.0 / static_cast<double>(runtime.timing.ufpsScaled)) + 0.5
		);
		const std::array<double, UsageBarCount> used{
			static_cast<double>(runtime.cpuUsageCyclesUsed()),
			static_cast<double>(runtime.ramUsedBytes()),
			static_cast<double>(runtime.vramUsedBytes()),
			static_cast<double>(runtime.vdpUsageWorkUnitsLast()),
		};
		const std::array<double, UsageBarCount> total{
			static_cast<double>(runtime.cpuUsageCyclesGranted()),
			static_cast<double>(runtime.ramTotalBytes()),
			static_cast<double>(runtime.vramTotalBytes()),
			static_cast<double>(vdpBudget),
		};
		queueCommand(rectKind, &m_usagePanelRect, nullptr);
		for (i32 index = 0; index < UsageBarCount; index += 1) {
			const size_t offset = static_cast<size_t>(index);
			const double ratio = used[offset] / total[offset];
			const i32 fillWidth = usageFillWidth(used[offset], total[offset]);
			RectRenderSubmission& fill = m_usageBarFills[offset];
			fill.area.right = static_cast<f32>(kUsageBarX + fillWidth);
			fill.color = (index == 3 && runtime.vdpUsageFrameHeld()) ? kUsageDangerColor : usageColor(ratio);
			GlyphRenderSubmission& label = m_usageLabels[offset];
			GlyphRenderSubmission& percent = m_usagePercents[offset];
			label.font = font;
			percent.font = font;
			const i32 percentCode = usagePercentCode(used[offset], total[offset]);
			if (m_usagePercentCode[offset] != percentCode) {
				m_usagePercentCode[offset] = percentCode;
				char buffer[32];
				formatUsagePercentCode(buffer, sizeof(buffer), percentCode);
				percent.glyphs[0] = buffer;
				percent.glyph_end = static_cast<i32>(percent.glyphs[0].size());
			}
			queueCommand(rectKind, &m_usageBarBackgrounds[offset], nullptr);
			if (fillWidth > 0) {
				queueCommand(rectKind, &fill, nullptr);
			}
			queueCommand(glyphsKind, nullptr, &label);
			queueCommand(glyphsKind, nullptr, &percent);
		}
		queued = true;
	}
	return queued;
}

void HostOverlayMenu::toggle() {
	m_active = !m_active;
	m_selected = 0;
	m_dirtyText = true;
}

void HostOverlayMenu::close() {
	m_active = false;
	m_selected = 0;
	m_dirtyText = true;
}

void HostOverlayMenu::changeSelected(ConsoleCore& console, GameView& view, i32 direction) {
	if (kOptions[static_cast<size_t>(m_selected)].valueCount == 0) {
		return;
	}
	const i32 valueCount = kOptions[static_cast<size_t>(m_selected)].valueCount;
	const i32 current = optionIndex(console, view, m_selected);
	const i32 next = (current + valueCount + direction) % valueCount;
	setOptionIndex(console, view, m_selected, next);
	m_dirtyText = true;
}

void HostOverlayMenu::activateSelected(ConsoleCore& console) {
	switch (kOptions[static_cast<size_t>(m_selected)].id) {
		case HostMenuOptionId::RebootCart:
			close();
			console.romBootManager().rebootLoadedRom();
			return;
		case HostMenuOptionId::ExitGame:
			close();
			console.platform()->requestShutdown();
			return;
		default:
			return;
	}
}

void HostOverlayMenu::rebuildText(ConsoleCore& console, GameView& view) {
	for (i32 index = 0; index < kMenuOptionCount; index += 1) {
		const HostMenuOptionDef& option = kOptions[static_cast<size_t>(index)];
		if (option.valueCount == 0) {
			m_lineText[static_cast<size_t>(index)] = option.label;
		} else {
			m_lineText[static_cast<size_t>(index)] = std::string(option.label) + "  " + option.values[optionIndex(console, view, index)];
		}
		GlyphRenderSubmission& glyphs = m_optionGlyphs[static_cast<size_t>(index)];
		glyphs.glyphs[0] = m_lineText[static_cast<size_t>(index)];
		glyphs.glyph_end = static_cast<i32>(glyphs.glyphs[0].size());
	}
	m_dirtyText = false;
}

} // namespace bmsx
