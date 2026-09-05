#pragma once

#include "machine/cpu/cpu.h"
#include "machine/runtime/save_machine_state.h"

namespace bmsx {

class Runtime;

struct RuntimeSaveState {
	RuntimeSaveMachineState machineState;
	CpuRuntimeState cpuState;
	bool pendingEntryCall = false;
};

// Storage is consumed; callers reusing a capture transfer its ownership with a move.
RuntimeSaveState captureRuntimeSaveState(Runtime& runtime, RuntimeSaveState storage = {});
enum class RuntimeRestoreOrigin { ExternalLoad, HistorySeek };
void applyRuntimeSaveState(Runtime& runtime, const RuntimeSaveState& state, RuntimeRestoreOrigin origin = RuntimeRestoreOrigin::ExternalLoad);

} // namespace bmsx
