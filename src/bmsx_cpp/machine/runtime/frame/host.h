#pragma once

#include "core/primitives.h"

namespace bmsx {

class Runtime;

void runRuntimeHostFrame(Runtime& runtime, f64 deltaTime, bool platformPaused, bool skipRender);

} // namespace bmsx
