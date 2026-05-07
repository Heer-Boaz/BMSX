#include "render/test_pattern.h"

#include "render/gameview.h"
#include "render/host_overlay/commands.h"
#include "render/host_overlay/overlay_queue.h"

#include <array>
#include <cmath>

namespace bmsx {

namespace {

constexpr size_t TestPatternCommandCapacity = 256;
constexpr size_t TestPatternRectCapacity = 224;
constexpr size_t TestPatternPolyCapacity = 8;

std::array<Host2DKind, TestPatternCommandCapacity> s_commandKinds;
std::array<Host2DRef, TestPatternCommandCapacity> s_commandRefs;
std::array<RectRenderSubmission, TestPatternRectCapacity> s_rects;
std::array<PolyRenderSubmission, TestPatternPolyCapacity> s_polys;
size_t s_commandCount = 0;
size_t s_rectCount = 0;
size_t s_polyCount = 0;

void setRect(RectBounds& rect, f32 left, f32 top, f32 right, f32 bottom) {
	rect.left = left;
	rect.top = top;
	rect.right = right;
	rect.bottom = bottom;
	rect.z = 0.0f;
}

RectRenderSubmission& nextRect() {
	RectRenderSubmission& submission = s_rects[s_rectCount];
	s_rectCount += 1;
	return submission;
}

PolyRenderSubmission& nextPoly() {
	PolyRenderSubmission& submission = s_polys[s_polyCount];
	s_polyCount += 1;
	return submission;
}

void queueCommand(Host2DKind kind, Host2DRef ref) {
	s_commandKinds[s_commandCount] = kind;
	s_commandRefs[s_commandCount] = ref;
	s_commandCount += 1;
}

void queueRect(const RectBounds& rect, RectRenderSubmission::Kind kind, u32 color) {
	RectRenderSubmission& submission = nextRect();
	submission.kind = kind;
	submission.layer = RenderLayer::World;
	submission.area = rect;
	submission.color = color;
	queueCommand(Host2DKind::Rect, &submission);
}

} // namespace

void renderTestPattern(GameView& view, f64 totalTime) {
	s_commandCount = 0;
	s_rectCount = 0;
	s_polyCount = 0;
	const f32 t = static_cast<f32>(totalTime);
	const i32 w = static_cast<i32>(view.viewportSize.x);
	const i32 h = static_cast<i32>(view.viewportSize.y);
	const auto fillKind = RectRenderSubmission::Kind::Fill;
	RectBounds rect;

	for (i32 y = 0; y < h; y += 8) {
		const f32 intensity = static_cast<f32>(y) / static_cast<f32>(h);
		setRect(rect, 0.0f, static_cast<f32>(y), static_cast<f32>(w), static_cast<f32>(y + 8));
		const u32 gradientColor = 0xff000000u
			| (static_cast<u32>(0.1f * 255.0f) << 16u)
			| (static_cast<u32>(0.1f * intensity * 255.0f) << 8u)
			| static_cast<u32>((0.2f + 0.1f * intensity) * 255.0f);
		queueRect(rect, fillKind, gradientColor);
	}

	const f32 boxX = (w / 2.0f) + std::sin(t * 2.0f) * (w / 3.0f);
	const f32 boxY = (h / 2.0f) + std::cos(t * 1.5f) * (h / 4.0f);
	const f32 boxSize = 32.0f + std::sin(t * 3.0f) * 8.0f;

	setRect(rect, boxX - boxSize / 2 + 4, boxY - boxSize / 2 + 4, boxX + boxSize / 2 + 4, boxY + boxSize / 2 + 4);
	queueRect(rect, fillKind, 0x7f000000u);

	const u32 boxColor = 0xff000000u
		| (static_cast<u32>((0.5f + 0.5f * std::sin(t * 2.0f)) * 255.0f) << 16u)
		| (static_cast<u32>((0.5f + 0.5f * std::sin(t * 2.0f + 2.0f)) * 255.0f) << 8u)
		| static_cast<u32>((0.5f + 0.5f * std::sin(t * 2.0f + 4.0f)) * 255.0f);
	setRect(rect, boxX - boxSize / 2, boxY - boxSize / 2, boxX + boxSize / 2, boxY + boxSize / 2);
	queueRect(rect, fillKind, boxColor);
	queueRect(rect, RectRenderSubmission::Kind::Rect, 0xffffffffu);

	const f32 cornerSize = 16.0f;
	setRect(rect, 0.0f, 0.0f, cornerSize, cornerSize);
	queueRect(rect, fillKind, 0xffff0000u);
	setRect(rect, static_cast<f32>(w) - cornerSize, 0.0f, static_cast<f32>(w), cornerSize);
	queueRect(rect, fillKind, 0xff00ff00u);
	setRect(rect, 0.0f, static_cast<f32>(h) - cornerSize, cornerSize, static_cast<f32>(h));
	queueRect(rect, fillKind, 0xff0000ffu);
	setRect(rect, static_cast<f32>(w) - cornerSize, static_cast<f32>(h) - cornerSize, static_cast<f32>(w), static_cast<f32>(h));
	queueRect(rect, fillKind, 0xffffff00u);

	for (i32 index = 0; index < 8; index += 1) {
		const f32 angle = t + static_cast<f32>(index) * 0.8f;
		const f32 cx = w / 2.0f;
		const f32 cy = h / 2.0f;
		const f32 len = 40.0f + 20.0f * std::sin(t * 2.0f + static_cast<f32>(index));
		PolyRenderSubmission& line = nextPoly();
		line.points.resize(4);
		line.points[0] = cx;
		line.points[1] = cy;
		line.points[2] = cx + std::cos(angle) * len;
		line.points[3] = cy + std::sin(angle) * len;
		line.z = 0.0f;
		line.color = (static_cast<u32>((0.3f + 0.2f * std::sin(t + static_cast<f32>(index))) * 255.0f) << 24u) | 0x00ffffffu;
		line.thickness = 1.0f;
		line.layer = RenderLayer::World;
		queueCommand(Host2DKind::Poly, &line);
	}

	const f32 textY = 20.0f;
	const f32 textX = 10.0f;
	for (i32 index = 0; index < 4; index += 1) {
		const f32 left = textX + static_cast<f32>(index) * 14.0f;
		setRect(rect, left, textY, left + 10.0f, textY + 12.0f);
		queueRect(rect, fillKind, 0xffffffffu);
	}

	HostOverlayFrame frame;
	frame.width = w;
	frame.height = h;
	frame.logicalWidth = w;
	frame.logicalHeight = h;
	frame.renderWidth = w;
	frame.renderHeight = h;
	frame.commandKinds = s_commandKinds.data();
	frame.commandRefs = s_commandRefs.data();
	frame.commandCount = s_commandCount;
	publishOverlayFrame(frame);
}

} // namespace bmsx
