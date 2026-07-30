#include "host_overlay_menu.h"

#include "input.h"
#include "render/shared/bitmap_font.h"
#include "machine/runtime/runtime.h"
#include "render/video_presenter.h"
#include "render/host_overlay/overlay_queue.h"
#include "spec/bmsx/memory_map.h"
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
constexpr i32 kInitialButtonRepeatDelayFrames = 15;
constexpr i32 kButtonRepeatIntervalFrames = 4;
constexpr std::array<const char*, 3> kUsageLabels{"CPU", "RAM", "VRAM"};

struct HostMenuButton {
	InputControllerGamepadButtonBit gamepad;
	u8 keyboardUsage;
};

constexpr auto kHostMenuButtons = std::to_array<HostMenuButton>({
	{InputControllerGamepadButtonBit::Start, HID_USAGE_ENTER},
	{InputControllerGamepadButtonBit::Select, HID_USAGE_BACKSPACE},
	{InputControllerGamepadButtonBit::LeftBumper, HID_USAGE_SHIFT_LEFT},
	{InputControllerGamepadButtonBit::RightBumper, HID_USAGE_SHIFT_RIGHT},
	{InputControllerGamepadButtonBit::Up, HID_USAGE_ARROW_UP},
	{InputControllerGamepadButtonBit::Down, HID_USAGE_ARROW_DOWN},
	{InputControllerGamepadButtonBit::Left, HID_USAGE_ARROW_LEFT},
	{InputControllerGamepadButtonBit::Right, HID_USAGE_ARROW_RIGHT},
	{InputControllerGamepadButtonBit::A, HID_USAGE_KEY_X},
	{InputControllerGamepadButtonBit::B, HID_USAGE_KEY_C},
});
static_assert(kHostMenuButtons.size() == static_cast<size_t>(HostMenuButtonId::Count));

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

i32 boolIndex(bool value) {
	return value ? 1 : 0;
}

bool boolFromIndex(i32 index) {
	return index != 0;
}

i32 optionIndex(bool showFps, VideoPresenter& presenter, i32 option) {
	switch (kOptions[static_cast<size_t>(option)].id) {
		case HostMenuOptionId::ShowUsageGizmo: return boolIndex(presenter.showResourceUsageGizmo);
		case HostMenuOptionId::CrtPost: return boolIndex(presenter.crt_postprocessing_enabled);
		case HostMenuOptionId::CrtNoise: return boolIndex(presenter.applyNoise);
		case HostMenuOptionId::CrtColorBleed: return boolIndex(presenter.applyColorBleed);
		case HostMenuOptionId::CrtScanlines: return boolIndex(presenter.applyScanlines);
		case HostMenuOptionId::CrtBlur: return boolIndex(presenter.applyBlur);
		case HostMenuOptionId::CrtGlow: return boolIndex(presenter.applyGlow);
		case HostMenuOptionId::CrtFringing: return boolIndex(presenter.applyFringing);
		case HostMenuOptionId::CrtAperture: return boolIndex(presenter.applyAperture);
		case HostMenuOptionId::DeviceQuantize: return static_cast<i32>(presenter.deviceQuantizeMode());
		case HostMenuOptionId::HostShowFps: return boolIndex(showFps);
		case HostMenuOptionId::RebootCart: return 0;
		case HostMenuOptionId::ExitGame: return 0;
	}
	return 0;
}

void setOptionIndex(bool& showFps, VideoPresenter& presenter, i32 option, i32 value) {
	switch (kOptions[static_cast<size_t>(option)].id) {
		case HostMenuOptionId::ShowUsageGizmo: presenter.showResourceUsageGizmo = boolFromIndex(value); break;
		case HostMenuOptionId::CrtPost: presenter.crt_postprocessing_enabled = boolFromIndex(value); break;
		case HostMenuOptionId::CrtNoise: presenter.applyNoise = boolFromIndex(value); break;
		case HostMenuOptionId::CrtColorBleed: presenter.applyColorBleed = boolFromIndex(value); break;
		case HostMenuOptionId::CrtScanlines: presenter.applyScanlines = boolFromIndex(value); break;
		case HostMenuOptionId::CrtBlur: presenter.applyBlur = boolFromIndex(value); break;
		case HostMenuOptionId::CrtGlow: presenter.applyGlow = boolFromIndex(value); break;
		case HostMenuOptionId::CrtFringing: presenter.applyFringing = boolFromIndex(value); break;
		case HostMenuOptionId::CrtAperture: presenter.applyAperture = boolFromIndex(value); break;
		case HostMenuOptionId::DeviceQuantize: presenter.setDeviceQuantizeMode(static_cast<DeviceQuantizeMode>(value)); break;
		case HostMenuOptionId::HostShowFps: showFps = boolFromIndex(value); break;
		case HostMenuOptionId::RebootCart: break;
		case HostMenuOptionId::ExitGame: break;
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

void HostOverlayMenu::clearRenderCommands(VideoPresenter& presenter) {
	m_commandCount = 0;
	presenter.hostOverlayQueue.clearHostMenuFrame();
}

void HostOverlayMenu::publishRenderCommands(VideoPresenter& presenter) {
	presenter.hostOverlayQueue.publishHostMenuFrame(HostMenuFrame{m_commandKinds.data(), m_commandRefs.data(), m_commandCount});
}

void HostOverlayMenu::queueCommand(Host2DKind kind, Host2DRef ref) {
	m_commandKinds[m_commandCount] = kind;
	m_commandRefs[m_commandCount] = ref;
	m_commandCount += 1;
}

HostMenuInput HostOverlayMenu::tickInput(const LibretroInput& input, VideoPresenter& presenter, f64 currentTimeMs) {
	const bool comboEdge = buttonPressed(input, HostMenuButtonId::Start) &&
		buttonPressed(input, HostMenuButtonId::Select) &&
		buttonPressed(input, HostMenuButtonId::LeftBumper) &&
		buttonPressed(input, HostMenuButtonId::RightBumper) &&
		(buttonJustPressed(input, HostMenuButtonId::Start) ||
			buttonJustPressed(input, HostMenuButtonId::Select) ||
			buttonJustPressed(input, HostMenuButtonId::LeftBumper) ||
			buttonJustPressed(input, HostMenuButtonId::RightBumper));
	if (comboEdge) {
		toggle();
	}
	HostMenuInput result = m_active ? HostMenuInput::Active : HostMenuInput::Inactive;
	if (m_active) {
		if (buttonJustPressed(input, HostMenuButtonId::B)) {
			toggle();
			result = HostMenuInput::Inactive;
		} else {
			const f64 frameDurationMs = input.frameDurationMs();
			if (advanceButtonRepeat(
				buttonPressed(input, HostMenuButtonId::Up),
				buttonJustPressed(input, HostMenuButtonId::Up),
				m_buttonRepeats[static_cast<size_t>(HostMenuRepeatId::Up)],
				currentTimeMs,
				frameDurationMs
			)) {
				m_selected = m_selected == 0 ? kMenuOptionCount - 1 : m_selected - 1;
				m_dirtyText = true;
			}
			if (advanceButtonRepeat(
				buttonPressed(input, HostMenuButtonId::Down),
				buttonJustPressed(input, HostMenuButtonId::Down),
				m_buttonRepeats[static_cast<size_t>(HostMenuRepeatId::Down)],
				currentTimeMs,
				frameDurationMs
			)) {
				m_selected = (m_selected + 1) % kMenuOptionCount;
				m_dirtyText = true;
			}
			if (advanceButtonRepeat(
				buttonPressed(input, HostMenuButtonId::Left),
				buttonJustPressed(input, HostMenuButtonId::Left),
				m_buttonRepeats[static_cast<size_t>(HostMenuRepeatId::Left)],
				currentTimeMs,
				frameDurationMs
			)) {
				changeSelected(presenter, -1);
			}
			if (advanceButtonRepeat(
				buttonPressed(input, HostMenuButtonId::Right),
				buttonJustPressed(input, HostMenuButtonId::Right),
				m_buttonRepeats[static_cast<size_t>(HostMenuRepeatId::Right)],
				currentTimeMs,
				frameDurationMs
			)) {
				changeSelected(presenter, 1);
			}
			if (buttonJustPressed(input, HostMenuButtonId::A)) {
				result = activateSelected();
			}
		}
	}
	latchButtonStates(input);
	return result;
}

void HostOverlayMenu::resetInputState() {
	m_previousButtonStates.fill(false);
	resetButtonRepeats();
}

void HostOverlayMenu::queueRenderCommands(VideoPresenter& presenter) {
	clearRenderCommands(presenter);
	const Host2DKind rectKind = Host2DKind::Rect;
	const Host2DKind itemsKind = Host2DKind::Glyphs;
	if (m_dirtyText) {
		rebuildText(presenter);
	}
	BFont* font = presenter.default_font;
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
	const i32 left = (static_cast<i32>(presenter.viewportSize.x) - boxWidth) / 2;
	const i32 top = (static_cast<i32>(presenter.viewportSize.y) - totalHeight) / 2;
	const i32 boxTop = top + titleHeight + titleGap;
	m_panelRect.area = RectBounds{static_cast<f32>(left), static_cast<f32>(boxTop), static_cast<f32>(left + boxWidth), static_cast<f32>(boxTop + boxHeight), 920.0f};
	queueCommand(rectKind, Host2DRef{.rect = &m_panelRect});
	m_titleGlyphs.font = font;
	m_titleGlyphs.x = static_cast<f32>(left + padding);
	m_titleGlyphs.y = static_cast<f32>(top);
	queueCommand(itemsKind, Host2DRef{.glyphs = &m_titleGlyphs});
	for (i32 index = 0; index < kMenuOptionCount; index += 1) {
		const i32 y = boxTop + padding + index * lineHeight;
		if (index == m_selected) {
			m_highlightRect.area = RectBounds{static_cast<f32>(left), static_cast<f32>(y - 2), static_cast<f32>(left + boxWidth), static_cast<f32>(y + lineHeight - 2), 921.0f};
			queueCommand(rectKind, Host2DRef{.rect = &m_highlightRect});
		}
		GlyphRenderSubmission& items = m_optionGlyphs[static_cast<size_t>(index)];
		items.font = font;
		items.x = static_cast<f32>(left + padding);
		items.y = static_cast<f32>(y);
		items.color = index == m_selected ? kTextColor : kDimColor;
		queueCommand(itemsKind, Host2DRef{.glyphs = &items});
	}
	publishRenderCommands(presenter);
}

bool HostOverlayMenu::queueFrameOverlayCommands(Runtime& runtime, VideoPresenter& presenter, f64 hostFps) {
	clearRenderCommands(presenter);
	const Host2DKind rectKind = Host2DKind::Rect;
	const Host2DKind itemsKind = Host2DKind::Glyphs;
	if (m_active) {
		return false;
	}
	bool queued = false;
	BFont* font = presenter.default_font;
	if (m_showFps) {
		const i32 fpsTenths = static_cast<i32>((hostFps * 10.0) + 0.5);
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
		m_fpsGlyphs.x = presenter.viewportSize.x - 8.0f - static_cast<f32>(m_fpsTextWidth);
		m_fpsGlyphs.y = 8.0f;
		queueCommand(itemsKind, Host2DRef{.glyphs = &m_fpsGlyphs});
		queued = true;
	}
	if (presenter.showResourceUsageGizmo) {
		const double gxGpuVramBytes = static_cast<double>(
			runtime.machine.gxGpu.readVramSnapshotBytes().size());
		const std::array<double, UsageBarCount> used{
			static_cast<double>(runtime.cpuUsageCyclesUsed()),
			static_cast<double>(
				BASE_RAM_USED_SIZE + runtime.machine.cpu.luaHeap().usedBytes()),
			gxGpuVramBytes,
		};
		const std::array<double, UsageBarCount> total{
			static_cast<double>(runtime.cpuUsageCyclesGranted()),
			static_cast<double>(runtime.machine.memory.ramByteCount()),
			gxGpuVramBytes,
		};
		queueCommand(rectKind, Host2DRef{.rect = &m_usagePanelRect});
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
			queueCommand(rectKind, Host2DRef{.rect = &m_usageBarBackgrounds[offset]});
			if (fillWidth > 0) {
				queueCommand(rectKind, Host2DRef{.rect = &fill});
			}
			queueCommand(itemsKind, Host2DRef{.glyphs = &label});
			queueCommand(itemsKind, Host2DRef{.glyphs = &percent});
		}
		queued = true;
	}
	if (queued) {
		publishRenderCommands(presenter);
	}
	return queued;
}

void HostOverlayMenu::toggle() {
	m_active = !m_active;
	m_selected = 0;
	m_dirtyText = true;
	resetButtonRepeats();
}

void HostOverlayMenu::close() {
	m_active = false;
	m_selected = 0;
	m_dirtyText = true;
	resetButtonRepeats();
}

bool HostOverlayMenu::buttonPressed(const LibretroInput& input, HostMenuButtonId button) const {
	const HostMenuButton& binding = kHostMenuButtons[static_cast<size_t>(button)];
	return input.gamepadButtonPressed(0u, binding.gamepad) || input.keyboardUsagePressed(binding.keyboardUsage);
}

bool HostOverlayMenu::buttonJustPressed(const LibretroInput& input, HostMenuButtonId button) const {
	const size_t index = static_cast<size_t>(button);
	return buttonPressed(input, button) && !m_previousButtonStates[index];
}

void HostOverlayMenu::latchButtonStates(const LibretroInput& input) {
	for (size_t button = 0u; button < m_previousButtonStates.size(); button += 1u) {
		m_previousButtonStates[button] = buttonPressed(input, static_cast<HostMenuButtonId>(button));
	}
}

bool HostOverlayMenu::advanceButtonRepeat(
	bool pressed,
	bool justPressed,
	ButtonRepeatRecord& repeat,
	f64 currentTimeMs,
	f64 frameDurationMs
) {
	if (justPressed) {
		repeat.active = true;
		repeat.repeatCount = 0;
		repeat.pressStartMs = currentTimeMs;
		repeat.lastRepeatAtMs = repeat.pressStartMs;
		return true;
	}
	if (!pressed) {
		repeat = {};
		return false;
	}
	if (!repeat.active) {
		repeat.active = true;
		repeat.pressStartMs = currentTimeMs;
		repeat.lastRepeatAtMs = repeat.pressStartMs;
	}
	const f64 nextRepeatAtMs = repeat.repeatCount == 0
		? repeat.pressStartMs + static_cast<f64>(kInitialButtonRepeatDelayFrames) * frameDurationMs
		: repeat.lastRepeatAtMs + static_cast<f64>(kButtonRepeatIntervalFrames) * frameDurationMs;
	if (currentTimeMs < nextRepeatAtMs) {
		return false;
	}
	repeat.repeatCount += 1;
	repeat.lastRepeatAtMs = nextRepeatAtMs;
	return true;
}

void HostOverlayMenu::resetButtonRepeats() {
	m_buttonRepeats.fill({});
}

void HostOverlayMenu::changeSelected(VideoPresenter& presenter, i32 direction) {
	if (kOptions[static_cast<size_t>(m_selected)].valueCount == 0) {
		return;
	}
	const i32 valueCount = kOptions[static_cast<size_t>(m_selected)].valueCount;
	const i32 current = optionIndex(m_showFps, presenter, m_selected);
	const i32 next = (current + valueCount + direction) % valueCount;
	setOptionIndex(m_showFps, presenter, m_selected, next);
	m_dirtyText = true;
}

HostMenuInput HostOverlayMenu::activateSelected() {
	switch (kOptions[static_cast<size_t>(m_selected)].id) {
		case HostMenuOptionId::RebootCart:
			close();
			return HostMenuInput::RebootCart;
		case HostMenuOptionId::ExitGame:
			close();
			return HostMenuInput::ExitGame;
		default:
			return HostMenuInput::Active;
	}
}

void HostOverlayMenu::rebuildText(VideoPresenter& presenter) {
	for (i32 index = 0; index < kMenuOptionCount; index += 1) {
		const HostMenuOptionDef& option = kOptions[static_cast<size_t>(index)];
		if (option.valueCount == 0) {
			m_lineText[static_cast<size_t>(index)] = option.label;
		} else {
			m_lineText[static_cast<size_t>(index)] = std::string(option.label) + "  " + option.values[optionIndex(m_showFps, presenter, index)];
		}
		GlyphRenderSubmission& items = m_optionGlyphs[static_cast<size_t>(index)];
		items.items[0] = m_lineText[static_cast<size_t>(index)];
		items.item_end = static_cast<i32>(items.items[0].size());
	}
	m_dirtyText = false;
}

} // namespace bmsx
