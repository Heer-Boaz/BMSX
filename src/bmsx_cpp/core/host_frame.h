#pragma once

#include "core/primitives.h"

namespace bmsx {

class EngineCore;
class MicrotaskQueue;
class Runtime;

void runRuntimeHostFrame(
	EngineCore& engine,
	Runtime& runtime,
	MicrotaskQueue& microtasks,
	f64 deltaTime,
	bool platformPaused,
	bool skipRender
);

} // namespace bmsx
