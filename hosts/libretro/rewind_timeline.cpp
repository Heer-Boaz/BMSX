#include "rewind_timeline.h"

#include "machine/runtime/runtime.h"
#include "render/video_presenter.h"
#include "rewind.h"
#include <algorithm>
#include <cstdio>

namespace bmsx {
namespace {
enum TimelineRect { Panel, Track, Fill, Cursor };
enum TimelineLabel { Range, Position, Status, Navigation, Resume, Cancel };
constexpr std::array<u32, 4> RECT_COLORS{0xe8070b10u, 0xff46525eu, 0xff5bc6ffu, 0xffefefefu};
constexpr std::array<const char*, 6> LABEL_TEXT{"", "", "", "LB <  RB >", "START PLAY", "B CANCEL"};
constexpr u32 COLOR_TEXT = 0xffefefefu;
constexpr u32 COLOR_SEEKING = 0xffffce66u;
}

HostRewindTimeline::HostRewindTimeline() {
	for (size_t index = 0; index < rects.size(); ++index) {
		auto& rect = rects[index];
		rect.kind = RectRenderKind::Fill;
		rect.area.z = static_cast<f32>(920 + index);
		rect.color = RECT_COLORS[index];
		rect.layer = Layer2D::IDE;
		commandKinds[index] = Host2DKind::Rect;
		commandRefs[index].rect = &rect;
	}
	for (size_t index = 0; index < labels.size(); ++index) {
		auto& label = labels[index];
		label.items.emplace_back(LABEL_TEXT[index]);
		label.items[0].reserve(32);
		label.item_end = static_cast<i32>(label.items[0].size());
		label.font = &font;
		label.z = 924;
		label.color = COLOR_TEXT;
		label.baseline = TextBaseline::Top;
		label.layer = Layer2D::IDE;
		labelWidths[index] = font.measure(label.items[0]);
		commandKinds[rects.size() + index] = Host2DKind::Glyphs;
		commandRefs[rects.size() + index].glyphs = &label;
	}
	labels[Status].color = COLOR_SEEKING;
}

void HostRewindTimeline::moveCursor(Runtime& runtime, HostRewind& rewind, i32 direction) {
	const auto& history = runtime.history;
	const i64 cycles = std::clamp(rewind.positionCycles() + direction * runtime.timing.cpuHz, history.earliestCycles(), history.latestCycles());
	if (cycles != rewind.positionCycles()) rewind.seekTo(cycles);
}

void HostRewindTimeline::seekAt(Runtime& runtime, HostRewind& rewind, i32 x) {
	const auto& history = runtime.history;
	const auto& track = rects[Track].area;
	const i64 offset = std::clamp(x, static_cast<i32>(track.left), static_cast<i32>(track.right)) - static_cast<i32>(track.left);
	const i64 cycles = history.earliestCycles() + (history.latestCycles() - history.earliestCycles()) * offset / static_cast<i32>(track.right - track.left);
	if (cycles != rewind.positionCycles()) rewind.seekTo(cycles);
}

void HostRewindTimeline::queueRenderCommands(Runtime& runtime, VideoPresenter& presenter, HostRewind& rewind) {
	const auto& history = runtime.history;
	const i64 range = history.latestCycles() - history.earliestCycles();
	const i64 position = rewind.positionCycles();
	const i64 rangeTenths = range * 10 / runtime.timing.cpuHz;
	const i64 offsetTenths = (history.latestCycles() - position) * 10 / runtime.timing.cpuHz;
	if (rangeTenths != this->rangeTenths) {
		this->rangeTenths = rangeTenths;
		auto& label = labels[Range];
		char text[32];
		std::snprintf(text, sizeof(text), "REWIND %lld.%lldS", static_cast<long long>(rangeTenths / 10), static_cast<long long>(rangeTenths % 10));
		label.items[0] = text;
		label.item_end = static_cast<i32>(label.items[0].size());
		labelWidths[Range] = font.measure(label.items[0]);
	}
	if (offsetTenths != this->offsetTenths) {
		this->offsetTenths = offsetTenths;
		auto& label = labels[Position];
		char text[32];
		if (offsetTenths == 0) label.items[0] = "NOW";
		else {
			std::snprintf(text, sizeof(text), "-%lld.%lldS", static_cast<long long>(offsetTenths / 10), static_cast<long long>(offsetTenths % 10));
			label.items[0] = text;
		}
		label.item_end = static_cast<i32>(label.items[0].size());
		labelWidths[Position] = font.measure(label.items[0]);
	}
	const std::string_view status = rewind.stopped ? "STOPPED" : rewind.seeking() ? "SEEKING" : "";
	if (status != statusText) {
		statusText = status;
		labels[Status].items[0] = status;
		labels[Status].item_end = static_cast<i32>(status.size());
		labelWidths[Status] = font.measure(labels[Status].items[0]);
	}
	const i32 left = 6;
	const i32 right = static_cast<i32>(presenter.viewportSize.x) - 6;
	const i32 top = static_cast<i32>(presenter.viewportSize.y) - 38;
	const i32 trackLeft = left + 6;
	const i32 trackRight = right - 6;
	write_rect_bounds(hitRect, left, top + 10, right, top + 22);
	const i32 cursor = range == 0 ? trackRight : trackLeft + static_cast<i32>((position - history.earliestCycles()) * (trackRight - trackLeft) / range);
	write_rect_bounds(rects[Panel].area, left, top, right, top + 32);
	write_rect_bounds(rects[Track].area, trackLeft, top + 15, trackRight, top + 18);
	write_rect_bounds(rects[Fill].area, trackLeft, top + 15, cursor, top + 18);
	write_rect_bounds(rects[Cursor].area, cursor - 1, top + 12, cursor + 2, top + 21);
	rects[Cursor].color = rewind.seeking() ? COLOR_SEEKING : COLOR_TEXT;
	const i32 center = static_cast<i32>(presenter.viewportSize.x) / 2;
	labels[Range].x = trackLeft;
	labels[Position].x = trackRight - labelWidths[Position];
	labels[Status].x = center - labelWidths[Status] / 2;
	labels[Navigation].x = trackLeft;
	labels[Resume].x = center - labelWidths[Resume] / 2;
	labels[Cancel].x = trackRight - labelWidths[Cancel];
	for (size_t index = 0; index < labels.size(); ++index) {
		labels[index].y = static_cast<f32>(top + (index < Navigation ? 4 : 24));
	}
	presenter.hostOverlayQueue.publishHostMenuFrame(renderFrame);
}

} // namespace bmsx
