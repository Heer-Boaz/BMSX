#include "machine/runtime/machine_state.h"

#include "machine/runtime/runtime.h"
#include "machine/save_state.h"

namespace bmsx {

RuntimeMachineState captureRuntimeMachineState(const Runtime& runtime) {
	RuntimeMachineState state;
	state.machineRegionWord = runtime.timing.regionWord;
	state.machine = captureMachineState(runtime.machine);
	state.frameScheduler = runtime.frameScheduler.captureState();
	state.vblank = runtime.vblank.capture(runtime);
	return state;
}

void applyRuntimeMachineState(Runtime& runtime, const RuntimeMachineState& state) {
	runtime.applyMachineRegionWord(state.machineRegionWord);
	restoreMachineState(runtime.machine, state.machine);
	runtime.frameScheduler.restoreState(state.frameScheduler);
	runtime.vblank.restore(runtime, state.vblank);
}

} // namespace bmsx
