#pragma once

#include "common/primitives.h"

namespace bmsx {

class Runtime;

struct RuntimeFrameStepResult {
	i64 previousTickSequence = 0;
	i64 tickSequence = 0;
	bool tickAdvanced = false;
};

RuntimeFrameStepResult runRuntimeFrameStep(Runtime& runtime, f64 hostDeltaMs);

} // namespace bmsx
