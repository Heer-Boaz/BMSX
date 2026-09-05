#include "machine/runtime/save_state.h"

#include "machine/runtime/save_machine_state.h"
#include "machine/runtime/runtime.h"

namespace bmsx {

RuntimeSaveState captureRuntimeSaveState(Runtime& runtime, RuntimeSaveState storage) {
	storage.machineState = captureRuntimeSaveMachineState(runtime, std::move(storage.machineState));
	storage.cpuState = runtime.machine.cpu.captureRuntimeState(std::move(storage.cpuState.snapshot));
	storage.pendingEntryCall = runtime.m_pendingCall == Runtime::PendingCall::Entry;
	return storage;
}

void applyRuntimeSaveState(Runtime& runtime, const RuntimeSaveState& state, RuntimeRestoreOrigin origin) {
	if (origin == RuntimeRestoreOrigin::ExternalLoad) runtime.history.stop();
	applyRuntimeSaveMachineState(runtime, state.machineState);
	runtime.machine.cpu.restoreRuntimeState(state.cpuState);
	runtime.m_pendingCall = state.pendingEntryCall ? Runtime::PendingCall::Entry : Runtime::PendingCall::None;
}

} // namespace bmsx
