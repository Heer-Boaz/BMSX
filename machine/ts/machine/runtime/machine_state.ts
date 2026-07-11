import { captureMachineState, restoreMachineState, type MachineState } from '../save_state';
import type { FrameSchedulerStateSnapshot } from '../scheduler/frame';
import type { RuntimeVblankSnapshot } from './vblank';
import type { Runtime } from './runtime';

export type RuntimeMachineState = {
	psxGpuDisplayModeWord: number;
	machine: MachineState;
	frameScheduler: FrameSchedulerStateSnapshot;
	vblank: RuntimeVblankSnapshot;
};

export function captureRuntimeMachineState(runtime: Runtime): RuntimeMachineState {
	return {
		psxGpuDisplayModeWord: runtime.timing.gpuDisplayModeWord,
		machine: captureMachineState(runtime.machine),
		frameScheduler: runtime.frameScheduler.captureState(),
		vblank: runtime.vblank.capture(),
	};
}

export function applyRuntimeMachineState(runtime: Runtime, state: RuntimeMachineState): void {
	runtime.applyPsxGpuDisplayModeWord(state.psxGpuDisplayModeWord);
	runtime.vblank.restore(state.vblank);
	restoreMachineState(runtime.machine, state.machine);
	runtime.frameScheduler.restoreState(state.frameScheduler);
}
