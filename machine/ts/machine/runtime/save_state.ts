import type { CpuRuntimeState } from '../cpu/cpu';
import type { RuntimeSaveMachineState } from './save_machine_state';
import type { Runtime } from './runtime';
import { applyRuntimeSaveMachineState, captureRuntimeSaveMachineState } from './save_machine_state';

export type RuntimeCheckpointState = {
	machineState: RuntimeSaveMachineState;
	cpuState: CpuRuntimeState;
	pendingEntryCall: boolean;
};

export type RuntimeSaveState = RuntimeCheckpointState & { ram: Uint8Array };

export const enum RuntimeRestoreOrigin { ExternalLoad, HistorySeek }

/** Storage, when supplied, is consumed from an exclusive capture of this runtime/media. */
export function captureRuntimeSaveState(runtime: Runtime, storage?: RuntimeSaveState): RuntimeSaveState {
	const state = captureRuntimeCheckpointState(runtime, storage);
	const ram = storage === undefined ? new Uint8Array(runtime.machine.memory.ramByteCount()) : storage.ram;
	ram.set(runtime.machine.memory.ramData());
	return { ...state, ram };
}

export function captureRuntimeCheckpointState(runtime: Runtime, storage?: RuntimeCheckpointState): RuntimeCheckpointState {
	return {
		machineState: captureRuntimeSaveMachineState(runtime, storage?.machineState),
		cpuState: runtime.machine.cpu.captureRuntimeState(storage?.cpuState.completionValues),
		pendingEntryCall: runtime.pendingCall === 'entry',
	};
}

export function applyRuntimeSaveState(runtime: Runtime, state: RuntimeSaveState): void {
	runtime.history.stop();
	runtime.machine.memory.ramData().set(state.ram);
	applyRuntimeCheckpointState(runtime, state, RuntimeRestoreOrigin.ExternalLoad);
}

/** The caller has installed main RAM and owns any retained history. */
export function applyRuntimeCheckpointState(runtime: Runtime, state: RuntimeCheckpointState, origin: RuntimeRestoreOrigin): void {
	applyRuntimeSaveMachineState(runtime, state.machineState);
	runtime.machine.cpu.restoreRuntimeState(state.cpuState);
	// The CPU's restored GP0 write wait is observable only after CPU restore.
	runtime.machine.gxGpu.dependencyStateChanged();
	runtime.readCompletionValues();
	runtime.pendingCall = state.pendingEntryCall ? 'entry' : null;
	runtime.onStateRestored?.(origin);
}
