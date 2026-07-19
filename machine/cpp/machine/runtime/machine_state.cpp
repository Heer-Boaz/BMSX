#include "machine/runtime/machine_state.h"

#include "machine/runtime/runtime.h"
#include "machine/save_state.h"

namespace bmsx {

RuntimeMachineState captureRuntimeMachineState(Runtime& runtime) {
	RuntimeMachineState state;
	state.machine = captureMachineState(runtime.machine);
	state.frameScheduler = runtime.frameScheduler.captureState();
	state.frameLoop = runtime.frameLoop.captureState();
	state.schedulerNowCycles = runtime.machine.scheduler.currentNowCycles();
	return state;
}

void applyRuntimeMachineState(Runtime& runtime, const RuntimeMachineState& state) {
	runtime.frameScheduler.reset();
	runtime.frameLoop.reset();
	runtime.machine.scheduler.reset();
	runtime.machine.scheduler.setNowCycles(state.schedulerNowCycles);
	runtime.vblank.prepareRestore();
	restoreMachineState(runtime.machine, state.machine);
	runtime.applyPublishedGxGpuPcrtcTiming(runtime.machine.gxGpu.readDeviceOutput().pcrtcTiming);
	runtime.frameScheduler.restoreState(state.frameScheduler);
	runtime.frameLoop.restoreState(state.frameLoop);
}

} // namespace bmsx
