#pragma once

#include "common/primitives.h"
#include "render/host_overlay/commands.h"
#include "render/shared/submissions.h"
#include "machine/devices/input/contracts.h"

#include <array>
#include <cstddef>

namespace bmsx {

class BFont;
class LibretroInput;
class VideoPresenter;

enum class OnScreenKeyboardCommand : u8 {
	None,
	Activate,
	Backspace,
	Delete,
	Space,
	Shift,
	Left,
	Right,
	Home,
	End,
	Enter,
};

class HostOnScreenKeyboard {
public:
	static constexpr size_t KeyCount = 60u;
	static constexpr size_t ModifierCount = 3u;
	static constexpr size_t HelpLineCount = 4u;
	static constexpr size_t CommandCount = 2u + KeyCount * 2u + HelpLineCount;
	static constexpr size_t PointerSource = INPUT_CONTROLLER_PAD_COUNT * INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT;
	static constexpr size_t SourceCount = PointerSource + 1u;
	static constexpr size_t ForwardedKeyCount = KeyCount + 2u;

	HostOnScreenKeyboard();
	void open();
	void close(LibretroInput& input);
	void releaseSource(LibretroInput& input, size_t source);
	void moveHorizontal(i32 direction);
	void moveVertical(i32 direction);
	void activate(LibretroInput& input, size_t source);
	void command(LibretroInput& input, size_t source, OnScreenKeyboardCommand command);
	i32 selectAt(i32 x, i32 y);
	void queueRenderCommands(VideoPresenter& presenter);

private:
	i32 keyCenterUnits(i32 rowIndex, i32 keyIndex) const;
	void pressKey(LibretroInput& input, size_t source, u8 usage);
	void setShift(LibretroInput& input, bool down);
	void updateKeyColors();
	void layoutKeys(VideoPresenter& presenter);

	i32 m_selected_row = 1;
	i32 m_selected_key = 15;
	std::array<i16, SourceCount> m_source_keys;
	std::array<u8, SourceCount> m_source_modifiers{};
	std::array<u8, ForwardedKeyCount> m_key_counts{};
	std::array<u8, ModifierCount> m_modifier_counts{};
	std::array<bool, ModifierCount> m_modifier_states{};
	RectRenderSubmission m_panel_rect;
	GlyphRenderSubmission m_title_glyphs;
	std::array<GlyphRenderSubmission, HelpLineCount> m_help_glyphs;
	std::array<RectRenderSubmission, KeyCount> m_key_rects;
	std::array<GlyphRenderSubmission, KeyCount> m_key_glyphs;
	std::array<Host2DKind, CommandCount> m_command_kinds;
	std::array<Host2DRef, CommandCount> m_command_refs;
	i32 m_layout_width = -1;
	i32 m_layout_height = -1;
	BFont* m_layout_font = nullptr;
};

} // namespace bmsx
