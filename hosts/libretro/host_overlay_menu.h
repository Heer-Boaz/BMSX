#pragma once

#include "common/primitives.h"
#include "host_on_screen_keyboard.h"
#include "rewind_timeline.h"
#include "machine/devices/input/contracts.h"
#include "render/host_overlay/commands.h"
#include "render/shared/submissions.h"
#include <array>
#include <cstddef>
#include <string>

namespace bmsx {

class Runtime;
class VideoPresenter;
class LibretroInput;
class HostRewind;

enum class HostMenuInput : u8 {
	Inactive,
	Active,
	RebootCart,
	ExitGame,
};

enum class HostMenuButtonId : u8 {
	Up,
	Down,
	Left,
	Right,
	A,
	B,
	LeftBumper,
	RightBumper,
	Start,
	Count,
};

enum class HostMenuRepeatId : u8 {
	Up,
	Down,
	Left,
	Right,
	Backspace,
	Space,
	CursorLeft,
	CursorRight,
	Home,
	End,
	LeftBumper,
	RightBumper,
	Count,
	None = 0xff,
};

class HostOverlayMenu {
	enum class Page : u8 {
		Closed,
		Options,
		Keyboard,
		Rewind,
	};
	enum class Outcome { Cancel, Accept, Discard };

public:
	HostOverlayMenu();
	HostMenuInput tickInput(Runtime& runtime, LibretroInput& input, VideoPresenter& presenter, HostRewind& rewind, f64 currentTimeMs);
	void resetInputState(LibretroInput& input, HostRewind& rewind);
	void queueRenderCommands(Runtime& runtime, VideoPresenter& presenter, HostRewind& rewind);
	bool queueFrameOverlayCommands(Runtime& runtime, VideoPresenter& presenter, HostRewind& rewind, f64 hostFps);
	bool active() const { return m_page != Page::Closed; }

private:
	static constexpr i32 OptionCount = 15;
	static constexpr i32 UsageBarCount = 3;
	static constexpr size_t CommandCapacity = 128;
	struct ButtonRepeatRecord {
		bool active = false;
		i32 repeatCount = 0;
		f64 pressStartMs = -1.0;
		f64 lastRepeatAtMs = -1.0;
	};

	void clearRenderCommands(VideoPresenter& presenter);
	void publishRenderCommands(VideoPresenter& presenter);
	void queueCommand(Host2DKind kind, Host2DRef ref);
	void transitionTo(Page next, LibretroInput& input, HostRewind& rewind, Outcome outcome = Outcome::Cancel);
	HostMenuInput tickTimelineInput(Runtime& runtime, LibretroInput& input, HostRewind& rewind, f64 currentTimeMs);
	void changeSelected(VideoPresenter& presenter, i32 direction);
	HostMenuInput activateSelected(LibretroInput& input, VideoPresenter& presenter, HostRewind& rewind);
	void rebuildText(VideoPresenter& presenter);
	bool tickPointerInput(LibretroInput& input);
	i32 selectPointerTargetAt(i32 x, i32 y);
	void resetPointerPress();
	bool buttonJustPressed(const LibretroInput& input, HostMenuButtonId button) const;
	bool gamepadButtonPressed(
		const LibretroInput& input,
		u8 deviceSlot,
		HostMenuButtonId button) const;
	bool buttonRepeatEdge(
		const LibretroInput& input,
		HostMenuButtonId button,
		HostMenuRepeatId repeat,
		f64 currentTimeMs,
		f64 frameDurationMs);
	bool gamepadButtonRepeatEdge(
		const LibretroInput& input,
		HostMenuButtonId button,
		HostMenuRepeatId repeat,
		f64 currentTimeMs,
		f64 frameDurationMs);
	OnScreenKeyboardCommand onScreenKeyboardCommand(
		const LibretroInput& input,
		f64 currentTimeMs,
		f64 frameDurationMs);
	void latchButtonStates(const LibretroInput& input);
	void consumeGamepadButtons(LibretroInput& input);
	bool advanceButtonRepeat(bool pressed, bool justPressed, ButtonRepeatRecord& repeat, f64 currentTimeMs, f64 frameDurationMs);
	void resetButtonRepeats();

	HostRewindTimeline timeline;
	Page m_page = Page::Closed;
	HostOnScreenKeyboard m_keyboard;
	bool m_showFps = false;
	i32 m_selected = 0;
	bool m_dirtyText = true;
	std::array<std::string, OptionCount> m_lineText;
	RectRenderSubmission m_panelRect;
	RectRenderSubmission m_highlightRect;
	GlyphRenderSubmission m_titleGlyphs;
	GlyphRenderSubmission m_fpsGlyphs;
	RectRenderSubmission m_usagePanelRect;
	std::array<RectRenderSubmission, UsageBarCount> m_usageBarBackgrounds;
	std::array<RectRenderSubmission, UsageBarCount> m_usageBarFills;
	std::array<GlyphRenderSubmission, UsageBarCount> m_usageLabels;
	std::array<GlyphRenderSubmission, UsageBarCount> m_usagePercents;
	std::array<i32, UsageBarCount> m_usagePercentCode;
	std::array<GlyphRenderSubmission, OptionCount> m_optionGlyphs;
	std::array<Host2DKind, CommandCapacity> m_commandKinds;
	std::array<Host2DRef, CommandCapacity> m_commandRefs;
	std::array<bool, static_cast<size_t>(HostMenuButtonId::Count)>
		m_previousKeyboardButtonStates{};
	std::array<
		std::array<bool, static_cast<size_t>(HostMenuButtonId::Count)>,
		INPUT_CONTROLLER_PAD_COUNT> m_previousGamepadButtonStates{};
	std::array<u32, INPUT_CONTROLLER_PAD_COUNT>
		m_previousPhysicalGamepadButtons{};
	std::array<ButtonRepeatRecord, static_cast<size_t>(HostMenuRepeatId::Count)>
		m_keyboardButtonRepeats{};
	std::array<
		std::array<ButtonRepeatRecord, static_cast<size_t>(HostMenuRepeatId::Count)>,
		INPUT_CONTROLLER_PAD_COUNT> m_gamepadButtonRepeats{};
	RectBounds m_optionHitRect;
	i32 m_optionLineHeight = 0;
	i32 m_pointerX = 0;
	i32 m_pointerY = 0;
	bool m_pointerValid = false;
	bool m_previousPointerPrimary = false;
	Page m_pointerPressPage = Page::Closed;
	i32 m_pointerPressTarget = -1;
	size_t m_commandCount = 0;
	std::string m_fpsText;
	i32 m_fpsTextTenths = -1;
	i32 m_fpsTextWidth = 0;
};

} // namespace bmsx
