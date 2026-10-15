#pragma once
#include "common/primitives.h"
#include "render/host_overlay/commands.h"
#include "render/shared/submissions.h"
#include "on_screen_keyboard.h"
#include <array>
#include <cstddef>
#include <limits>

namespace bmsx {
class BFont;
class VideoPresenter;

/** Bitmap presentation; source lifetimes belong to the injected keyboard. */
class HostOnScreenKeyboard {
public:
	static constexpr size_t KeyCount = MAIN_KEY_COUNT;
	static constexpr size_t HelpLineCount = 4;
	static constexpr size_t IconCount = 11;
	static constexpr size_t CommandCapacity = 3 + ON_SCREEN_KEYBOARD_TARGET_COUNT * 3 + HelpLineCount * 2;
	explicit HostOnScreenKeyboard(OnScreenKeyboard& model);
	void togglePosition();
	i16 hitTestAt(i32 x, i32 y) const;
	size_t publishedPage() const { return m_renderedPage; }
	void queueRenderCommands(VideoPresenter& presenter);
private:
	void rebuildPageCommands();
	void updateKeyColors();
	void layoutKeys(VideoPresenter& presenter);
	OnScreenKeyboard& m_model;
	RectRenderSubmission m_panel_rect;
	GlyphRenderSubmission m_title_glyphs;
	GlyphRenderSubmission m_title_shadow;
	std::array<GlyphRenderSubmission, HelpLineCount> m_help_glyphs;
	std::array<GlyphRenderSubmission, HelpLineCount> m_help_shadows;
	std::array<RectRenderSubmission, ON_SCREEN_KEYBOARD_TARGET_COUNT> m_key_rects;
	std::array<GlyphRenderSubmission, ON_SCREEN_KEYBOARD_TARGET_COUNT> m_key_glyphs;
	std::array<GlyphRenderSubmission, ON_SCREEN_KEYBOARD_TARGET_COUNT> m_key_shadows;
	std::array<i16, ON_SCREEN_KEYBOARD_TARGET_COUNT> m_key_icon_indices;
	std::array<HostImageRenderSubmission, IconCount> m_key_icons;
	std::array<HostImageRenderSubmission, IconCount> m_key_icon_shadows;
	std::array<Host2DKind, CommandCapacity> m_command_kinds;
	std::array<Host2DRef, CommandCapacity> m_command_refs;
	size_t m_commandCount = 0;
	u64 m_renderedRevision = std::numeric_limits<u64>::max();
	size_t m_renderedPage = 0;
	std::span<const OnScreenKeyboardRow> m_publishedRows;
	bool m_pageRendered = false;
	bool m_renderedShift = false;
	bool m_bottomDocked = false;
	f32 m_layout_left = -1, m_layout_top = -1, m_layout_bottom = -1, m_layout_width = -1;
	BFont* m_layout_font = nullptr;
};
} // namespace bmsx
