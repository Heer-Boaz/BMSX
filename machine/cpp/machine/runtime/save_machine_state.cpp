#include "machine/runtime/save_machine_state.h"

#include "machine/runtime/runtime.h"
#include "machine/save_state.h"

namespace bmsx {

RuntimeSaveMachineState captureRuntimeSaveMachineState(const Runtime& runtime) {
	RuntimeSaveMachineState state;
	state.psxGpuDisplayModeWord = runtime.timing.gpuDisplayModeWord;
	state.machine = captureMachineSaveState(runtime.machine);
	state.frameScheduler = runtime.frameScheduler.captureState();
	state.vblank = runtime.vblank.capture(runtime);
	return state;
}

void applyRuntimeSaveMachineState(Runtime& runtime, const RuntimeSaveMachineState& state) {
	runtime.applyPsxGpuDisplayModeWord(state.psxGpuDisplayModeWord);
	restoreMachineSaveState(runtime.machine, state.machine);
	runtime.frameScheduler.restoreState(state.frameScheduler);
	runtime.vblank.restore(runtime, state.vblank);
}

} // namespace bmsx
