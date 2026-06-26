#pragma once

#include "machine/cpu/cpu.h"
#include "machine/runtime/save_state.h"
#include "machine/runtime/machine_state.h"

#include <utility>
#include <vector>

namespace bmsx {

class Runtime;

struct RuntimeResumeSnapshot {
	RuntimeMachineState machineState;
	std::vector<std::pair<Value, Value>> globals;
	bool pendingEntryCall = false;
};

RuntimeResumeSnapshot captureRuntimeResumeSnapshot(const Runtime& runtime);
void applyRuntimeResumeSnapshot(Runtime& runtime, const RuntimeResumeSnapshot& snapshot);

} // namespace bmsx
