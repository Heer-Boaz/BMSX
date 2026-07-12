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
	const gpuOutput = runtime.machine.gxGpu.readDeviceOutput();
	return {
		psxGpuDisplayModeWord: gpuOutput.displayModeWord,
		machine: captureMachineState(runtime.machine),
		frameScheduler: runtime.frameScheduler.captureState(),
		vblank: runtime.vblank.capture(),
	};
}

export function applyRuntimeMachineState(runtime: Runtime, state: RuntimeMachineState): void {
	runtime.applyPublishedPsxGpuDisplayTiming(state.machine.gxGpu.presentDisplayModeWord, state.machine.gxGpu.presentVerticalDisplayRangeWord);
	runtime.vblank.restore(state.vblank);
	restoreMachineState(runtime.machine, state.machine);
	runtime.frameScheduler.restoreState(state.frameScheduler);
}
