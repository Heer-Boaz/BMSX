#pragma once

#include "common/primitives.h"
#include "machine/runtime/frame/state.h"

namespace bmsx {

class Runtime;

class FrameLoopState {
public:
	void reset();
	void resetFrameState(Runtime& runtime);
	void beginFrameState(Runtime& runtime);
	bool tickUpdate(Runtime& runtime);
	void abandonFrameState(Runtime& runtime);

	FrameState frameState;
	bool frameActive = false;
	f64 frameDeltaMs = 0.0;
	f64 currentTimeSeconds = 0.0;

private:
	void runUpdatePhase(Runtime& runtime);
	void finalizeUpdateSlice(Runtime& runtime);
};

} // namespace bmsx
