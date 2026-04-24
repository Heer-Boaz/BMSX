import type { CpuRuntimeState } from '../cpu/cpu';
import type { Runtime } from './runtime';

export function captureRuntimeCpuState(runtime: Runtime): CpuRuntimeState {
	return runtime.machine.cpu.captureRuntimeState(runtime.moduleCache);
}

export function applyRuntimeCpuState(runtime: Runtime, state: CpuRuntimeState): void {
	runtime.machine.cpu.restoreRuntimeState(state, runtime.moduleCache);
}
