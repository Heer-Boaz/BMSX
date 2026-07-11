#include "machine/runtime/machine_state.h"

#include "machine/runtime/runtime.h"
#include "machine/save_state.h"

namespace bmsx {

RuntimeMachineState captureRuntimeMachineState(const Runtime& runtime) {
	RuntimeMachineState state;
	state.psxGpuDisplayModeWord = runtime.timing.gpuDisplayModeWord;
	state.machine = captureMachineState(runtime.machine);
	state.frameScheduler = runtime.frameScheduler.captureState();
	state.vblank = runtime.vblank.capture(runtime);
	return state;
}

void applyRuntimeMachineState(Runtime& runtime, const RuntimeMachineState& state) {
	runtime.applyPsxGpuDisplayModeWord(state.psxGpuDisplayModeWord);
	runtime.vblank.restore(runtime, state.vblank);
	restoreMachineState(runtime.machine, state.machine);
	runtime.frameScheduler.restoreState(state.frameScheduler);
}

} // namespace bmsx
