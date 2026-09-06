#pragma once

#include "common/primitives.h"
#include "host_on_screen_keyboard.h"
#include "rewind_timeline.h"
#include "ui_input.h"
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

class HostOverlayMenu {
	enum class Page : u8 {
		Closed,
		Options,
		Keyboard,
		Rewind,
	};
public:
	enum class Outcome { Cancel, Accept, Discard, Retain };
	explicit HostOverlayMenu(LibretroInput& input);
	HostMenuInput tickInput(Runtime& runtime, LibretroInput& input, VideoPresenter& presenter, HostRewind& rewind, f64 currentTimeMs);
	void resetInputState(LibretroInput& input, HostRewind& rewind);
	void dismiss(LibretroInput& input, HostRewind& rewind, Outcome outcome = Outcome::Retain);
	void queueRenderCommands(Runtime& runtime, VideoPresenter& presenter, HostRewind& rewind);
	bool queueFrameOverlayCommands(Runtime& runtime, VideoPresenter& presenter, HostRewind& rewind, f64 hostFps);
	bool active() const { return m_page != Page::Closed; }

private:
	static constexpr i32 OptionCount = 15;
	static constexpr i32 UsageBarCount = 3;
	static constexpr size_t CommandCapacity = 128;

	void clearRenderCommands(VideoPresenter& presenter);
	void publishRenderCommands(VideoPresenter& presenter);
	void queueCommand(Host2DKind kind, Host2DRef ref);
	void transitionTo(Page next, LibretroInput& input, HostRewind& rewind, Outcome outcome = Outcome::Cancel);
	HostMenuInput tickTimelineInput(Runtime& runtime, LibretroInput& input, HostRewind& rewind);
	HostMenuInput handleInput(Runtime& runtime, LibretroInput& input, VideoPresenter& presenter, HostRewind& rewind);
	void changeSelected(VideoPresenter& presenter, i32 direction);
	HostMenuInput activateSelected(LibretroInput& input, VideoPresenter& presenter, HostRewind& rewind);
	void rebuildText(VideoPresenter& presenter);
	bool tickPointerInput();
	i32 selectPointerTargetAt(i32 x, i32 y);
	OnScreenKeyboardCommand onScreenKeyboardCommand() const;
	HostUiInput uiInput;

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
	RectBounds m_optionHitRect;
	i32 m_optionLineHeight = 0;
	size_t m_commandCount = 0;
	std::string m_fpsText;
	i32 m_fpsTextTenths = -1;
	i32 m_fpsTextWidth = 0;
};

} // namespace bmsx
