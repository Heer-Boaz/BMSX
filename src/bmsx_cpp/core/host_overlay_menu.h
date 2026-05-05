#pragma once

#include "core/primitives.h"
#include "render/shared/submissions.h"
#include <array>
#include <string>

namespace bmsx {

class ConsoleCore;
class GameView;

class HostOverlayMenu {
public:
	HostOverlayMenu();
	bool tickInput(ConsoleCore& console);
	void queueRenderCommands(ConsoleCore& console, GameView& view);
	bool queueFrameOverlayCommands(ConsoleCore& console, GameView& view);
	bool active() const { return m_active; }

private:
	static constexpr i32 OptionCount = 13;
	static constexpr i32 UsageBarCount = 4;

	void toggle();
	void close();
	void changeSelected(ConsoleCore& console, GameView& view, i32 direction);
	void activateSelected(ConsoleCore& console);
	void rebuildText(ConsoleCore& console, GameView& view);

	bool m_active = false;
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
	std::string m_fpsText;
	i32 m_fpsTextTenths = -1;
	i32 m_fpsTextWidth = 0;
};

HostOverlayMenu& hostOverlayMenu();

} // namespace bmsx
