#pragma once

#include "machine/cpu/cpu.h"
#include "machine/firmware/api.h"
#include "machine/runtime/machine_state.h"
#include "render/runtime/state.h"

#include <utility>

namespace bmsx {

class Runtime;

struct RuntimeResumeSnapshot {
	RuntimeMachineState machineState;
	std::vector<std::pair<Value, Value>> globals;
	RuntimeStorageState storageState;
	RuntimeRenderState renderState;
	uint32_t randomSeed = 0;
	bool pendingEntryCall = false;
};

RuntimeResumeSnapshot captureRuntimeResumeSnapshot(const Runtime& runtime);
void applyRuntimeResumeSnapshot(Runtime& runtime, const RuntimeResumeSnapshot& snapshot);

} // namespace bmsx
