#include "machine/runtime/machine_state.h"

#include "machine/runtime/runtime.h"

namespace bmsx {

RuntimeMachineState captureRuntimeMachineState(const Runtime& runtime) {
	RuntimeMachineState state;
	state.machine = runtime.machine().captureState();
	state.frameScheduler = runtime.frameScheduler.captureState();
	state.vblank = runtime.vblank.capture();
	return state;
}

void applyRuntimeMachineState(Runtime& runtime, const RuntimeMachineState& state) {
	runtime.machine().restoreState(state.machine);
	runtime.frameScheduler.restoreState(state.frameScheduler);
	runtime.vblank.restore(state.vblank);
}

} // namespace bmsx
