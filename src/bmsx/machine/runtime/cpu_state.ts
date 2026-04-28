import type { CpuRuntimeState } from '../cpu/cpu';
import { Runtime } from './runtime';

// disable-next-line single_line_method_pattern -- runtime save-state API keeps CPU/module-cache coupling out of callers.
export function captureRuntimeCpuState(): CpuRuntimeState {
	const runtime = Runtime.instance;
	return runtime.machine.cpu.captureRuntimeState(runtime.moduleCache);
}

// disable-next-line single_line_method_pattern -- runtime save-state API keeps CPU/module-cache coupling out of callers.
export function applyRuntimeCpuState(state: CpuRuntimeState): void {
	const runtime = Runtime.instance;
	runtime.machine.cpu.restoreRuntimeState(state, runtime.moduleCache);
}
