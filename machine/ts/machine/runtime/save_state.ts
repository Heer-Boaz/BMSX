import type { CpuRuntimeState } from '../cpu/cpu';
import { CpuSnapshot } from '../cpu/snapshot';
import type { RuntimeSaveMachineState } from './save_machine_state';
import type { Runtime } from './runtime';
import { applyRuntimeSaveMachineState, captureRuntimeSaveMachineState } from './save_machine_state';

export type RuntimeSaveState = {
	machineState: RuntimeSaveMachineState;
	cpuState: CpuRuntimeState;
	pendingEntryCall: boolean;
};

export const enum RuntimeRestoreOrigin { ExternalLoad, HistorySeek }

export function captureRuntimeSaveState(runtime: Runtime, snapshot = new CpuSnapshot()): RuntimeSaveState {
	return {
		machineState: captureRuntimeSaveMachineState(runtime),
		cpuState: runtime.machine.cpu.captureRuntimeState(snapshot),
		pendingEntryCall: runtime.pendingCall === 'entry',
	};
}

export function applyRuntimeSaveState(runtime: Runtime, state: RuntimeSaveState, origin: RuntimeRestoreOrigin = RuntimeRestoreOrigin.ExternalLoad): void {
	if (origin === RuntimeRestoreOrigin.ExternalLoad) runtime.history.stop();
	applyRuntimeSaveMachineState(runtime, state.machineState);
	runtime.machine.cpu.restoreRuntimeState(state.cpuState);
	runtime.readCompletionValues();
	runtime.pendingCall = state.pendingEntryCall ? 'entry' : null;
}
