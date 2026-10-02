#include "rewind_timeline.h"
#include <algorithm>
#include <cstdio>

namespace bmsx {
namespace {
enum TimelineRect { Panel, Track, Fill, Cursor };
enum TimelineLabel { Range, Position, Status, Previous, Playback, Next, Present, Resume, Cancel };
constexpr std::array<const char*, 5> STATUS_TEXT{"LIVE", "PAUSED", "REPLAY", "SEEKING", "STOPPED"};
}

HostRewindTimeline::HostRewindTimeline(const TimelineStyle& style) : style(style) {
	for (size_t index = 0; index < rects.size(); ++index) {
		auto& rect = rects[index];
		rect.kind = RectRenderKind::Fill;
		rect.area.z = static_cast<f32>(style.z + index);
		rect.layer = Layer2D::IDE;
		commandKinds[index] = Host2DKind::Rect;
		commandRefs[index].rect = &rect;
	}
	for (size_t index = 0; index < labels.size(); ++index) {
		auto& label = labels[index];
		label.items.emplace_back(index < Previous ? std::string_view{} : style.actions[index - Previous]);
		label.items[0].reserve(32);
		label.item_end = static_cast<i32>(label.items[0].size());
		label.z = static_cast<f32>(style.z + 4);
		label.color = style.text;
		label.background_color = style.track;
		label.layer = Layer2D::IDE;
		commandKinds[rects.size() + index] = Host2DKind::Glyphs;
		commandRefs[rects.size() + index].glyphs = &label;
	}
}

TimelineAction HostRewindTimeline::selectAt(i32 x, i32 y) const {
	for (size_t index = 0; index < hitRects.size(); ++index) {
		if ((state.enabledActions & (1u << index)) != 0 && point_in_rect(static_cast<f32>(x), static_cast<f32>(y), hitRects[index])) return static_cast<TimelineAction>(index);
	}
	return TimelineAction::None;
}

i64 HostRewindTimeline::cyclesAt(i32 x) const {
	const auto& track = rects[Track].area;
	const i64 offset = std::clamp(x, static_cast<i32>(track.left), static_cast<i32>(track.right)) - static_cast<i32>(track.left);
	return state.earliestCycles + (state.latestCycles - state.earliestCycles) * offset / static_cast<i32>(track.right - track.left);
}

void HostRewindTimeline::setLabel(size_t index, std::string_view text) {
	auto& label = labels[index]; label.items[0] = text;
	label.item_end = static_cast<i32>(text.size()); labelWidths[index] = font->measure(label.items[0]);
}

void HostRewindTimeline::update(const TimelineState& state, i32 left, i32 top, i32 right, BFont& font) {
	this->state = state;
	if (this->font != &font) {
		this->font = &font;
		for (size_t index = 0; index < labels.size(); ++index) {
			labels[index].font = &font; labelWidths[index] = font.measure(labels[index].items[0]);
		}
	}
	const i64 range = state.latestCycles - state.earliestCycles;
	const i64 rangeTenths = range * 10 / state.cpuHz;
	const i64 offsetTenths = (state.latestCycles - state.positionCycles) * 10 / state.cpuHz;
	char text[32];
	if (rangeTenths != this->rangeTenths) {
		this->rangeTenths = rangeTenths;
		std::snprintf(text, sizeof(text), "HISTORY %lld.%lldS", static_cast<long long>(rangeTenths / 10), static_cast<long long>(rangeTenths % 10));
		setLabel(Range, text);
	}
	if (offsetTenths != this->offsetTenths) {
		this->offsetTenths = offsetTenths;
		if (offsetTenths == 0) setLabel(Position, "NOW");
		else {
			std::snprintf(text, sizeof(text), "-%lld.%lldS", static_cast<long long>(offsetTenths / 10), static_cast<long long>(offsetTenths % 10));
			setLabel(Position, text);
		}
	}
	if (!statusShown || state.status != statusText) {
		statusShown = true; statusText = state.status; setLabel(Status, STATUS_TEXT[static_cast<size_t>(state.status)]);
	}
	const bool playing = state.status == TimelineStatus::Live || state.status == TimelineStatus::Replay;
	if (playing != this->playing) { this->playing = playing; setLabel(Playback, playing ? style.pauseLabel : style.actions[1]); }
	const i32 bottom = top + height(font), trackLeft = left + 6, trackRight = right - 6;
	write_rect_bounds(rects[Panel].area, left, top, right, bottom);
	const i32 trackTop = top + font.lineHeight() + 7;
	write_rect_bounds(rects[Track].area, trackLeft, trackTop, trackRight, trackTop + 3);
	write_rect_bounds(hitRects[0], trackLeft - 3, trackTop - 3, trackRight + 3, trackTop + 6);
	const i32 cursor = range == 0 ? trackRight : trackLeft + static_cast<i32>((state.positionCycles - state.earliestCycles) * (trackRight - trackLeft) / range);
	write_rect_bounds(rects[Fill].area, trackLeft, trackTop, cursor, trackTop + 3);
	write_rect_bounds(rects[Cursor].area, cursor - 1, trackTop - 3, cursor + 2, trackTop + 6);
	rects[Panel].color = style.panel; rects[Track].color = style.track; rects[Fill].color = style.accent;
	rects[Cursor].color = state.status == TimelineStatus::Seeking ? style.accent : style.text;
	const i32 rangeRight = trackLeft + labelWidths[Range];
	labels[Range].x = trackLeft; labels[Position].x = trackRight - labelWidths[Position];
	labels[Status].x = (left + right - labelWidths[Status]) / 2;
	for (size_t index = 0; index < Previous; ++index) {
		labels[index].y = top + 3; labels[index].color = style.text; labels[index].item_end = static_cast<i32>(labels[index].items[0].size());
	}
	if (labels[Status].x < rangeRight + 4 || labels[Status].x + labelWidths[Status] > labels[Position].x - 4) {
		labels[Range].item_end = 0; labels[Status].x = trackLeft;
	}
	const i32 actionTop = trackTop + 8;
	i32 actionRight = trackRight;
	for (i32 action = 6; action >= 4; --action) {
		const size_t index = Previous + action - 1;
		const i32 width = (style.visibleActions & (1u << action)) == 0 ? 0 : labelWidths[index] + 4;
		labels[index].x = actionRight - width + 2;
		if (width != 0) actionRight -= width + 6;
	}
	i32 actionLeft = trackLeft;
	for (i32 action = 1; action <= 6; ++action) {
		const size_t index = Previous + action - 1;
		auto& label = labels[index]; label.y = actionTop; label.item_end = static_cast<i32>(label.items[0].size());
		if (action <= 3) { label.x = actionLeft + 2; actionLeft += labelWidths[index] + 10; }
		const bool enabled = (state.enabledActions & (1u << action)) != 0;
		const bool highlighted = enabled && (static_cast<TimelineAction>(action) == state.hoveredAction || static_cast<TimelineAction>(action) == state.focusedAction);
		label.color = highlighted ? style.highlightText : enabled ? style.text : style.disabled; label.background_color = style.highlight;
		label.has_background_color = highlighted;
		if ((style.visibleActions & (1u << action)) == 0) { label.item_end = 0; hitRects[action] = {}; }
		else write_rect_bounds(hitRects[action], label.x - 2, actionTop - 2, label.x + labelWidths[index] + 2, bottom);
	}
}
} // namespace bmsx
