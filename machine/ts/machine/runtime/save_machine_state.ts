import { captureMachineSaveState, restoreMachineSaveState, type MachineSaveState } from '../save_state';
import type { FrameSchedulerStateSnapshot } from '../scheduler/frame';
import type { RuntimeVblankSnapshot } from './vblank';
import type { Runtime } from './runtime';

export type RuntimeSaveMachineState = {
	psxGpuDisplayModeWord: number;
	machine: MachineSaveState;
	frameScheduler: FrameSchedulerStateSnapshot;
	vblank: RuntimeVblankSnapshot;
};

export function captureRuntimeSaveMachineState(runtime: Runtime): RuntimeSaveMachineState {
	const gpuOutput = runtime.machine.gxGpu.readDeviceOutput();
	return {
		psxGpuDisplayModeWord: gpuOutput.displayModeWord,
		machine: captureMachineSaveState(runtime.machine),
		frameScheduler: runtime.frameScheduler.captureState(),
		vblank: runtime.vblank.capture(),
	};
}

export function applyRuntimeSaveMachineState(runtime: Runtime, state: RuntimeSaveMachineState): void {
	runtime.applyPublishedPsxGpuDisplayTiming(state.machine.gxGpu.presentDisplayModeWord, state.machine.gxGpu.presentVerticalDisplayRangeWord);
	runtime.vblank.restore(state.vblank);
	restoreMachineSaveState(runtime.machine, state.machine);
	runtime.frameScheduler.restoreState(state.frameScheduler);
}
