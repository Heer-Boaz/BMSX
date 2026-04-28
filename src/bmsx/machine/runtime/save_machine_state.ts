import { RuntimeSaveMachineState } from './contracts';
import { Runtime } from './runtime';

export function captureRuntimeSaveMachineState(): RuntimeSaveMachineState {
	const runtime = Runtime.instance;
	return {
		machine: runtime.machine.captureSaveState(),
		frameScheduler: runtime.frameScheduler.captureState(),
		vblank: runtime.vblank.capture(),
	};
}

export function applyRuntimeSaveMachineState(state: RuntimeSaveMachineState): void {
	const runtime = Runtime.instance;
	runtime.machine.restoreSaveState(state.machine);
	runtime.frameScheduler.restoreState(state.frameScheduler);
	runtime.vblank.restore(state.vblank);
}
