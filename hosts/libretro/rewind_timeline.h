#pragma once

#include "common/rect.h"
#include "render/host_overlay/overlay_queue.h"
#include "render/shared/bmsx_font.h"
#include "render/shared/submissions.h"
#include <array>
#include <string_view>

namespace bmsx {

enum class TimelineAction { None = -1, Seek, Previous, Playback, Next, Present, Resume, Cancel };
enum class TimelineStatus { Live, Paused, Replay, Seeking, Stopped };
struct TimelineState {
	i64 earliestCycles = 0, latestCycles = 0, positionCycles = 0, cpuHz = 1;
	TimelineStatus status = TimelineStatus::Paused;
	u32 enabledActions = 0;
	TimelineAction hoveredAction = TimelineAction::None, focusedAction = TimelineAction::None;
};
struct TimelineStyle {
	u32 panel = 0xe8070b10u, track = 0xff46525eu, accent = 0xff5bc6ffu, text = 0xffefefefu, disabled = 0xff7d8790u;
	u32 highlight = 0xff46525eu, highlightText = 0xffefefefu;
	i32 z = 920;
	std::array<std::string_view, 6> actions{"LB <|", "A PLAY", "|> RB", "NOW", "START GAME", "B CANCEL"};
	std::string_view pauseLabel = "A PAUSE";
	u32 visibleActions = 0x7f;
};

// Passive presentation. Neither host execution nor runtime objects belong here.
class HostRewindTimeline final {
public:
	explicit HostRewindTimeline(const TimelineStyle& style = {});
	static i32 height(const BFont& font) { return font.lineHeight() * 2 + 18; }
	TimelineAction selectAt(i32 x, i32 y) const;
	i64 cyclesAt(i32 x) const;
	void update(const TimelineState& state, i32 left, i32 top, i32 right, BFont& font);
	const HostMenuFrame& frame() const { return renderFrame; }

private:
	TimelineStyle style;
	TimelineState state;
	std::array<RectBounds, 7> hitRects{};
	BFont* font = nullptr;
	std::array<RectRenderSubmission, 4> rects;
	std::array<GlyphRenderSubmission, 9> labels;
	std::array<i32, 9> labelWidths{};
	std::array<Host2DKind, 13> commandKinds;
	std::array<Host2DRef, 13> commandRefs;
	HostMenuFrame renderFrame{commandKinds.data(), commandRefs.data(), commandKinds.size()};
	i64 rangeTenths = -1, offsetTenths = -1;
	TimelineStatus statusText = TimelineStatus::Paused;
	bool statusShown = false, playing = false;
	void setLabel(size_t index, std::string_view text);
};

} // namespace bmsx
