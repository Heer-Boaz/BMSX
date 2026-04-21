#include "render/test_pattern.h"

#include "render/gameview.h"

#include <cmath>

namespace bmsx {

namespace {

void setRect(RectBounds& rect, f32 left, f32 top, f32 right, f32 bottom) {
	rect.left = left;
	rect.top = top;
	rect.right = right;
	rect.bottom = bottom;
	rect.z = 0.0f;
}

} // namespace

void renderTestPattern(GameView& view, f64 totalTime) {
	const f32 t = static_cast<f32>(totalTime);
	const i32 w = static_cast<i32>(view.viewportSize.x);
	const i32 h = static_cast<i32>(view.viewportSize.y);
	RectBounds rect;

	for (i32 y = 0; y < h; y += 8) {
		const f32 intensity = static_cast<f32>(y) / static_cast<f32>(h);
		const Color bgColor{0.1f, 0.1f * intensity, 0.2f + 0.1f * intensity, 1.0f};
		setRect(rect, 0.0f, static_cast<f32>(y), static_cast<f32>(w), static_cast<f32>(y + 8));
		view.fillRectangle(rect, bgColor);
	}

	const f32 boxX = (w / 2.0f) + std::sin(t * 2.0f) * (w / 3.0f);
	const f32 boxY = (h / 2.0f) + std::cos(t * 1.5f) * (h / 4.0f);
	const f32 boxSize = 32.0f + std::sin(t * 3.0f) * 8.0f;

	const Color shadowColor{0.0f, 0.0f, 0.0f, 0.5f};
	setRect(rect, boxX - boxSize / 2 + 4, boxY - boxSize / 2 + 4, boxX + boxSize / 2 + 4, boxY + boxSize / 2 + 4);
	view.fillRectangle(rect, shadowColor);

	const Color boxColor{
		0.5f + 0.5f * std::sin(t * 2.0f),
		0.5f + 0.5f * std::sin(t * 2.0f + 2.0f),
		0.5f + 0.5f * std::sin(t * 2.0f + 4.0f),
		1.0f
	};
	setRect(rect, boxX - boxSize / 2, boxY - boxSize / 2, boxX + boxSize / 2, boxY + boxSize / 2);
	view.fillRectangle(rect, boxColor);

	view.drawRectangle(rect, Color::white());

	const f32 cornerSize = 16.0f;
	setRect(rect, 0.0f, 0.0f, cornerSize, cornerSize);
	view.fillRectangle(rect, Color::red());
	setRect(rect, static_cast<f32>(w) - cornerSize, 0.0f, static_cast<f32>(w), cornerSize);
	view.fillRectangle(rect, Color::green());
	setRect(rect, 0.0f, static_cast<f32>(h) - cornerSize, cornerSize, static_cast<f32>(h));
	view.fillRectangle(rect, Color::blue());
	const Color yellow{1.0f, 1.0f, 0.0f, 1.0f};
	setRect(rect, static_cast<f32>(w) - cornerSize, static_cast<f32>(h) - cornerSize, static_cast<f32>(w), static_cast<f32>(h));
	view.fillRectangle(rect, yellow);

	for (int i = 0; i < 8; i++) {
		const f32 angle = t + i * 0.8f;
		const f32 cx = w / 2.0f;
		const f32 cy = h / 2.0f;
		const f32 len = 40.0f + 20.0f * std::sin(t * 2.0f + i);
		const Color lineColor{1.0f, 1.0f, 1.0f, 0.3f + 0.2f * std::sin(t + i)};
		view.drawLine(
			static_cast<i32>(cx),
			static_cast<i32>(cy),
			static_cast<i32>(cx + std::cos(angle) * len),
			static_cast<i32>(cy + std::sin(angle) * len),
			lineColor
		);
	}

	const f32 textY = 20.0f;
	const f32 textX = 10.0f;
	for (int i = 0; i < 4; i++) {
		const f32 left = textX + i * 14.0f;
		setRect(rect, left, textY, left + 10.0f, textY + 12.0f);
		view.fillRectangle(rect, Color::white());
	}
}

} // namespace bmsx
