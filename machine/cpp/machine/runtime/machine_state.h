#pragma once

#include "machine/save_state.h"
#include "machine/runtime/frame/loop.h"
#include "machine/scheduler/frame.h"
#include <cstdint>

namespace bmsx {

class Runtime;

struct RuntimeMachineState {
	MachineState machine;
	FrameSchedulerStateSnapshot frameScheduler;
	FrameLoopStateSnapshot frameLoop;
	i64 schedulerNowCycles = 0;
};

RuntimeMachineState captureRuntimeMachineState(Runtime& runtime);
void applyRuntimeMachineState(Runtime& runtime, const RuntimeMachineState& state);

} // namespace bmsx
