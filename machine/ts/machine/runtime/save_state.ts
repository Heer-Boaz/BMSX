import type { CpuRuntimeState } from '../cpu/cpu';
import type { RuntimeSaveMachineState } from './save_machine_state';
import type { Runtime } from './runtime';
import { applyRuntimeSaveMachineState, captureRuntimeSaveMachineState } from './save_machine_state';

export type RuntimeSaveState = {
	machineState: RuntimeSaveMachineState;
	cpuState: CpuRuntimeState;
	pendingEntryCall: boolean;
};

export const enum RuntimeRestoreOrigin { ExternalLoad, HistorySeek }

/** Storage, when supplied, is consumed from an exclusive capture of this runtime/media. */
export function captureRuntimeSaveState(runtime: Runtime, storage?: RuntimeSaveState): RuntimeSaveState {
	return {
		machineState: captureRuntimeSaveMachineState(runtime, storage?.machineState),
		cpuState: runtime.machine.cpu.captureRuntimeState(storage?.cpuState.snapshot),
		pendingEntryCall: runtime.pendingCall === 'entry',
	};
}

export function applyRuntimeSaveState(runtime: Runtime, state: RuntimeSaveState, origin: RuntimeRestoreOrigin = RuntimeRestoreOrigin.ExternalLoad): void {
	if (origin === RuntimeRestoreOrigin.ExternalLoad) runtime.history.stop();
	applyRuntimeSaveMachineState(runtime, state.machineState);
	runtime.machine.cpu.restoreRuntimeState(state.cpuState);
	runtime.readCompletionValues();
	runtime.pendingCall = state.pendingEntryCall ? 'entry' : null;
	runtime.onStateRestored?.();
}
