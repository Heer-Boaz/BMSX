import type { RuntimeSaveMachineState } from './contracts';
import type { Runtime } from './runtime';

export function captureRuntimeSaveMachineState(runtime: Runtime): RuntimeSaveMachineState {
	return {
		machine: runtime.machine.captureSaveState(),
		frameScheduler: runtime.frameScheduler.captureState(),
		vblank: runtime.vblank.capture(runtime),
	};
}

export function applyRuntimeSaveMachineState(runtime: Runtime, state: RuntimeSaveMachineState): void {
	runtime.machine.restoreSaveState(state.machine);
	runtime.frameScheduler.restoreState(state.frameScheduler);
	runtime.vblank.restore(runtime, state.vblank);
}
