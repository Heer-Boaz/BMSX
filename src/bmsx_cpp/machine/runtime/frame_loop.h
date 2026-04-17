#pragma once

#include "core/primitives.h"
#include "machine/runtime/frame_state.h"

namespace bmsx {

class Runtime;

class FrameLoopState {
public:
	void reset();
	void resetFrameState(Runtime& runtime);
	void beginFrameState(Runtime& runtime);
	bool tickUpdate(Runtime& runtime);
	bool hasActiveTick(const Runtime& runtime) const;
	void abandonFrameState(Runtime& runtime);
	void runHostFrame(Runtime& runtime, f64 deltaTime, bool platformPaused, bool skipRender);

	FrameState frameState;
	bool frameActive = false;
	f64 frameDeltaMs = 0.0;

private:
	void executeUpdateCallback(Runtime& runtime);
	void finalizeUpdateSlice(Runtime& runtime);
};

} // namespace bmsx
