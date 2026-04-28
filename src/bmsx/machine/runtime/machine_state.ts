import { RuntimeMachineState } from './contracts';
import { Runtime } from './runtime';

export function captureRuntimeMachineState(): RuntimeMachineState {
	const runtime = Runtime.instance;
	return {
		machine: runtime.machine.captureState(),
		frameScheduler: runtime.frameScheduler.captureState(),
		vblank: runtime.vblank.capture(),
	};
}

export function applyRuntimeMachineState(state: RuntimeMachineState): void {
	const runtime = Runtime.instance;
	runtime.machine.restoreState(state.machine);
	runtime.frameScheduler.restoreState(state.frameScheduler);
	runtime.vblank.restore(state.vblank);
}
