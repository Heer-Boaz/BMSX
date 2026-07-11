#include "core/host_overlay_menu.h"

#include "core/machine_manager.h"
#include "render/shared/bitmap_font.h"
#include "core/rom_boot_manager.h"
#include "input/manager.h"
#include "input/player.h"
#include "machine/runtime/runtime.h"
#include "platform/platform.h"
#include "render/gameview.h"
#include <array>
#include <cstdio>

namespace bmsx {
namespace {

constexpr i32 kMenuOptionCount = 13;
constexpr const char* kToggleValues[] = {"OFF", "ON"};
constexpr const char* kDeviceQuantizeValues[] = {"OFF", "RGB565", "MSX10 3:4:3"};
constexpr const char* kTitleText = "CORE OPTIONS";
constexpr const char* kFpsPrefix = "HOST: ";
constexpr i32 kUsageLabelWidth = 28;
constexpr i32 kUsageBarWidth = 54;
constexpr i32 kUsageBarHeight = 5;
constexpr i32 kUsageX = 8;
constexpr i32 kUsageBarX = kUsageX + kUsageLabelWidth;
constexpr i32 kUsageY = 8;
constexpr f32 kUsageZ = 9000.0f;
constexpr i32 kUsagePanelWidth = 112;
constexpr i32 kUsagePanelHeight = 32;
constexpr i32 kUsageRowHeight = 10;
constexpr i32 kUsageLowPercentTenthsLimit = 100;
constexpr i32 kUsagePercentTenthsFlag = 1000000;
constexpr std::array<const char*, 3> kUsageLabels{"CPU", "RAM", "VRAM"};

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

constexpr u32 kPanelColor = 0xcc070707u;
constexpr u32 kHighlightColor = 0xdb1e3f60u;
constexpr u32 kTextColor = 0xffefefefu;
constexpr u32 kDimColor = 0xffb2b2b2u;
constexpr u32 kTitleColor = 0xff5bc6ffu;
constexpr u32 kUsagePanelColor = 0xff000000u;
constexpr u32 kUsageTextColor = 0xffffffffu;
constexpr u32 kUsageDimColor = 0xffd0d0d0u;
constexpr u32 kUsageOkColor = 0xff04d413u;
constexpr u32 kUsageWarnColor = 0xffe2d204u;
constexpr u32 kUsageDangerColor = 0xffff5134u;

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
	DeviceQuantize,
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
	{HostMenuOptionId::DeviceQuantize, "Output Quantize", kDeviceQuantizeValues, 3},
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

i32 optionIndex(MachineManager& manager, GameView& view, i32 option) {
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
		case HostMenuOptionId::DeviceQuantize: return static_cast<i32>(view.deviceQuantizeMode);
		case HostMenuOptionId::HostShowFps: return boolIndex(manager.hostShowFps);
		case HostMenuOptionId::RebootCart: return 0;
		case HostMenuOptionId::ExitGame: return 0;
	}
	return 0;
}

void setOptionIndex(MachineManager& manager, GameView& view, i32 option, i32 value) {
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
		case HostMenuOptionId::DeviceQuantize: view.deviceQuantizeMode = static_cast<DeviceQuantizeMode>(value); break;
		case HostMenuOptionId::HostShowFps: manager.hostShowFps = boolFromIndex(value); break;
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

void configureRect(RectRenderSubmission& submission, u32 color) {
	submission.kind = RectRenderKind::Fill;
	submission.color = color;
	submission.layer = Layer2D::IDE;
}

void configureGlyphs(GlyphRenderSubmission& submission, const char* text, u32 color) {
	submission.items.clear();
	submission.items.emplace_back(text);
	submission.item_start = 0;
	submission.item_end = static_cast<i32>(submission.items[0].size());
	submission.z = 922.0f;
	submission.color = color;
	submission.layer = Layer2D::IDE;
}

u32 usageColor(double ratio) {
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
	for (GlyphRenderSubmission& items : m_optionGlyphs) {
		configureGlyphs(items, "", kTextColor);
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

Host2DKind HostOverlayMenu::commandKind(size_t index) const {
	return m_commandKinds[index];
}

Host2DRef HostOverlayMenu::commandRef(size_t index) const {
	return m_commandRefs[index];
}

void HostOverlayMenu::clearRenderCommands() {
	m_commandCount = 0;
}

void HostOverlayMenu::queueCommand(Host2DKind kind, Host2DRef ref) {
	m_commandKinds[m_commandCount] = kind;
	m_commandRefs[m_commandCount] = ref;
	m_commandCount += 1;
}

bool HostOverlayMenu::tickInput(MachineManager& manager) {
	GameView* view = manager.view();
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
		changeSelected(manager, *view, -1);
	}
	if (buttonEdge(player, kButtonRight)) {
		changeSelected(manager, *view, 1);
	}
	if (buttonJustPressed(player, kButtonA)) {
		activateSelected(manager);
	}
	consumeButtons(player, kMenuButtons);
	return true;
}

void HostOverlayMenu::queueRenderCommands(MachineManager& manager, GameView& view) {
	clearRenderCommands();
	const Host2DKind rectKind = Host2DKind::Rect;
	const Host2DKind itemsKind = Host2DKind::Glyphs;
	if (m_dirtyText) {
		rebuildText(manager, view);
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
	queueCommand(rectKind, &m_panelRect);
	m_titleGlyphs.font = font;
	m_titleGlyphs.x = static_cast<f32>(left + padding);
	m_titleGlyphs.y = static_cast<f32>(top);
	queueCommand(itemsKind, &m_titleGlyphs);
	for (i32 index = 0; index < kMenuOptionCount; index += 1) {
		const i32 y = boxTop + padding + index * lineHeight;
		if (index == m_selected) {
			m_highlightRect.area = RectBounds{static_cast<f32>(left), static_cast<f32>(y - 2), static_cast<f32>(left + boxWidth), static_cast<f32>(y + lineHeight - 2), 921.0f};
			queueCommand(rectKind, &m_highlightRect);
		}
		GlyphRenderSubmission& items = m_optionGlyphs[static_cast<size_t>(index)];
		items.font = font;
		items.x = static_cast<f32>(left + padding);
		items.y = static_cast<f32>(y);
		items.color = index == m_selected ? kTextColor : kDimColor;
		queueCommand(itemsKind, &items);
	}
}

bool HostOverlayMenu::queueFrameOverlayCommands(MachineManager& manager, GameView& view) {
	clearRenderCommands();
	const Host2DKind rectKind = Host2DKind::Rect;
	const Host2DKind itemsKind = Host2DKind::Glyphs;
	if (m_active) {
		return false;
	}
	bool queued = false;
	BFont* font = view.default_font;
	if (manager.hostShowFps) {
		const i32 fpsTenths = static_cast<i32>((manager.fps() * 10.0) + 0.5);
		if (m_fpsTextTenths != fpsTenths || m_fpsGlyphs.font != font) {
			m_fpsTextTenths = fpsTenths;
			const i32 whole = fpsTenths / 10;
			char buffer[32];
			std::snprintf(buffer, sizeof(buffer), "%s%d.%d", kFpsPrefix, whole, fpsTenths - whole * 10);
			m_fpsText = buffer;
			m_fpsGlyphs.items[0] = m_fpsText;
			m_fpsGlyphs.item_end = static_cast<i32>(m_fpsGlyphs.items[0].size());
			m_fpsGlyphs.font = font;
			m_fpsTextWidth = font->measure(m_fpsText);
		}
		m_fpsGlyphs.x = view.viewportSize.x - 8.0f - static_cast<f32>(m_fpsTextWidth);
		m_fpsGlyphs.y = 8.0f;
		queueCommand(itemsKind, &m_fpsGlyphs);
		queued = true;
	}
	if (view.showResourceUsageGizmo) {
		Runtime& runtime = manager.runtime();
		const std::array<double, UsageBarCount> used{
			static_cast<double>(runtime.cpuUsageCyclesUsed()),
			static_cast<double>(runtime.ramUsedBytes()),
			static_cast<double>(runtime.vramUsedBytes()),
		};
		const std::array<double, UsageBarCount> total{
			static_cast<double>(runtime.cpuUsageCyclesGranted()),
			static_cast<double>(runtime.ramTotalBytes()),
			static_cast<double>(runtime.vramTotalBytes()),
		};
		queueCommand(rectKind, &m_usagePanelRect);
		for (i32 index = 0; index < UsageBarCount; index += 1) {
			const size_t offset = static_cast<size_t>(index);
			const double ratio = used[offset] / total[offset];
			const i32 fillWidth = usageFillWidth(used[offset], total[offset]);
			RectRenderSubmission& fill = m_usageBarFills[offset];
			fill.area.right = static_cast<f32>(kUsageBarX + fillWidth);
			fill.color = usageColor(ratio);
			GlyphRenderSubmission& label = m_usageLabels[offset];
			GlyphRenderSubmission& percent = m_usagePercents[offset];
			label.font = font;
			percent.font = font;
			const i32 percentCode = usagePercentCode(used[offset], total[offset]);
			if (m_usagePercentCode[offset] != percentCode) {
				m_usagePercentCode[offset] = percentCode;
				char buffer[32];
				formatUsagePercentCode(buffer, sizeof(buffer), percentCode);
				percent.items[0] = buffer;
				percent.item_end = static_cast<i32>(percent.items[0].size());
			}
			queueCommand(rectKind, &m_usageBarBackgrounds[offset]);
			if (fillWidth > 0) {
				queueCommand(rectKind, &fill);
			}
			queueCommand(itemsKind, &label);
			queueCommand(itemsKind, &percent);
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

void HostOverlayMenu::changeSelected(MachineManager& manager, GameView& view, i32 direction) {
	if (kOptions[static_cast<size_t>(m_selected)].valueCount == 0) {
		return;
	}
	const i32 valueCount = kOptions[static_cast<size_t>(m_selected)].valueCount;
	const i32 current = optionIndex(manager, view, m_selected);
	const i32 next = (current + valueCount + direction) % valueCount;
	setOptionIndex(manager, view, m_selected, next);
	m_dirtyText = true;
}

void HostOverlayMenu::activateSelected(MachineManager& manager) {
	switch (kOptions[static_cast<size_t>(m_selected)].id) {
		case HostMenuOptionId::RebootCart:
			close();
			manager.rebootLoadedRom();
			return;
		case HostMenuOptionId::ExitGame:
			close();
			manager.platform()->requestShutdown();
			return;
		default:
			return;
	}
}

void HostOverlayMenu::rebuildText(MachineManager& manager, GameView& view) {
	for (i32 index = 0; index < kMenuOptionCount; index += 1) {
		const HostMenuOptionDef& option = kOptions[static_cast<size_t>(index)];
		if (option.valueCount == 0) {
			m_lineText[static_cast<size_t>(index)] = option.label;
		} else {
			m_lineText[static_cast<size_t>(index)] = std::string(option.label) + "  " + option.values[optionIndex(manager, view, index)];
		}
		GlyphRenderSubmission& items = m_optionGlyphs[static_cast<size_t>(index)];
		items.items[0] = m_lineText[static_cast<size_t>(index)];
		items.item_end = static_cast<i32>(items.items[0].size());
	}
	m_dirtyText = false;
}

} // namespace bmsx
