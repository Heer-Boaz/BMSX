import { captureMachineState, restoreMachineState, type MachineState } from '../save_state';
import type { FrameSchedulerStateSnapshot } from '../scheduler/frame';
import type { RuntimeVblankSnapshot } from './vblank';
import type { Runtime } from './runtime';

export type RuntimeMachineState = {
	machine: MachineState;
	frameScheduler: FrameSchedulerStateSnapshot;
	vblank: RuntimeVblankSnapshot;
};

export function captureRuntimeMachineState(runtime: Runtime): RuntimeMachineState {
	return {
		machine: captureMachineState(runtime.machine),
		frameScheduler: runtime.frameScheduler.captureState(),
		vblank: runtime.vblank.capture(),
	};
}

export function applyRuntimeMachineState(runtime: Runtime, state: RuntimeMachineState): void {
	restoreMachineState(runtime.machine, state.machine);
	runtime.frameScheduler.restoreState(state.frameScheduler);
	runtime.vblank.restore(state.vblank);
}
