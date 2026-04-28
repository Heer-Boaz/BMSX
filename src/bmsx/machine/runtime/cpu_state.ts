import type { CpuRuntimeState } from '../cpu/cpu';
import type { Runtime } from './runtime';

// disable-next-line single_line_method_pattern -- runtime save-state API keeps CPU/module-cache coupling out of callers.
export function captureRuntimeCpuState(runtime: Runtime): CpuRuntimeState {
	return runtime.machine.cpu.captureRuntimeState(runtime.moduleCache);
}

// disable-next-line single_line_method_pattern -- runtime save-state API keeps CPU/module-cache coupling out of callers.
export function applyRuntimeCpuState(runtime: Runtime, state: CpuRuntimeState): void {
	runtime.machine.cpu.restoreRuntimeState(state, runtime.moduleCache);
}
