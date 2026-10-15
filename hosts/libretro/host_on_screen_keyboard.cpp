#include "host_on_screen_keyboard.h"
#include "common/rect.h"
#include "render/shared/bitmap_font.h"
#include "render/host_overlay/atlas.h"
#include "render/host_overlay/overlay_queue.h"
#include "render/video_presenter.h"
#include <algorithm>

namespace bmsx {
namespace {
constexpr std::array<const char*, 3> kTitles{"KEYBOARD: TEXT", "KEYBOARD: SYMBOLS", "KEYBOARD: FN"};
constexpr std::array<const char*, HostOnScreenKeyboard::HelpLineCount> kHelpLines{{
	"A PRESS  B SPACE  X BKSP  Y SHIFT",
	"L/R CURSOR  LT/RT HOME/END",
	"START ENTER  SEL+B DEL  SEL+Y PAGE",
	"SEL+X CLOSE  SEL+L/R HOME/END",
}};
constexpr i32 kUnitWidth = 13;
constexpr i32 kKeyGap = 1;
constexpr i32 kRowGap = 2;
constexpr i32 kPanelPadding = 4;
constexpr i32 kTitleGap = 3;
constexpr i32 kHelpGap = 3;
constexpr i32 kHelpLineGap = 1;
constexpr u32 kPanelColor = 0x60465264u;
constexpr u32 kKeyColor = 0x80bccbdbu;
constexpr u32 kSelectedKeyColor = 0xff7eb4d9u;
constexpr u32 kPressedKeyColor = 0xffffe09au;
constexpr u32 kShadowColor = 0xff080c12u;
constexpr u32 kTextColor = 0xffefefefu;
constexpr u32 kDimColor = 0xffb2b2b2u;
constexpr u32 kTitleColor = 0xff5bc6ffu;
struct KeycapIcon { i16 target; const char* image; };
constexpr std::array<KeycapIcon, HostOnScreenKeyboard::IconCount> kKeycapIcons{{
	{ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::Backspace], "keyboard_backspace"},
	{ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::Tab], "keyboard_tab"},
	{ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::CapsLock], "keyboard_caps_lock"},
	{ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::Enter], "keyboard_enter"},
	{ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::ShiftLeft], "keyboard_shift"},
	{ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::Space], "keyboard_space"},
	{ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::ArrowLeft], "keyboard_arrow_left"},
	{ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::ArrowDown], "keyboard_arrow_down"},
	{ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::ArrowUp], "keyboard_arrow_up"},
	{ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::ArrowRight], "keyboard_arrow_right"},
	{ON_SCREEN_KEYBOARD_POSITION_TARGET, "keyboard_dock_bottom"},
}};

} // namespace

HostOnScreenKeyboard::HostOnScreenKeyboard(OnScreenKeyboard& model) : m_model(model) {
	m_panel_rect.kind = RectRenderKind::Rect;
	m_panel_rect.color = kPanelColor;
	m_panel_rect.layer = Layer2D::IDE;
	m_title_glyphs.items.emplace_back(kTitles[0]);
	m_title_glyphs.item_end = static_cast<i32>(m_title_glyphs.items[0].size());
	m_title_glyphs.z = 922.0f;
	m_title_glyphs.color = kTitleColor;
	m_title_glyphs.layer = Layer2D::IDE;
	m_title_shadow = m_title_glyphs;
	m_title_shadow.color = kShadowColor;
	m_title_shadow.z = 921.0f;
	m_command_kinds[0] = Host2DKind::Rect;
	m_command_refs[0] = Host2DRef{.rect = &m_panel_rect};
	m_command_kinds[1] = Host2DKind::Glyphs;
	m_command_refs[1] = Host2DRef{.glyphs = &m_title_shadow};
	m_command_kinds[2] = Host2DKind::Glyphs;
	m_command_refs[2] = Host2DRef{.glyphs = &m_title_glyphs};
	m_renderedShift = model.shiftActive();
	m_key_icon_indices.fill(-1);
	for (size_t index = 0; index < kKeycapIcons.size(); ++index) {
		const auto& definition = kKeycapIcons[index];
		m_key_icon_indices[static_cast<size_t>(definition.target)] = static_cast<i16>(index);
		auto& icon = m_key_icons[index];
		icon.imgid = definition.image;
		icon.pos.z = 922.0f;
		icon.colorize = kTextColor;
		icon.layer = Layer2D::IDE;
		m_key_icon_shadows[index] = icon;
		m_key_icon_shadows[index].pos.z = 921.0f;
		m_key_icon_shadows[index].colorize = kShadowColor;
	}
	for (size_t index = 0u; index < ON_SCREEN_KEYBOARD_TARGET_COUNT; index += 1u) {
		RectRenderSubmission& rect = m_key_rects[index];
		rect.kind = RectRenderKind::Rect;
		rect.color = kKeyColor;
		rect.layer = Layer2D::IDE;
		if (m_key_icon_indices[index] >= 0) continue;
		GlyphRenderSubmission& glyphs = m_key_glyphs[index];
		glyphs.items.emplace_back(m_model.label(static_cast<i16>(index)));
		glyphs.item_end = static_cast<i32>(glyphs.items[0].size());
		glyphs.z = 922.0f;
		glyphs.color = kTextColor;
		glyphs.layer = Layer2D::IDE;
		m_key_shadows[index] = glyphs;
		m_key_shadows[index].color = kShadowColor;
		m_key_shadows[index].z = 921.0f;
	}
	for (size_t index = 0u; index < kHelpLines.size(); index += 1u) {
		GlyphRenderSubmission& glyphs = m_help_glyphs[index];
		glyphs.items.emplace_back(kHelpLines[index]);
		glyphs.item_end = static_cast<i32>(glyphs.items[0].size());
		glyphs.z = 922.0f;
		glyphs.color = kDimColor;
		glyphs.layer = Layer2D::IDE;
		m_help_shadows[index] = glyphs;
		m_help_shadows[index].color = kShadowColor;
		m_help_shadows[index].z = 921.0f;
	}
}

void HostOnScreenKeyboard::togglePosition() {
	m_bottomDocked = !m_bottomDocked;
	m_layout_width = -1;
}

i32 HostOnScreenKeyboard::selectAt(i32 x, i32 y) {
	for (const auto& row : m_model.rows()) for (i16 key : row.keys) {
		if (point_in_rect(static_cast<f32>(x), static_cast<f32>(y), m_key_rects[static_cast<size_t>(key)].area)) {
			m_model.selectKey(key, m_model.page()); return key;
		}
	}
	return -1;
}
void HostOnScreenKeyboard::queueRenderCommands(VideoPresenter& presenter) {
	if (m_model.page() != m_renderedPage || !m_pageRendered) {
		m_renderedPage = m_model.page(); m_pageRendered = true; rebuildPageCommands(); m_layout_width = -1;
	}
	if (m_model.shiftActive() != m_renderedShift) {
		m_renderedShift = m_model.shiftActive();
		for (size_t key = 0; key < m_key_glyphs.size(); ++key) {
			if (m_key_icon_indices[key] >= 0) continue;
			auto& glyphs = m_key_glyphs[key]; glyphs.items[0] = m_model.label(static_cast<i16>(key)); glyphs.item_end = static_cast<i32>(glyphs.items[0].size());
			m_key_shadows[key].items[0] = glyphs.items[0];
			m_key_shadows[key].item_end = glyphs.item_end;
		}
		m_layout_width = -1;
	}
	if (m_model.revision() != m_renderedRevision) { m_renderedRevision = m_model.revision(); updateKeyColors(); }
	const auto& bounds = presenter.visibleViewportBounds;
	const f32 width = bounds.right - bounds.left;
	if (m_layout_left != bounds.left || m_layout_top != bounds.top || m_layout_bottom != bounds.bottom
		|| m_layout_width != width || m_layout_font != presenter.default_font) {
		m_layout_left = bounds.left; m_layout_top = bounds.top; m_layout_bottom = bounds.bottom;
		m_layout_width = width; m_layout_font = presenter.default_font; layoutKeys(presenter);
	}
	presenter.hostOverlayQueue.clearHostMenuFrame();
	presenter.hostOverlayQueue.publishHostMenuFrame(HostMenuFrame{m_command_kinds.data(), m_command_refs.data(), m_commandCount});
}
void HostOnScreenKeyboard::rebuildPageCommands() {
	m_title_glyphs.items[0] = kTitles[m_model.page()];
	m_title_glyphs.item_end = static_cast<i32>(m_title_glyphs.items[0].size());
	m_title_shadow.items[0] = m_title_glyphs.items[0];
	m_title_shadow.item_end = m_title_glyphs.item_end;
	size_t command = 3;
	for (const auto& row : m_model.rows()) for (i16 key : row.keys) {
		m_command_kinds[command] = Host2DKind::Rect; m_command_refs[command++] = Host2DRef{.rect = &m_key_rects[static_cast<size_t>(key)]};
		const i16 icon = m_key_icon_indices[static_cast<size_t>(key)];
		if (icon >= 0) {
			m_command_kinds[command] = Host2DKind::Img; m_command_refs[command++] = Host2DRef{.img = &m_key_icon_shadows[static_cast<size_t>(icon)]};
			m_command_kinds[command] = Host2DKind::Img; m_command_refs[command++] = Host2DRef{.img = &m_key_icons[static_cast<size_t>(icon)]};
		} else {
			m_command_kinds[command] = Host2DKind::Glyphs; m_command_refs[command++] = Host2DRef{.glyphs = &m_key_shadows[static_cast<size_t>(key)]};
			m_command_kinds[command] = Host2DKind::Glyphs; m_command_refs[command++] = Host2DRef{.glyphs = &m_key_glyphs[static_cast<size_t>(key)]};
		}
	}
	for (size_t index = 0; index < m_help_glyphs.size(); ++index) {
		m_command_kinds[command] = Host2DKind::Glyphs; m_command_refs[command++] = Host2DRef{.glyphs = &m_help_shadows[index]};
		m_command_kinds[command] = Host2DKind::Glyphs; m_command_refs[command++] = Host2DRef{.glyphs = &m_help_glyphs[index]};
	}
	m_commandCount = command;
}
void HostOnScreenKeyboard::updateKeyColors() {
	for (const auto& row : m_model.rows()) for (i16 key : row.keys) {
		const bool pressed = m_model.isKeyHighlighted(key);
		const bool selected = key == m_model.selectedKey();
		m_key_rects[static_cast<size_t>(key)].color = pressed ? kPressedKeyColor : selected ? kSelectedKeyColor : kKeyColor;
		const u32 foreground = pressed ? kPressedKeyColor : selected ? kSelectedKeyColor : kTextColor;
		const i16 icon = m_key_icon_indices[static_cast<size_t>(key)];
		if (icon >= 0) m_key_icons[static_cast<size_t>(icon)].colorize = foreground;
		else m_key_glyphs[static_cast<size_t>(key)].color = foreground;
	}
	m_help_glyphs[1].color = m_model.isKeyHighlighted(ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::Home])
		|| m_model.isKeyHighlighted(ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::End]) ? kPressedKeyColor : kDimColor;
}
void HostOnScreenKeyboard::layoutKeys(VideoPresenter& presenter) {
	BFont* font = presenter.default_font;
	const auto& bounds = presenter.visibleViewportBounds;
	const f32 viewportWidth = bounds.right - bounds.left;
	const i32 lineHeight = font->lineHeight() > 10 ? 10 : font->lineHeight();
	const i32 keyHeight = lineHeight + 4;
	const auto pageRows = m_model.rows();
	f32 maxUnits = 0;
	for (const auto& row : pageRows) maxUnits = std::max(maxUnits, row.units);
	const i32 unitWidth = std::min(kUnitWidth, static_cast<i32>((viewportWidth - kPanelPadding * 2 + kKeyGap) / maxUnits) - kKeyGap);
	const f32 keyboardWidth = maxUnits * (unitWidth + kKeyGap) - kKeyGap;
	const i32 keysHeight = static_cast<i32>(pageRows.size()) * keyHeight
		+ (static_cast<i32>(pageRows.size()) - 1) * kRowGap;
	const i32 helpHeight = static_cast<i32>(kHelpLines.size()) * lineHeight
		+ (static_cast<i32>(kHelpLines.size()) - 1) * kHelpLineGap;
	const f32 panelWidth = keyboardWidth + kPanelPadding * 2;
	const i32 panelHeight = kPanelPadding * 2 + lineHeight + kTitleGap
		+ keysHeight + kHelpGap + helpHeight;
	const f32 left = bounds.left + static_cast<i32>((viewportWidth - panelWidth) / 2);
	const f32 top = m_bottomDocked ? bounds.bottom - kPanelPadding - panelHeight : bounds.top + kPanelPadding;
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
	m_title_shadow.font = font;
	m_title_shadow.x = m_title_glyphs.x + 1;
	m_title_shadow.y = m_title_glyphs.y + 1;
	const f32 keyTop = top + kPanelPadding + lineHeight + kTitleGap;
	for (size_t rowIndex = 0u; rowIndex < pageRows.size(); rowIndex += 1u) {
		const auto& row = pageRows[rowIndex];
		const f32 rowWidth = row.units * (unitWidth + kKeyGap) - kKeyGap;
		const f32 rowLeft = bounds.left + static_cast<i32>((viewportWidth - rowWidth) / 2);
		const f32 keyY = keyTop + static_cast<i32>(rowIndex) * (keyHeight + kRowGap);
		for (size_t column = 0; column < row.keys.size(); ++column) {
			const i16 index = row.keys[column];
			const size_t offset = static_cast<size_t>(index);
			const f32 keyLeft = rowLeft + row.starts[column] * (unitWidth + kKeyGap);
			const f32 width = row.spans[column] * (unitWidth + kKeyGap) - kKeyGap;
			m_key_rects[offset].area = RectBounds{
				static_cast<f32>(keyLeft),
				static_cast<f32>(keyY),
				static_cast<f32>(keyLeft + width),
				static_cast<f32>(keyY + keyHeight),
				921.0f,
			};
			const i16 iconIndex = m_key_icon_indices[offset];
			if (iconIndex >= 0) {
				auto& icon = m_key_icons[static_cast<size_t>(iconIndex)];
				auto& shadow = m_key_icon_shadows[static_cast<size_t>(iconIndex)];
				const auto& image = hostSystemAtlasImage(icon.imgid);
				icon.pos.x = keyLeft + static_cast<i32>((width - image.width) / 2);
				icon.pos.y = keyY + (keyHeight - image.height) / 2;
				shadow.pos.x = icon.pos.x + 1;
				shadow.pos.y = icon.pos.y + 1;
				if (index == ON_SCREEN_KEYBOARD_POSITION_TARGET) {
					icon.flip.flip_v = m_bottomDocked;
					shadow.flip.flip_v = m_bottomDocked;
				}
				continue;
			}
			GlyphRenderSubmission& glyphs = m_key_glyphs[offset];
			glyphs.font = font;
			glyphs.x = static_cast<f32>(
				keyLeft + static_cast<i32>((width - font->measure(glyphs.items[0])) / 2));
			glyphs.y = static_cast<f32>(keyY + (keyHeight - lineHeight) / 2);
			m_key_shadows[offset].font = font;
			m_key_shadows[offset].x = glyphs.x + 1;
			m_key_shadows[offset].y = glyphs.y + 1;
		}
	}
	const f32 helpTop = keyTop + keysHeight + kHelpGap;
	for (size_t index = 0u; index < kHelpLines.size(); index += 1u) {
		GlyphRenderSubmission& glyphs = m_help_glyphs[index];
		glyphs.font = font;
		glyphs.x = bounds.left + static_cast<i32>((viewportWidth - font->measure(glyphs.items[0])) / 2);
		glyphs.y = static_cast<f32>(
			helpTop + static_cast<i32>(index) * (lineHeight + kHelpLineGap));
		m_help_shadows[index].font = font;
		m_help_shadows[index].x = glyphs.x + 1;
		m_help_shadows[index].y = glyphs.y + 1;
	}
}

} // namespace bmsx
