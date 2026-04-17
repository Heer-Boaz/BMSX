#pragma once

#include "core/types.h"
#include "machine/runtime/runtime_frame_state.h"

namespace bmsx {

class Runtime;

class RuntimeFrameLoopState {
public:
	void reset();
	void runHostFrame(Runtime& runtime, f64 deltaTime, bool platformPaused, bool skipRender);

	FrameState frameState;
	bool frameActive = false;
	f64 frameDeltaMs = 0.0;
};

} // namespace bmsx
