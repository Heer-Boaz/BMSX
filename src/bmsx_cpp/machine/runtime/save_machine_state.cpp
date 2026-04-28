#include "machine/runtime/save_machine_state.h"

#include "machine/runtime/runtime.h"

namespace bmsx {

RuntimeSaveMachineState captureRuntimeSaveMachineState(const Runtime& runtime) {
	RuntimeSaveMachineState state;
	state.machine = runtime.machine().captureSaveState();
	state.frameScheduler = runtime.frameScheduler.captureState();
	state.vblank = runtime.vblank.capture(runtime);
	return state;
}

void applyRuntimeSaveMachineState(Runtime& runtime, const RuntimeSaveMachineState& state) {
	runtime.machine().restoreSaveState(state.machine);
	runtime.frameScheduler.restoreState(state.frameScheduler);
	runtime.vblank.restore(runtime, state.vblank);
}

} // namespace bmsx
