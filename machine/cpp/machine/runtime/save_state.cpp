#include "machine/runtime/save_state.h"

#include "machine/runtime/save_machine_state.h"
#include "machine/runtime/runtime.h"

#include <cstring>

namespace bmsx {

RuntimeSaveState captureRuntimeSaveState(Runtime& runtime, RuntimeSaveState storage) {
	captureRuntimeCheckpointState(runtime, storage);
	auto& memory = runtime.machine.memory;
	storage.ram.assign(memory.ramData(), memory.ramData() + memory.ramByteCount());
	return storage;
}

void captureRuntimeCheckpointState(Runtime& runtime, RuntimeCheckpointState& storage) {
	storage.machineState = captureRuntimeSaveMachineState(runtime, std::move(storage.machineState));
	storage.cpuState = runtime.machine.cpu.captureRuntimeState(std::move(storage.cpuState.completionValues));
	storage.pendingEntryCall = runtime.m_pendingCall == Runtime::PendingCall::Entry;
}

void applyRuntimeSaveState(Runtime& runtime, const RuntimeSaveState& state) {
	runtime.history.stop();
	std::memcpy(runtime.machine.memory.ramData(), state.ram.data(), state.ram.size());
	applyRuntimeCheckpointState(runtime, state, RuntimeRestoreOrigin::ExternalLoad);
}

void applyRuntimeCheckpointState(Runtime& runtime, const RuntimeCheckpointState& state, RuntimeRestoreOrigin origin) {
	applyRuntimeSaveMachineState(runtime, state.machineState);
	runtime.machine.cpu.restoreRuntimeState(state.cpuState);
	// The CPU's restored GP0 write wait is observable only after CPU restore.
	runtime.machine.gxGpu.dependencyStateChanged();
	runtime.m_pendingCall = state.pendingEntryCall ? Runtime::PendingCall::Entry : Runtime::PendingCall::None;
	if (runtime.onStateRestored) runtime.onStateRestored(origin);
}

} // namespace bmsx
