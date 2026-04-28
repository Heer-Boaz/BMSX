import { RuntimeSaveMachineState } from './contracts';
import type { Runtime } from './runtime';

export function captureRuntimeSaveMachineState(runtime: Runtime): RuntimeSaveMachineState {
	return {
		machine: runtime.machine.captureSaveState(),
		frameScheduler: runtime.frameScheduler.captureState(),
		vblank: runtime.vblank.capture(),
	};
}

export function applyRuntimeSaveMachineState(runtime: Runtime, state: RuntimeSaveMachineState): void {
	runtime.machine.restoreSaveState(state.machine);
	runtime.frameScheduler.restoreState(state.frameScheduler);
	runtime.vblank.restore(state.vblank);
}
