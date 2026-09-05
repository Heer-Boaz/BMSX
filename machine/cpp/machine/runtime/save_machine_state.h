#pragma once

#include "machine/save_state.h"
#include "machine/runtime/frame/loop.h"
#include "machine/scheduler/frame.h"
#include <cstdint>

namespace bmsx {

class Runtime;

struct RuntimeSaveMachineState {
	MachineSaveState machine;
	FrameSchedulerStateSnapshot frameScheduler;
	FrameLoopStateSnapshot frameLoop;
	i64 schedulerNowCycles = 0;
};

RuntimeSaveMachineState captureRuntimeSaveMachineState(Runtime& runtime, RuntimeSaveMachineState storage = {});
void applyRuntimeSaveMachineState(Runtime& runtime, const RuntimeSaveMachineState& state);

} // namespace bmsx
