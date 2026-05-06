#pragma once

#include "machine/cpu/cpu.h"
#include "render/runtime/state.h"
#include "machine/runtime/save_machine_state.h"

namespace bmsx {

class Runtime;

struct RuntimeSaveState {
	RuntimeSaveMachineState machineState;
	CpuRuntimeState cpuState;
	RuntimeRenderState renderState;
	bool systemProgramActive = false;
	bool luaInitialized = false;
	bool runtimeFailed = false;
	uint32_t randomSeed = 0;
	bool pendingEntryCall = false;
};

RuntimeSaveState captureRuntimeSaveState(Runtime& runtime);
void applyRuntimeSaveState(Runtime& runtime, const RuntimeSaveState& state);

} // namespace bmsx
