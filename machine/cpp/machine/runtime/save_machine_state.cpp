#include "machine/runtime/save_machine_state.h"

#include "machine/runtime/runtime.h"
#include "machine/save_state.h"

namespace bmsx {

RuntimeSaveMachineState captureRuntimeSaveMachineState(Runtime& runtime, RuntimeSaveMachineState storage) {
	storage.machine = captureMachineSaveState(runtime.machine, std::move(storage.machine));
	storage.frameScheduler = runtime.frameScheduler.captureState();
	storage.frameLoop = runtime.frameLoop.captureState();
	storage.schedulerNowCycles = runtime.machine.scheduler.currentNowCycles();
	return storage;
}

void applyRuntimeSaveMachineState(Runtime& runtime, const RuntimeSaveMachineState& state) {
	runtime.cpuExecution.reset();
	runtime.frameScheduler.reset();
	runtime.frameLoop.reset();
	runtime.machine.scheduler.reset();
	runtime.machine.scheduler.setNowCycles(state.schedulerNowCycles);
	runtime.vblank.prepareRestore();
	restoreMachineSaveState(runtime.machine, state.machine);
	runtime.applyPublishedGxGpuPcrtcTiming(runtime.machine.gxGpu.readDeviceOutput().pcrtcTiming);
	runtime.frameScheduler.restoreState(state.frameScheduler);
	runtime.frameLoop.restoreState(state.frameLoop);
}

} // namespace bmsx
