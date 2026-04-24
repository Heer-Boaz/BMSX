#include "machine/runtime/cpu_state.h"

#include "machine/runtime/runtime.h"

namespace bmsx {

CpuRuntimeState captureRuntimeCpuState(const Runtime& runtime) {
	return runtime.machine().cpu().captureRuntimeState(runtime.m_moduleCache);
}

void applyRuntimeCpuState(Runtime& runtime, const CpuRuntimeState& state) {
	runtime.machine().cpu().restoreRuntimeState(state, runtime.m_moduleCache);
}

} // namespace bmsx
