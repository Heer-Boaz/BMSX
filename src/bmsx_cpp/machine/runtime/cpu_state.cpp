#include "machine/runtime/cpu_state.h"

#include "machine/runtime/runtime.h"

namespace bmsx {

// disable-next-line single_line_method_pattern -- runtime save-state API keeps CPU/module-cache coupling out of callers.
CpuRuntimeState captureRuntimeCpuState(const Runtime& runtime) {
	return runtime.machine.cpu.captureRuntimeState(runtime.m_moduleCache);
}

// disable-next-line single_line_method_pattern -- runtime save-state API keeps CPU/module-cache coupling out of callers.
void applyRuntimeCpuState(Runtime& runtime, const CpuRuntimeState& state) {
	runtime.machine.cpu.restoreRuntimeState(state, runtime.m_moduleCache);
}

} // namespace bmsx
