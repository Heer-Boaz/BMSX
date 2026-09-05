#pragma once
#include "common/primitives.h"

namespace bmsx {

class ButtonRepeat {
public:
	void reset();
	bool update(bool pressed, bool justPressed, f64 pressedAtMs, f64 now, f64 frameDurationMs, i64 frameId);
private:
	bool active = false;
	f64 nextRepeatAtMs = 0;
	i64 lastFrameEvaluated = -1;
	bool lastResult = false;
};

} // namespace bmsx
