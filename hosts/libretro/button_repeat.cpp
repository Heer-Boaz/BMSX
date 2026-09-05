#include "button_repeat.h"

namespace bmsx {
namespace {
constexpr i32 INITIAL_REPEAT_DELAY_FRAMES = 15;
constexpr i32 REPEAT_INTERVAL_FRAMES = 4;
}

void ButtonRepeat::reset() {
	active = false;
	nextRepeatAtMs = 0;
	lastFrameEvaluated = -1;
	lastResult = false;
}
bool ButtonRepeat::update(bool pressed, bool justPressed, f64 pressedAtMs, f64 now, f64 frameDurationMs, i64 frameId) {
	if (lastFrameEvaluated == frameId) return lastResult;
	lastFrameEvaluated = frameId;
	lastResult = justPressed;
	if (!pressed) {
		active = false;
		nextRepeatAtMs = 0;
	} else {
		if (justPressed || !active) {
			active = true;
			nextRepeatAtMs = pressedAtMs + INITIAL_REPEAT_DELAY_FRAMES * frameDurationMs;
		}
		if (!justPressed && now >= nextRepeatAtMs) {
			nextRepeatAtMs += REPEAT_INTERVAL_FRAMES * frameDurationMs;
			lastResult = true;
		}
	}
	return lastResult;
}
} // namespace bmsx
