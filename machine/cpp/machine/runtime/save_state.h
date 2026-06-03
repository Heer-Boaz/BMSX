#pragma once

#include "machine/cpu/cpu.h"
#include "machine/runtime/save_machine_state.h"

namespace bmsx {

class Runtime;

struct RuntimeSaveState {
	RuntimeSaveMachineState machineState;
	CpuRuntimeState cpuState;
	bool systemProgramActive = false;
	bool luaInitialized = false;
	bool luaRuntimeFailed = false;
	uint32_t randomSeed = 0;
	bool pendingEntryCall = false;
};

RuntimeSaveState captureRuntimeSaveState(Runtime& runtime);
void applyRuntimeSaveState(Runtime& runtime, const RuntimeSaveState& state);

} // namespace bmsx
