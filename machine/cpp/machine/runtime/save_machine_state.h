#pragma once

#include "machine/save_state.h"
#include "machine/scheduler/frame.h"
#include "machine/runtime/vblank.h"
#include <cstdint>

namespace bmsx {

class Runtime;

struct RuntimeSaveMachineState {
	uint32_t psxGpuDisplayModeWord;
	MachineSaveState machine;
	FrameSchedulerStateSnapshot frameScheduler;
	RuntimeVblankSnapshot vblank;
};

RuntimeSaveMachineState captureRuntimeSaveMachineState(const Runtime& runtime);
void applyRuntimeSaveMachineState(Runtime& runtime, const RuntimeSaveMachineState& state);

} // namespace bmsx
