#pragma once

#include "common/primitives.h"
#include "render/host_overlay/commands.h"
#include "render/shared/submissions.h"

#include <array>
#include <cstddef>

namespace bmsx {

class BFont;
class LibretroInput;
class VideoPresenter;

class HostOnScreenKeyboard {
public:
	static constexpr size_t KeyCount = 60u;
	static constexpr size_t ModifierCount = 3u;
	static constexpr size_t CommandCount = 3u + KeyCount * 2u;

	HostOnScreenKeyboard();
	void open();
	void close(LibretroInput& input);
	void releasePulse(LibretroInput& input);
	void moveHorizontal(i32 direction);
	void moveVertical(i32 direction);
	void activate(LibretroInput& input);
	void queueRenderCommands(VideoPresenter& presenter);

private:
	i32 keyCenterUnits(i32 rowIndex, i32 keyIndex) const;
	void updateKeyColors();
	void layoutKeys(VideoPresenter& presenter);

	i32 m_selected_row = 1;
	i32 m_selected_key = 15;
	i16 m_pulse_usage = -1;
	std::array<bool, ModifierCount> m_modifier_states{};
	RectRenderSubmission m_panel_rect;
	GlyphRenderSubmission m_title_glyphs;
	GlyphRenderSubmission m_help_glyphs;
	std::array<RectRenderSubmission, KeyCount> m_key_rects;
	std::array<GlyphRenderSubmission, KeyCount> m_key_glyphs;
	std::array<Host2DKind, CommandCount> m_command_kinds;
	std::array<Host2DRef, CommandCount> m_command_refs;
	i32 m_layout_width = -1;
	i32 m_layout_height = -1;
	BFont* m_layout_font = nullptr;
};

} // namespace bmsx
