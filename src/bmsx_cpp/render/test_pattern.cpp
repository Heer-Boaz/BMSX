#include "render/test_pattern.h"

#include "render/gameview.h"

#include <cmath>

namespace bmsx {

void renderTestPattern(GameView& view, f64 totalTime) {
	const f32 t = static_cast<f32>(totalTime);
	const i32 w = static_cast<i32>(view.viewportSize.x);
	const i32 h = static_cast<i32>(view.viewportSize.y);

	for (i32 y = 0; y < h; y += 8) {
		const f32 intensity = static_cast<f32>(y) / static_cast<f32>(h);
		const Color bgColor{0.1f, 0.1f * intensity, 0.2f + 0.1f * intensity, 1.0f};
		view.fillRectangle({0.0f, static_cast<f32>(y), static_cast<f32>(w), static_cast<f32>(y + 8)}, bgColor);
	}

	const f32 boxX = (w / 2.0f) + std::sin(t * 2.0f) * (w / 3.0f);
	const f32 boxY = (h / 2.0f) + std::cos(t * 1.5f) * (h / 4.0f);
	const f32 boxSize = 32.0f + std::sin(t * 3.0f) * 8.0f;

	view.fillRectangle(
		{boxX - boxSize / 2 + 4, boxY - boxSize / 2 + 4, boxX + boxSize / 2 + 4, boxY + boxSize / 2 + 4},
		{0.0f, 0.0f, 0.0f, 0.5f}
	);

	const Color boxColor{
		0.5f + 0.5f * std::sin(t * 2.0f),
		0.5f + 0.5f * std::sin(t * 2.0f + 2.0f),
		0.5f + 0.5f * std::sin(t * 2.0f + 4.0f),
		1.0f
	};
	view.fillRectangle(
		{boxX - boxSize / 2, boxY - boxSize / 2, boxX + boxSize / 2, boxY + boxSize / 2},
		boxColor
	);

	view.drawRectangle(
		{boxX - boxSize / 2, boxY - boxSize / 2, boxX + boxSize / 2, boxY + boxSize / 2},
		Color::white()
	);

	const f32 cornerSize = 16.0f;
	view.fillRectangle({0, 0, cornerSize, cornerSize}, Color::red());
	view.fillRectangle({static_cast<f32>(w) - cornerSize, 0, static_cast<f32>(w), cornerSize}, Color::green());
	view.fillRectangle({0, static_cast<f32>(h) - cornerSize, cornerSize, static_cast<f32>(h)}, Color::blue());
	view.fillRectangle({static_cast<f32>(w) - cornerSize, static_cast<f32>(h) - cornerSize, static_cast<f32>(w), static_cast<f32>(h)}, {1.0f, 1.0f, 0.0f, 1.0f});

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
		view.fillRectangle(
			{textX + i * 14.0f, textY, textX + i * 14.0f + 10.0f, textY + 12.0f},
			Color::white()
		);
	}
}

} // namespace bmsx
