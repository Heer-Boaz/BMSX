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
	static constexpr size_t CommandCapacity = 2 + OnScreenKeyboard::KeyCount * 2 + HelpLineCount;
	explicit HostOnScreenKeyboard(OnScreenKeyboard& model);
	i32 selectAt(i32 x, i32 y);
	void queueRenderCommands(VideoPresenter& presenter);
private:
	void rebuildPageCommands();
	void updateKeyColors();
	void layoutKeys(VideoPresenter& presenter);
	OnScreenKeyboard& m_model;
	RectRenderSubmission m_panel_rect;
	GlyphRenderSubmission m_title_glyphs;
	std::array<GlyphRenderSubmission, HelpLineCount> m_help_glyphs;
	std::array<RectRenderSubmission, OnScreenKeyboard::KeyCount> m_key_rects;
	std::array<GlyphRenderSubmission, OnScreenKeyboard::KeyCount> m_key_glyphs;
	std::array<Host2DKind, CommandCapacity> m_command_kinds;
	std::array<Host2DRef, CommandCapacity> m_command_refs;
	size_t m_commandCount = 0;
	u64 m_renderedRevision = std::numeric_limits<u64>::max();
	size_t m_renderedPage = 0;
	bool m_pageRendered = false;
	bool m_renderedShift = false;
	f32 m_layout_left = -1, m_layout_top = -1, m_layout_width = -1;
	BFont* m_layout_font = nullptr;
};
} // namespace bmsx
