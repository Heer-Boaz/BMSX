#pragma once

#include "common/primitives.h"
#include "host_on_screen_keyboard.h"
#include "render/host_overlay/commands.h"
#include "render/shared/submissions.h"
#include <array>
#include <cstddef>
#include <string>

namespace bmsx {

class Runtime;
class VideoPresenter;
class LibretroInput;

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
	Count,
};

enum class HostMenuRepeatId : u8 {
	Up,
	Down,
	Left,
	Right,
	Count,
};

class HostOverlayMenu {
	enum class Page : u8 {
		Closed,
		Options,
		Keyboard,
	};

public:
	HostOverlayMenu();
	HostMenuInput tickInput(LibretroInput& input, VideoPresenter& presenter, f64 currentTimeMs);
	void resetInputState(LibretroInput& input);
	void queueRenderCommands(VideoPresenter& presenter);
	bool queueFrameOverlayCommands(Runtime& runtime, VideoPresenter& presenter, f64 hostFps);
	bool active() const { return m_page != Page::Closed; }

private:
	static constexpr i32 OptionCount = 14;
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
	void toggle(LibretroInput& input);
	void close(LibretroInput& input);
	void changeSelected(VideoPresenter& presenter, i32 direction);
	HostMenuInput activateSelected(LibretroInput& input);
	void rebuildText(VideoPresenter& presenter);
	bool buttonPressed(const LibretroInput& input, HostMenuButtonId button) const;
	bool buttonJustPressed(const LibretroInput& input, HostMenuButtonId button) const;
	bool gamepadButtonPressed(const LibretroInput& input, HostMenuButtonId button) const;
	bool gamepadButtonJustPressed(const LibretroInput& input, HostMenuButtonId button) const;
	void latchButtonStates(const LibretroInput& input);
	void consumeGamepadButtons(LibretroInput& input);
	bool advanceButtonRepeat(bool pressed, bool justPressed, ButtonRepeatRecord& repeat, f64 currentTimeMs, f64 frameDurationMs);
	void resetButtonRepeats();

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
	std::array<bool, static_cast<size_t>(HostMenuButtonId::Count)> m_previousButtonStates{};
	std::array<bool, static_cast<size_t>(HostMenuButtonId::Count)> m_previousGamepadButtonStates{};
	std::array<ButtonRepeatRecord, static_cast<size_t>(HostMenuRepeatId::Count)> m_buttonRepeats;
	size_t m_commandCount = 0;
	std::string m_fpsText;
	i32 m_fpsTextTenths = -1;
	i32 m_fpsTextWidth = 0;
};

} // namespace bmsx
