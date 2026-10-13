#include "host_on_screen_keyboard.h"

#include "common/rect.h"
#include "hid_keys.h"
#include "input.h"
#include "render/shared/bitmap_font.h"
#include "render/host_overlay/overlay_queue.h"
#include "render/video_presenter.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace bmsx {
namespace {

struct KeyDefinition {
	const char* label;
	u8 usage;
	i32 span;
	i32 modifier;
	const char* shiftLabel = nullptr;
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
	{"1", hid_key_usage::Digit1, 1, kNoModifier, "!"},
	{"2", hid_key_usage::Digit2, 1, kNoModifier, "@"},
	{"3", hid_key_usage::Digit3, 1, kNoModifier, "#"},
	{"4", hid_key_usage::Digit4, 1, kNoModifier, "$"},
	{"5", hid_key_usage::Digit5, 1, kNoModifier, "%"},
	{"6", hid_key_usage::Digit6, 1, kNoModifier, "^"},
	{"7", hid_key_usage::Digit7, 1, kNoModifier, "&"},
	{"8", hid_key_usage::Digit8, 1, kNoModifier, "*"},
	{"9", hid_key_usage::Digit9, 1, kNoModifier, "("},
	{"0", hid_key_usage::Digit0, 1, kNoModifier, ")"},
	{"-", hid_key_usage::Minus, 1, kNoModifier, "_"},
	{"=", hid_key_usage::Equal, 1, kNoModifier, "+"},
	{"BKSP", hid_key_usage::Backspace, 2, kNoModifier},

	{"TAB", hid_key_usage::Tab, 2, kNoModifier},
	{"q", hid_key_usage::Q, 1, kNoModifier, "Q"},
	{"w", hid_key_usage::W, 1, kNoModifier, "W"},
	{"e", hid_key_usage::E, 1, kNoModifier, "E"},
	{"r", hid_key_usage::R, 1, kNoModifier, "R"},
	{"t", hid_key_usage::T, 1, kNoModifier, "T"},
	{"y", hid_key_usage::Y, 1, kNoModifier, "Y"},
	{"u", hid_key_usage::U, 1, kNoModifier, "U"},
	{"i", hid_key_usage::I, 1, kNoModifier, "I"},
	{"o", hid_key_usage::O, 1, kNoModifier, "O"},
	{"p", hid_key_usage::P, 1, kNoModifier, "P"},
	{"[", hid_key_usage::BracketLeft, 1, kNoModifier, "{"},
	{"]", hid_key_usage::BracketRight, 1, kNoModifier, "}"},
	{"\\", hid_key_usage::Backslash, 1, kNoModifier, "|"},

	{"CAPS", hid_key_usage::CapsLock, 2, kNoModifier},
	{"a", hid_key_usage::A, 1, kNoModifier, "A"},
	{"s", hid_key_usage::S, 1, kNoModifier, "S"},
	{"d", hid_key_usage::D, 1, kNoModifier, "D"},
	{"f", hid_key_usage::F, 1, kNoModifier, "F"},
	{"g", hid_key_usage::G, 1, kNoModifier, "G"},
	{"h", hid_key_usage::H, 1, kNoModifier, "H"},
	{"j", hid_key_usage::J, 1, kNoModifier, "J"},
	{"k", hid_key_usage::K, 1, kNoModifier, "K"},
	{"l", hid_key_usage::L, 1, kNoModifier, "L"},
	{";", hid_key_usage::Semicolon, 1, kNoModifier, ":"},
	{"'", hid_key_usage::Quote, 1, kNoModifier, "\""},
	{"ENTER", hid_key_usage::Enter, 2, kNoModifier},

	{"SHIFT", hid_key_usage::ShiftLeft, 2, kModifierShift},
	{"z", hid_key_usage::Z, 1, kNoModifier, "Z"},
	{"x", hid_key_usage::X, 1, kNoModifier, "X"},
	{"c", hid_key_usage::C, 1, kNoModifier, "C"},
	{"v", hid_key_usage::V, 1, kNoModifier, "V"},
	{"b", hid_key_usage::B, 1, kNoModifier, "B"},
	{"n", hid_key_usage::N, 1, kNoModifier, "N"},
	{"m", hid_key_usage::M, 1, kNoModifier, "M"},
	{",", hid_key_usage::Comma, 1, kNoModifier, "<"},
	{".", hid_key_usage::Period, 1, kNoModifier, ">"},
	{"/", hid_key_usage::Slash, 1, kNoModifier, "?"},
	{"DEL", hid_key_usage::Delete, 2, kNoModifier},

	{"CTRL", hid_key_usage::ControlLeft, 2, kModifierControl},
	{"ALT", hid_key_usage::AltLeft, 2, kModifierAlt},
	{"SPACE", hid_key_usage::Space, 6, kNoModifier},
	{"<", hid_key_usage::ArrowLeft, 1, kNoModifier},
	{"v", hid_key_usage::ArrowDown, 1, kNoModifier},
	{"^", hid_key_usage::ArrowUp, 1, kNoModifier},
	{">", hid_key_usage::ArrowRight, 1, kNoModifier},
}};

constexpr auto kForwardedUsages = [] {
	std::array<u8, HostOnScreenKeyboard::ForwardedKeyCount> usages{};
	for (size_t key = 0; key < kKeys.size(); ++key) usages[key] = kKeys[key].usage;
	usages[HostOnScreenKeyboard::KeyCount] = hid_key_usage::Home;
	usages[HostOnScreenKeyboard::KeyCount + 1u] = hid_key_usage::End;
	return usages;
}();

constexpr std::array<u8, 256> makeKeyIndexByUsage() {
	std::array<u8, 256> indices{};
	for (size_t index = 0u; index < kForwardedUsages.size(); index += 1u) {
		indices[kForwardedUsages[index]] = static_cast<u8>(index + 1u);
	}
	return indices;
}

constexpr auto kKeyIndexByUsage = makeKeyIndexByUsage();

constexpr std::array<KeyboardRow, 5> kRows{{
	{0, 14, 16},
	{14, 14, 15},
	{28, 13, 15},
	{41, 12, 14},
	{53, 7, 14},
}};

constexpr const char* kTitle = "ON-SCREEN KEYBOARD";
constexpr std::array<const char*, HostOnScreenKeyboard::HelpLineCount> kHelpLines{{
	"A TYPE  B SPACE  X BKSP  Y SHIFT",
	"L/R CURSOR  LT/RT HOME/END",
	"START ENTER  SEL+B DEL",
	"SEL+X CLOSE  SEL+L/R HOME/END",
}};
constexpr i32 kInitialRow = 1;
constexpr i32 kInitialKey = 15;
constexpr i32 kUnitWidth = 13;
constexpr i32 kKeyGap = 1;
constexpr i32 kRowGap = 2;
constexpr i32 kPanelPadding = 4;
constexpr i32 kTitleGap = 3;
constexpr i32 kHelpGap = 3;
constexpr i32 kHelpLineGap = 1;
constexpr u32 kPanelColor = 0xe0101010u;
constexpr u32 kKeyColor = 0xff252525u;
constexpr u32 kSelectedKeyColor = 0xff1e6a95u;
constexpr u32 kPressedKeyColor = 0xffffca55u;
constexpr u32 kPressedTextColor = 0xff101010u;
constexpr f64 kReleaseFeedbackMs = 120;
constexpr u32 kTextColor = 0xffefefefu;
constexpr u32 kDimColor = 0xffb2b2b2u;
constexpr u32 kTitleColor = 0xff5bc6ffu;

} // namespace

HostOnScreenKeyboard::HostOnScreenKeyboard() {
	m_source_keys.fill(-1);
	m_panel_rect.kind = RectRenderKind::Fill;
	m_panel_rect.color = kPanelColor;
	m_panel_rect.layer = Layer2D::IDE;
	m_title_glyphs.items.emplace_back(kTitle);
	m_title_glyphs.item_end = static_cast<i32>(m_title_glyphs.items[0].size());
	m_title_glyphs.z = 922.0f;
	m_title_glyphs.color = kTitleColor;
	m_title_glyphs.layer = Layer2D::IDE;
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
		glyphs.layer = Layer2D::IDE;
		m_command_kinds[command] = Host2DKind::Rect;
		m_command_refs[command] = Host2DRef{.rect = &rect};
		command += 1u;
		m_command_kinds[command] = Host2DKind::Glyphs;
		m_command_refs[command] = Host2DRef{.glyphs = &glyphs};
		command += 1u;
	}
	for (size_t index = 0u; index < kHelpLines.size(); index += 1u) {
		GlyphRenderSubmission& glyphs = m_help_glyphs[index];
		glyphs.items.emplace_back(kHelpLines[index]);
		glyphs.item_end = static_cast<i32>(glyphs.items[0].size());
		glyphs.z = 922.0f;
		glyphs.color = kDimColor;
		glyphs.layer = Layer2D::IDE;
		m_command_kinds[command] = Host2DKind::Glyphs;
		m_command_refs[command] = Host2DRef{.glyphs = &glyphs};
		command += 1u;
	}
	updateKeyColors();
}

void HostOnScreenKeyboard::open() {
	m_selected_row = kInitialRow;
	m_selected_key = kInitialKey;
	m_feedback_until_ms.fill(0);
	m_next_feedback_expiry_ms = std::numeric_limits<f64>::infinity();
	updateKeyColors();
}

void HostOnScreenKeyboard::close(LibretroInput& input) {
	for (size_t source = 0; source < SourceCount; ++source) releaseSource(input, source);
	if (m_modifier_states[static_cast<size_t>(kModifierShift)]) {
		setShift(input, false);
	}
	for (size_t modifier = static_cast<size_t>(kModifierControl);
			modifier < m_modifier_states.size(); modifier += 1u) {
		if (m_modifier_states[modifier]) {
			m_modifier_states[modifier] = false;
			input.setVirtualKeyboardKey(kModifierUsages[modifier], false);
		}
	}
	m_feedback_until_ms.fill(0);
	m_next_feedback_expiry_ms = std::numeric_limits<f64>::infinity();
	updateKeyColors();
}

// Presentation time never stretches the key's actual input lifetime.
void HostOnScreenKeyboard::updateFeedback(f64 currentTimeMs) {
	m_feedback_time_ms = currentTimeMs;
	if (currentTimeMs < m_next_feedback_expiry_ms) return;
	f64 nextExpiry = std::numeric_limits<f64>::infinity();
	for (f64& expiry : m_feedback_until_ms) {
		if (expiry <= currentTimeMs) expiry = 0;
		else nextExpiry = std::min(nextExpiry, expiry);
	}
	m_next_feedback_expiry_ms = nextExpiry;
	updateKeyColors();
}

void HostOnScreenKeyboard::releaseSource(LibretroInput& input, size_t source) {
	const i16 key = m_source_keys[source];
	if (key < 0) return;
	m_source_keys[source] = -1;
	if (--m_key_counts[static_cast<size_t>(key)] == 0u) {
		input.setVirtualKeyboardKey(kForwardedUsages[static_cast<size_t>(key)], false);
		recordKeyFeedback(static_cast<size_t>(key), false);
	}
	const u8 modifiers = m_source_modifiers[source];
	m_source_modifiers[source] = 0u;
	bool shiftEnded = false;
	for (size_t modifier = 0; modifier < ModifierCount; ++modifier) {
		if ((modifiers & (1u << modifier)) == 0u) continue;
		m_modifier_counts[modifier] -= 1u;
		if (m_modifier_counts[modifier] != 0u) continue;
		if (modifier == static_cast<size_t>(kModifierShift) && m_modifier_states[modifier]) {
			setShift(input, false);
			shiftEnded = true;
		} else if (!m_modifier_states[modifier]) {
			input.setVirtualKeyboardKey(kModifierUsages[modifier], false);
			recordKeyFeedback(static_cast<size_t>(kKeyIndexByUsage[kModifierUsages[modifier]] - 1u), false);
		}
	}
	if (!shiftEnded) updateKeyColors();
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

void HostOnScreenKeyboard::activate(LibretroInput& input, size_t source) {
	const KeyDefinition& key = kKeys[static_cast<size_t>(m_selected_key)];
	if (key.modifier != kNoModifier) {
		if (key.modifier == kModifierShift) {
			setShift(input, !m_modifier_states[static_cast<size_t>(kModifierShift)]);
			return;
		}
		const size_t modifier = static_cast<size_t>(key.modifier);
		const bool down = !m_modifier_states[modifier];
		m_modifier_states[modifier] = down;
		if (m_modifier_counts[modifier] == 0u) {
			input.setVirtualKeyboardKey(key.usage, down);
			recordKeyFeedback(static_cast<size_t>(m_selected_key), down);
		}
		updateKeyColors();
		return;
	}
	pressKey(input, source, key.usage);
}

void HostOnScreenKeyboard::command(
		LibretroInput& input, size_t source,
		OnScreenKeyboardCommand command) {
	switch (command) {
		case OnScreenKeyboardCommand::None:
			return;
		case OnScreenKeyboardCommand::Activate:
			activate(input, source);
			return;
		case OnScreenKeyboardCommand::Backspace:
			pressKey(input, source, hid_key_usage::Backspace);
			return;
		case OnScreenKeyboardCommand::Delete:
			pressKey(input, source, hid_key_usage::Delete);
			return;
		case OnScreenKeyboardCommand::Space:
			pressKey(input, source, hid_key_usage::Space);
			return;
		case OnScreenKeyboardCommand::Shift:
			setShift(input, !m_modifier_states[static_cast<size_t>(kModifierShift)]);
			return;
		case OnScreenKeyboardCommand::Left:
			pressKey(input, source, hid_key_usage::ArrowLeft);
			return;
		case OnScreenKeyboardCommand::Right:
			pressKey(input, source, hid_key_usage::ArrowRight);
			return;
		case OnScreenKeyboardCommand::Home:
			pressKey(input, source, hid_key_usage::Home);
			return;
		case OnScreenKeyboardCommand::End:
			pressKey(input, source, hid_key_usage::End);
			return;
		case OnScreenKeyboardCommand::Enter:
			pressKey(input, source, hid_key_usage::Enter);
			return;
	}
}

i32 HostOnScreenKeyboard::selectAt(i32 x, i32 y) {
	const f32 pointX = static_cast<f32>(x);
	const f32 pointY = static_cast<f32>(y);
	for (size_t rowIndex = 0u; rowIndex < kRows.size(); rowIndex += 1u) {
		const KeyboardRow& row = kRows[rowIndex];
		for (i32 index = row.start; index < row.start + row.count; index += 1) {
			const RectBounds& area = m_key_rects[static_cast<size_t>(index)].area;
			if (point_in_rect(pointX, pointY, area)) {
				if (index != m_selected_key) {
					m_selected_row = static_cast<i32>(rowIndex);
					m_selected_key = index;
					updateKeyColors();
				}
				return index;
			}
		}
	}
	return -1;
}

void HostOnScreenKeyboard::queueRenderCommands(VideoPresenter& presenter) {
	BFont* font = presenter.default_font;
	const auto& bounds = presenter.visibleViewportBounds;
	const f32 viewportWidth = bounds.right - bounds.left;
	if (m_layout_left != bounds.left || m_layout_top != bounds.top
		|| m_layout_width != viewportWidth
		|| m_layout_font != font) {
		m_layout_left = bounds.left;
		m_layout_top = bounds.top;
		m_layout_width = viewportWidth;
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
		const bool pressed = m_key_counts[index] != 0u || m_feedback_until_ms[index] != 0
			|| (modifier != kNoModifier && (m_modifier_states[static_cast<size_t>(modifier)]
				|| m_modifier_counts[static_cast<size_t>(modifier)] != 0u));
		m_key_rects[index].color = pressed
			? kPressedKeyColor
			: static_cast<i32>(index) == m_selected_key
			? kSelectedKeyColor
			: kKeyColor;
		m_key_glyphs[index].color = pressed ? kPressedTextColor : kTextColor;
	}
	// Home/End have controller bindings but no key rectangle in this layout.
	constexpr size_t home = KeyCount, end = home + 1u;
	m_help_glyphs[1].color = m_key_counts[home] != 0u || m_key_counts[end] != 0u
		|| m_feedback_until_ms[home] != 0 || m_feedback_until_ms[end] != 0 ? kPressedKeyColor : kDimColor;
}

// A visual acknowledgement of the already-published edge, not another input producer.
void HostOnScreenKeyboard::recordKeyFeedback(size_t key, bool down) {
	if (down) m_feedback_until_ms[key] = 0;
	else {
		const f64 expiry = m_feedback_time_ms + kReleaseFeedbackMs;
		m_feedback_until_ms[key] = expiry;
		m_next_feedback_expiry_ms = std::min(m_next_feedback_expiry_ms, expiry);
	}
}

void HostOnScreenKeyboard::pressKey(LibretroInput& input, size_t source, u8 usage) {
	const size_t key = static_cast<size_t>(kKeyIndexByUsage[usage] - 1u);
	m_source_keys[source] = static_cast<i16>(key);
	u8 modifiers = 0u;
	for (size_t modifier = 0; modifier < ModifierCount; ++modifier) {
		if (m_modifier_states[modifier]) {
			modifiers |= 1u << modifier;
			m_modifier_counts[modifier] += 1u;
		}
	}
	m_source_modifiers[source] = modifiers;
	if (++m_key_counts[key] == 1u) {
		input.setVirtualKeyboardKey(usage, true);
		recordKeyFeedback(key, true);
	}
	updateKeyColors();
}

void HostOnScreenKeyboard::setShift(LibretroInput& input, bool down) {
	const size_t modifier = static_cast<size_t>(kModifierShift);
	const bool previous = m_modifier_states[modifier] || m_modifier_counts[modifier] != 0u;
	m_modifier_states[static_cast<size_t>(kModifierShift)] = down;
	const bool pressed = down || m_modifier_counts[modifier] != 0u;
	if (previous != pressed) {
		input.setVirtualKeyboardKey(hid_key_usage::ShiftLeft, pressed);
		recordKeyFeedback(static_cast<size_t>(kKeyIndexByUsage[hid_key_usage::ShiftLeft] - 1u), pressed);
	}
	for (size_t index = 0u; index < kKeys.size(); index += 1u) {
		const KeyDefinition& key = kKeys[index];
		const char* label = down && key.shiftLabel != nullptr
			? key.shiftLabel
			: key.label;
		GlyphRenderSubmission& glyphs = m_key_glyphs[index];
		glyphs.items[0] = label;
		glyphs.item_end = static_cast<i32>(glyphs.items[0].size());
	}
	m_layout_width = -1;
	updateKeyColors();
}

void HostOnScreenKeyboard::layoutKeys(VideoPresenter& presenter) {
	BFont* font = presenter.default_font;
	const auto& bounds = presenter.visibleViewportBounds;
	const f32 viewportWidth = bounds.right - bounds.left;
	const i32 lineHeight = font->lineHeight() > 10 ? 10 : font->lineHeight();
	const i32 keyHeight = lineHeight + 4;
	const i32 maxUnits = kRows[0].units;
	const i32 unitWidth = std::min(kUnitWidth, static_cast<i32>((viewportWidth - kPanelPadding * 2 + kKeyGap) / maxUnits) - kKeyGap);
	const i32 keyboardWidth = maxUnits * (unitWidth + kKeyGap) - kKeyGap;
	const i32 keysHeight = static_cast<i32>(kRows.size()) * keyHeight
		+ (static_cast<i32>(kRows.size()) - 1) * kRowGap;
	const i32 helpHeight = static_cast<i32>(kHelpLines.size()) * lineHeight
		+ (static_cast<i32>(kHelpLines.size()) - 1) * kHelpLineGap;
	const i32 panelWidth = keyboardWidth + kPanelPadding * 2;
	const i32 panelHeight = kPanelPadding * 2 + lineHeight + kTitleGap
		+ keysHeight + kHelpGap + helpHeight;
	const f32 left = bounds.left + static_cast<i32>((viewportWidth - panelWidth) / 2);
	// Keep the interactive key grid above the surrounding gamepad hand row.
	const f32 top = bounds.top + kPanelPadding;
	m_panel_rect.area = RectBounds{
		static_cast<f32>(left),
		static_cast<f32>(top),
		static_cast<f32>(left + panelWidth),
		static_cast<f32>(top + panelHeight),
		920.0f,
	};
	m_title_glyphs.font = font;
	m_title_glyphs.x = bounds.left + static_cast<i32>((viewportWidth - font->measure(m_title_glyphs.items[0])) / 2);
	m_title_glyphs.y = static_cast<f32>(top + kPanelPadding);
	const f32 keyTop = top + kPanelPadding + lineHeight + kTitleGap;
	for (size_t rowIndex = 0u; rowIndex < kRows.size(); rowIndex += 1u) {
		const KeyboardRow& row = kRows[rowIndex];
		const i32 rowWidth = row.units * (unitWidth + kKeyGap) - kKeyGap;
		f32 keyLeft = bounds.left + static_cast<i32>((viewportWidth - rowWidth) / 2);
		const f32 keyY = keyTop + static_cast<i32>(rowIndex) * (keyHeight + kRowGap);
		for (i32 index = row.start; index < row.start + row.count; index += 1) {
			const size_t offset = static_cast<size_t>(index);
			const i32 width = kKeys[offset].span * (unitWidth + kKeyGap) - kKeyGap;
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
	const f32 helpTop = keyTop + keysHeight + kHelpGap;
	for (size_t index = 0u; index < kHelpLines.size(); index += 1u) {
		GlyphRenderSubmission& glyphs = m_help_glyphs[index];
		glyphs.font = font;
		glyphs.x = bounds.left + static_cast<i32>((viewportWidth - font->measure(glyphs.items[0])) / 2);
		glyphs.y = static_cast<f32>(
			helpTop + static_cast<i32>(index) * (lineHeight + kHelpLineGap));
	}
}

} // namespace bmsx
