#include "machine/runtime/save_machine_state.h"

#include "machine/runtime/runtime.h"
#include "machine/save_state.h"

namespace bmsx {

RuntimeSaveMachineState captureRuntimeSaveMachineState(Runtime& runtime) {
	RuntimeSaveMachineState state;
	state.machine = captureMachineSaveState(runtime.machine);
	state.psxGpuDisplayModeWord = state.machine.gxGpu.presentDisplayModeWord;
	state.frameScheduler = runtime.frameScheduler.captureState();
	state.vblank = runtime.vblank.capture(runtime);
	return state;
}

void applyRuntimeSaveMachineState(Runtime& runtime, const RuntimeSaveMachineState& state) {
	runtime.applyPublishedPsxGpuDisplayTiming(
		state.machine.gxGpu.presentDisplayModeWord,
		state.machine.gxGpu.presentVerticalDisplayRangeWord
	);
	runtime.vblank.restore(runtime, state.vblank);
	restoreMachineSaveState(runtime.machine, state.machine);
	runtime.frameScheduler.restoreState(state.frameScheduler);
}

} // namespace bmsx
