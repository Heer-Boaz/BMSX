import type { CpuRuntimeState } from '../cpu/cpu';
import type { RuntimeSaveMachineState } from './save_machine_state';
import type { Runtime } from './runtime';
import { applyRuntimeSaveMachineState, captureRuntimeSaveMachineState } from './save_machine_state';

export type RuntimeSaveState = {
	machineState: RuntimeSaveMachineState;
	cpuState: CpuRuntimeState;
	pendingEntryCall: boolean;
};

export function captureRuntimeSaveState(runtime: Runtime): RuntimeSaveState {
	return {
		machineState: captureRuntimeSaveMachineState(runtime),
		cpuState: runtime.machine.cpu.captureRuntimeState(),
		pendingEntryCall: runtime.pendingCall === 'entry',
	};
}

export function applyRuntimeSaveState(runtime: Runtime, state: RuntimeSaveState): void {
	applyRuntimeSaveMachineState(runtime, state.machineState);
	runtime.machine.cpu.restoreRuntimeState(state.cpuState);
	runtime.pendingCall = state.pendingEntryCall ? 'entry' : null;
}
