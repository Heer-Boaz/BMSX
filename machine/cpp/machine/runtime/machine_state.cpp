#include "machine/runtime/machine_state.h"

#include "machine/runtime/runtime.h"
#include "machine/save_state.h"

namespace bmsx {

RuntimeMachineState captureRuntimeMachineState(Runtime& runtime) {
	RuntimeMachineState state;
	state.machine = captureMachineState(runtime.machine);
	state.psxGpuDisplayModeWord = state.machine.gxGpu.presentDisplayModeWord;
	state.frameScheduler = runtime.frameScheduler.captureState();
	state.vblank = runtime.vblank.capture(runtime);
	return state;
}

void applyRuntimeMachineState(Runtime& runtime, const RuntimeMachineState& state) {
	runtime.applyPublishedPsxGpuDisplayTiming(
		state.machine.gxGpu.presentDisplayModeWord,
		state.machine.gxGpu.presentVerticalDisplayRangeWord
	);
	runtime.vblank.restore(runtime, state.vblank);
	restoreMachineState(runtime.machine, state.machine);
	runtime.frameScheduler.restoreState(state.frameScheduler);
}

} // namespace bmsx
