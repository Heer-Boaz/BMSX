#pragma once

#include "machine/cpu/cpu.h"
#include "machine/firmware/api.h"
#include "render/runtime/state.h"
#include "machine/runtime/save_machine_state.h"
#include "machine/runtime/game/view_state.h"

namespace bmsx {

class Runtime;

struct RuntimeSaveState {
	RuntimeSaveMachineState machineState;
	CpuRuntimeState cpuState;
	RuntimeStorageState storageState;
	GameViewState gameViewState;
	RuntimeRenderState renderState;
	uint32_t randomSeed = 0;
	bool pendingEntryCall = false;
	bool runtimeFailed = false;
	bool luaInitialized = false;
	bool engineProgramActive = false;
};

RuntimeSaveState captureRuntimeSaveState(Runtime& runtime);
void applyRuntimeSaveState(Runtime& runtime, const RuntimeSaveState& state);

} // namespace bmsx
