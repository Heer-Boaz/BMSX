#pragma once

#include "machine/save_state.h"
#include "machine/scheduler/frame.h"
#include "machine/runtime/vblank.h"
#include <cstdint>

namespace bmsx {

class Runtime;

struct RuntimeMachineState {
	uint32_t machineRegionWord;
	MachineState machine;
	FrameSchedulerStateSnapshot frameScheduler;
	RuntimeVblankSnapshot vblank;
};

RuntimeMachineState captureRuntimeMachineState(const Runtime& runtime);
void applyRuntimeMachineState(Runtime& runtime, const RuntimeMachineState& state);

} // namespace bmsx
