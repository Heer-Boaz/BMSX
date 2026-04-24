#pragma once

#include "machine/cpu/cpu.h"
#include "machine/firmware/api.h"
#include "machine/runtime/machine_state.h"
#include "machine/runtime/render/state.h"
#include "machine/runtime/game/view_state.h"

#include <utility>

namespace bmsx {

class Runtime;

struct RuntimeResumeSnapshot {
	RuntimeMachineState machineState;
	std::vector<std::pair<Value, Value>> globals;
	RuntimeStorageState storageState;
	GameViewState gameViewState;
	RuntimeRenderState renderState;
	uint32_t randomSeed = 0;
	bool pendingEntryCall = false;
};

RuntimeResumeSnapshot captureRuntimeResumeSnapshot(const Runtime& runtime);
void applyRuntimeResumeSnapshot(Runtime& runtime, const RuntimeResumeSnapshot& snapshot);

} // namespace bmsx
