#include "machine/runtime/frame/step.h"

#include "machine/runtime/runtime.h"

namespace bmsx {

RuntimeFrameStepResult runRuntimeFrameStep(Runtime& runtime, f64 hostDeltaMs) {
	RuntimeFrameStepResult result;
	result.previousTickSequence = runtime.frameScheduler.lastTickSequence;
	runtime.frameScheduler.run(runtime, hostDeltaMs);
	result.tickSequence = runtime.frameScheduler.lastTickSequence;
	result.tickAdvanced = result.tickSequence != result.previousTickSequence;
	return result;
}

} // namespace bmsx
