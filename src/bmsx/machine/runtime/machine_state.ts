import type { RuntimeMachineState } from './contracts';
import type { Runtime } from './runtime';

export function captureRuntimeMachineState(runtime: Runtime): RuntimeMachineState {
	return {
		machine: runtime.machine.captureState(),
		frameScheduler: runtime.frameScheduler.captureState(),
		vblank: runtime.vblank.capture(runtime),
	};
}

export function applyRuntimeMachineState(runtime: Runtime, state: RuntimeMachineState): void {
	runtime.machine.restoreState(state.machine);
	runtime.frameScheduler.restoreState(state.frameScheduler);
	runtime.vblank.restore(runtime, state.vblank);
}
