#pragma once

#include "core/types.h"

namespace bmsx {

class Runtime;

class RuntimeFrameLoopState {
public:
	void runHostFrame(Runtime& runtime, f64 deltaTime, bool platformPaused, bool skipRender);
};

} // namespace bmsx
