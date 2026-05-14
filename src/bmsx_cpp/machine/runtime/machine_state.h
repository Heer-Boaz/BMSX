#pragma once

#include "machine/save_state.h"
#include "machine/scheduler/frame.h"
#include "machine/runtime/vblank.h"

namespace bmsx {

class Runtime;

struct RuntimeMachineState {
	MachineState machine;
	FrameSchedulerStateSnapshot frameScheduler;
	RuntimeVblankSnapshot vblank;
};

RuntimeMachineState captureRuntimeMachineState(const Runtime& runtime);
void applyRuntimeMachineState(Runtime& runtime, const RuntimeMachineState& state);

} // namespace bmsx
