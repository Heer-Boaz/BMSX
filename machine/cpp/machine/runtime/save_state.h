#pragma once

#include "machine/cpu/cpu.h"
#include "machine/runtime/save_machine_state.h"

namespace bmsx {

class Runtime;

struct RuntimeCheckpointState {
	RuntimeSaveMachineState machineState;
	CpuRuntimeState cpuState;
	bool pendingEntryCall = false;
};

struct RuntimeSaveState : RuntimeCheckpointState {
	std::vector<u8> ram;
};

// Storage is consumed; callers reusing a capture transfer its ownership with a move.
RuntimeSaveState captureRuntimeSaveState(Runtime& runtime, RuntimeSaveState storage = {});
enum class RuntimeRestoreOrigin { ExternalLoad, HistorySeek };
void applyRuntimeSaveState(Runtime& runtime, const RuntimeSaveState& state);
void captureRuntimeCheckpointState(Runtime& runtime, RuntimeCheckpointState& state);
// The caller has installed main RAM, and owns any retained history.
void applyRuntimeCheckpointState(Runtime& runtime, const RuntimeCheckpointState& state, RuntimeRestoreOrigin origin);

} // namespace bmsx
