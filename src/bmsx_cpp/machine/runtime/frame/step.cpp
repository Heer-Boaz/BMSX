#include "machine/runtime/frame/step.h"

#include "machine/runtime/runtime.h"

namespace bmsx {

void runRuntimeFrameStepInto(RuntimeFrameStepResult& out, Runtime& runtime, f64 hostDeltaMs) {
	out.previousTickSequence = runtime.frameScheduler.lastTickSequence;
	runtime.frameScheduler.run(runtime, hostDeltaMs);
	out.tickSequence = runtime.frameScheduler.lastTickSequence;
	out.tickAdvanced = out.tickSequence != out.previousTickSequence;
}

} // namespace bmsx
