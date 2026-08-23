#include "host_on_screen_keyboard.h"

#include "hid_keys.h"
#include "input.h"
#include "render/shared/bitmap_font.h"
#include "render/host_overlay/overlay_queue.h"
#include "render/video_presenter.h"

#include <array>
#include <cmath>

namespace bmsx {
namespace {

struct KeyDefinition {
	const char* label;
	u8 usage;
	i32 span;
	i32 modifier;
};

struct KeyboardRow {
	i32 start;
	i32 count;
	i32 units;
};

constexpr i32 kNoModifier = -1;
constexpr i32 kModifierShift = 0;
constexpr i32 kModifierControl = 1;
constexpr i32 kModifierAlt = 2;
constexpr std::array<u8, HostOnScreenKeyboard::ModifierCount> kModifierUsages{
	hid_key_usage::ShiftLeft,
	hid_key_usage::ControlLeft,
	hid_key_usage::AltLeft,
};

constexpr std::array<KeyDefinition, HostOnScreenKeyboard::KeyCount> kKeys{{
	{"ESC", hid_key_usage::Escape, 2, kNoModifier},
	{"1", hid_key_usage::Digit1, 1, kNoModifier},
	{"2", hid_key_usage::Digit2, 1, kNoModifier},
	{"3", hid_key_usage::Digit3, 1, kNoModifier},
	{"4", hid_key_usage::Digit4, 1, kNoModifier},
	{"5", hid_key_usage::Digit5, 1, kNoModifier},
	{"6", hid_key_usage::Digit6, 1, kNoModifier},
	{"7", hid_key_usage::Digit7, 1, kNoModifier},
	{"8", hid_key_usage::Digit8, 1, kNoModifier},
	{"9", hid_key_usage::Digit9, 1, kNoModifier},
	{"0", hid_key_usage::Digit0, 1, kNoModifier},
	{"-", hid_key_usage::Minus, 1, kNoModifier},
	{"=", hid_key_usage::Equal, 1, kNoModifier},
	{"BKSP", hid_key_usage::Backspace, 2, kNoModifier},

	{"TAB", hid_key_usage::Tab, 2, kNoModifier},
	{"Q", hid_key_usage::Q, 1, kNoModifier},
	{"W", hid_key_usage::W, 1, kNoModifier},
	{"E", hid_key_usage::E, 1, kNoModifier},
	{"R", hid_key_usage::R, 1, kNoModifier},
	{"T", hid_key_usage::T, 1, kNoModifier},
	{"Y", hid_key_usage::Y, 1, kNoModifier},
	{"U", hid_key_usage::U, 1, kNoModifier},
	{"I", hid_key_usage::I, 1, kNoModifier},
	{"O", hid_key_usage::O, 1, kNoModifier},
	{"P", hid_key_usage::P, 1, kNoModifier},
	{"[", hid_key_usage::BracketLeft, 1, kNoModifier},
	{"]", hid_key_usage::BracketRight, 1, kNoModifier},
	{"\\", hid_key_usage::Backslash, 1, kNoModifier},

	{"CAPS", hid_key_usage::CapsLock, 2, kNoModifier},
	{"A", hid_key_usage::A, 1, kNoModifier},
	{"S", hid_key_usage::S, 1, kNoModifier},
	{"D", hid_key_usage::D, 1, kNoModifier},
	{"F", hid_key_usage::F, 1, kNoModifier},
	{"G", hid_key_usage::G, 1, kNoModifier},
	{"H", hid_key_usage::H, 1, kNoModifier},
	{"J", hid_key_usage::J, 1, kNoModifier},
	{"K", hid_key_usage::K, 1, kNoModifier},
	{"L", hid_key_usage::L, 1, kNoModifier},
	{";", hid_key_usage::Semicolon, 1, kNoModifier},
	{"'", hid_key_usage::Quote, 1, kNoModifier},
	{"ENTER", hid_key_usage::Enter, 2, kNoModifier},

	{"SHIFT", hid_key_usage::ShiftLeft, 2, kModifierShift},
	{"Z", hid_key_usage::Z, 1, kNoModifier},
	{"X", hid_key_usage::X, 1, kNoModifier},
	{"C", hid_key_usage::C, 1, kNoModifier},
	{"V", hid_key_usage::V, 1, kNoModifier},
	{"B", hid_key_usage::B, 1, kNoModifier},
	{"N", hid_key_usage::N, 1, kNoModifier},
	{"M", hid_key_usage::M, 1, kNoModifier},
	{",", hid_key_usage::Comma, 1, kNoModifier},
	{".", hid_key_usage::Period, 1, kNoModifier},
	{"/", hid_key_usage::Slash, 1, kNoModifier},
	{"DEL", hid_key_usage::Delete, 2, kNoModifier},

	{"CTRL", hid_key_usage::ControlLeft, 2, kModifierControl},
	{"ALT", hid_key_usage::AltLeft, 2, kModifierAlt},
	{"SPACE", hid_key_usage::Space, 6, kNoModifier},
	{"<", hid_key_usage::ArrowLeft, 1, kNoModifier},
	{"v", hid_key_usage::ArrowDown, 1, kNoModifier},
	{"^", hid_key_usage::ArrowUp, 1, kNoModifier},
	{">", hid_key_usage::ArrowRight, 1, kNoModifier},
}};

constexpr std::array<KeyboardRow, 5> kRows{{
	{0, 14, 16},
	{14, 14, 15},
	{28, 13, 15},
	{41, 12, 14},
	{53, 7, 14},
}};

constexpr const char* kTitle = "ON-SCREEN KEYBOARD";
constexpr const char* kHelp = "DPAD MOVE   A TYPE   B BACK";
constexpr i32 kInitialRow = 1;
constexpr i32 kInitialKey = 15;
constexpr i32 kUnitWidth = 13;
constexpr i32 kKeyGap = 1;
constexpr i32 kRowGap = 2;
constexpr i32 kPanelPadding = 4;
constexpr i32 kTitleGap = 3;
constexpr i32 kHelpGap = 3;
constexpr u32 kPanelColor = 0xe0101010u;
constexpr u32 kKeyColor = 0xff252525u;
constexpr u32 kActiveKeyColor = 0xff35551fu;
constexpr u32 kSelectedKeyColor = 0xff1e6a95u;
constexpr u32 kTextColor = 0xffefefefu;
constexpr u32 kDimColor = 0xffb2b2b2u;
constexpr u32 kTitleColor = 0xff5bc6ffu;

} // namespace

HostOnScreenKeyboard::HostOnScreenKeyboard() {
	m_panel_rect.kind = RectRenderKind::Fill;
	m_panel_rect.color = kPanelColor;
	m_panel_rect.layer = Layer2D::IDE;
	m_title_glyphs.items.emplace_back(kTitle);
	m_title_glyphs.item_end = static_cast<i32>(m_title_glyphs.items[0].size());
	m_title_glyphs.z = 922.0f;
	m_title_glyphs.color = kTitleColor;
	m_title_glyphs.align = TextAlign::Start;
	m_title_glyphs.baseline = TextBaseline::Alphabetic;
	m_title_glyphs.layer = Layer2D::IDE;
	m_help_glyphs.items.emplace_back(kHelp);
	m_help_glyphs.item_end = static_cast<i32>(m_help_glyphs.items[0].size());
	m_help_glyphs.z = 922.0f;
	m_help_glyphs.color = kDimColor;
	m_help_glyphs.align = TextAlign::Start;
	m_help_glyphs.baseline = TextBaseline::Alphabetic;
	m_help_glyphs.layer = Layer2D::IDE;
	m_command_kinds[0] = Host2DKind::Rect;
	m_command_refs[0] = Host2DRef{.rect = &m_panel_rect};
	m_command_kinds[1] = Host2DKind::Glyphs;
	m_command_refs[1] = Host2DRef{.glyphs = &m_title_glyphs};
	size_t command = 2u;
	for (size_t index = 0u; index < kKeys.size(); index += 1u) {
		RectRenderSubmission& rect = m_key_rects[index];
		rect.kind = RectRenderKind::Fill;
		rect.color = kKeyColor;
		rect.layer = Layer2D::IDE;
		GlyphRenderSubmission& glyphs = m_key_glyphs[index];
		glyphs.items.emplace_back(kKeys[index].label);
		glyphs.item_end = static_cast<i32>(glyphs.items[0].size());
		glyphs.z = 922.0f;
		glyphs.color = kTextColor;
		glyphs.align = TextAlign::Start;
		glyphs.baseline = TextBaseline::Alphabetic;
		glyphs.layer = Layer2D::IDE;
		m_command_kinds[command] = Host2DKind::Rect;
		m_command_refs[command] = Host2DRef{.rect = &rect};
		command += 1u;
		m_command_kinds[command] = Host2DKind::Glyphs;
		m_command_refs[command] = Host2DRef{.glyphs = &glyphs};
		command += 1u;
	}
	m_command_kinds[command] = Host2DKind::Glyphs;
	m_command_refs[command] = Host2DRef{.glyphs = &m_help_glyphs};
	updateKeyColors();
}

void HostOnScreenKeyboard::open() {
	m_selected_row = kInitialRow;
	m_selected_key = kInitialKey;
	updateKeyColors();
}

void HostOnScreenKeyboard::close(LibretroInput& input) {
	releasePulse(input);
	for (size_t modifier = 0u; modifier < m_modifier_states.size(); modifier += 1u) {
		if (m_modifier_states[modifier]) {
			m_modifier_states[modifier] = false;
			input.setVirtualKeyboardKey(kModifierUsages[modifier], false);
		}
	}
	updateKeyColors();
}

void HostOnScreenKeyboard::releasePulse(LibretroInput& input) {
	if (m_pulse_usage >= 0) {
		input.setVirtualKeyboardKey(static_cast<u8>(m_pulse_usage), false);
		m_pulse_usage = -1;
	}
}

void HostOnScreenKeyboard::moveHorizontal(i32 direction) {
	const KeyboardRow& row = kRows[static_cast<size_t>(m_selected_row)];
	const i32 offset = m_selected_key - row.start;
	m_selected_key = row.start + (offset + row.count + direction) % row.count;
	updateKeyColors();
}

void HostOnScreenKeyboard::moveVertical(i32 direction) {
	const i32 currentCenter = keyCenterUnits(m_selected_row, m_selected_key);
	m_selected_row = (m_selected_row + static_cast<i32>(kRows.size()) + direction)
		% static_cast<i32>(kRows.size());
	const KeyboardRow& row = kRows[static_cast<size_t>(m_selected_row)];
	i32 closest = row.start;
	i32 closestDistance = std::abs(keyCenterUnits(m_selected_row, closest) - currentCenter);
	for (i32 index = row.start + 1; index < row.start + row.count; index += 1) {
		const i32 distance = std::abs(keyCenterUnits(m_selected_row, index) - currentCenter);
		if (distance < closestDistance) {
			closest = index;
			closestDistance = distance;
		}
	}
	m_selected_key = closest;
	updateKeyColors();
}

void HostOnScreenKeyboard::activate(LibretroInput& input) {
	const KeyDefinition& key = kKeys[static_cast<size_t>(m_selected_key)];
	if (key.modifier != kNoModifier) {
		const size_t modifier = static_cast<size_t>(key.modifier);
		const bool down = !m_modifier_states[modifier];
		m_modifier_states[modifier] = down;
		input.setVirtualKeyboardKey(key.usage, down);
		updateKeyColors();
		return;
	}
	input.setVirtualKeyboardKey(key.usage, true);
	m_pulse_usage = key.usage;
}

void HostOnScreenKeyboard::queueRenderCommands(VideoPresenter& presenter) {
	BFont* font = presenter.default_font;
	const i32 viewportWidth = static_cast<i32>(presenter.viewportSize.x);
	const i32 viewportHeight = static_cast<i32>(presenter.viewportSize.y);
	if (m_layout_width != viewportWidth
		|| m_layout_height != viewportHeight
		|| m_layout_font != font) {
		m_layout_width = viewportWidth;
		m_layout_height = viewportHeight;
		m_layout_font = font;
		layoutKeys(presenter);
	}
	presenter.hostOverlayQueue.clearHostMenuFrame();
	presenter.hostOverlayQueue.publishHostMenuFrame(HostMenuFrame{
		m_command_kinds.data(),
		m_command_refs.data(),
		m_command_kinds.size(),
	});
}

i32 HostOnScreenKeyboard::keyCenterUnits(i32 rowIndex, i32 keyIndex) const {
	const KeyboardRow& row = kRows[static_cast<size_t>(rowIndex)];
	i32 unit = 0;
	for (i32 index = row.start; index < keyIndex; index += 1) {
		unit += kKeys[static_cast<size_t>(index)].span;
	}
	return unit * 2 + kKeys[static_cast<size_t>(keyIndex)].span;
}

void HostOnScreenKeyboard::updateKeyColors() {
	for (size_t index = 0u; index < kKeys.size(); index += 1u) {
		const i32 modifier = kKeys[index].modifier;
		m_key_rects[index].color = static_cast<i32>(index) == m_selected_key
			? kSelectedKeyColor
			: modifier != kNoModifier && m_modifier_states[static_cast<size_t>(modifier)]
				? kActiveKeyColor
				: kKeyColor;
	}
}

void HostOnScreenKeyboard::layoutKeys(VideoPresenter& presenter) {
	BFont* font = presenter.default_font;
	const i32 lineHeight = font->lineHeight() > 10 ? 10 : font->lineHeight();
	const i32 keyHeight = lineHeight + 4;
	const i32 maxUnits = kRows[0].units;
	const i32 keyboardWidth = maxUnits * (kUnitWidth + kKeyGap) - kKeyGap;
	const i32 keysHeight = static_cast<i32>(kRows.size()) * keyHeight
		+ (static_cast<i32>(kRows.size()) - 1) * kRowGap;
	const i32 panelWidth = keyboardWidth + kPanelPadding * 2;
	const i32 panelHeight = kPanelPadding * 2 + lineHeight + kTitleGap
		+ keysHeight + kHelpGap + lineHeight;
	const i32 viewportWidth = static_cast<i32>(presenter.viewportSize.x);
	const i32 viewportHeight = static_cast<i32>(presenter.viewportSize.y);
	const i32 left = (viewportWidth - panelWidth) / 2;
	const i32 top = (viewportHeight - panelHeight) / 2;
	m_panel_rect.area = RectBounds{
		static_cast<f32>(left),
		static_cast<f32>(top),
		static_cast<f32>(left + panelWidth),
		static_cast<f32>(top + panelHeight),
		920.0f,
	};
	m_title_glyphs.font = font;
	m_title_glyphs.x = static_cast<f32>(viewportWidth - font->measure(m_title_glyphs.items[0])) * 0.5f;
	m_title_glyphs.y = static_cast<f32>(top + kPanelPadding);
	const i32 keyTop = top + kPanelPadding + lineHeight + kTitleGap;
	for (size_t rowIndex = 0u; rowIndex < kRows.size(); rowIndex += 1u) {
		const KeyboardRow& row = kRows[rowIndex];
		const i32 rowWidth = row.units * (kUnitWidth + kKeyGap) - kKeyGap;
		i32 keyLeft = (viewportWidth - rowWidth) / 2;
		const i32 keyY = keyTop + static_cast<i32>(rowIndex) * (keyHeight + kRowGap);
		for (i32 index = row.start; index < row.start + row.count; index += 1) {
			const size_t offset = static_cast<size_t>(index);
			const i32 width = kKeys[offset].span * (kUnitWidth + kKeyGap) - kKeyGap;
			m_key_rects[offset].area = RectBounds{
				static_cast<f32>(keyLeft),
				static_cast<f32>(keyY),
				static_cast<f32>(keyLeft + width),
				static_cast<f32>(keyY + keyHeight),
				921.0f,
			};
			GlyphRenderSubmission& glyphs = m_key_glyphs[offset];
			glyphs.font = font;
			glyphs.x = static_cast<f32>(
				keyLeft + (width - font->measure(glyphs.items[0])) / 2);
			glyphs.y = static_cast<f32>(keyY + (keyHeight - lineHeight) / 2);
			keyLeft += width + kKeyGap;
		}
	}
	m_help_glyphs.font = font;
	m_help_glyphs.x = static_cast<f32>(
		viewportWidth - font->measure(m_help_glyphs.items[0])) * 0.5f;
	m_help_glyphs.y = static_cast<f32>(keyTop + keysHeight + kHelpGap);
}

} // namespace bmsx
