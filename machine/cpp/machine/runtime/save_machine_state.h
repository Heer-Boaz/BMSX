#pragma once

#include "machine/save_state.h"
#include "machine/scheduler/frame.h"
#include <cstdint>

namespace bmsx {

class Runtime;

struct RuntimeSaveMachineState {
	MachineSaveState machine;
	FrameSchedulerStateSnapshot frameScheduler;
	i64 schedulerNowCycles = 0;
};

RuntimeSaveMachineState captureRuntimeSaveMachineState(Runtime& runtime);
void applyRuntimeSaveMachineState(Runtime& runtime, const RuntimeSaveMachineState& state);

} // namespace bmsx
