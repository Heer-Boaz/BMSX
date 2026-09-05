import { captureMachineSaveState, restoreMachineSaveState, type MachineSaveState } from '../save_state';
import type { FrameSchedulerStateSnapshot } from '../scheduler/frame';
import type { FrameLoopStateSnapshot } from './frame/loop';
import type { Runtime } from './runtime';

export type RuntimeSaveMachineState = {
	machine: MachineSaveState;
	frameScheduler: FrameSchedulerStateSnapshot;
	frameLoop: FrameLoopStateSnapshot;
	schedulerNowCycles: number;
};

export function captureRuntimeSaveMachineState(runtime: Runtime, storage?: RuntimeSaveMachineState): RuntimeSaveMachineState {
	return {
		machine: captureMachineSaveState(runtime.machine, storage?.machine),
		frameScheduler: runtime.frameScheduler.captureState(),
		frameLoop: runtime.frameLoop.captureState(),
		schedulerNowCycles: runtime.machine.scheduler.currentNowCycles(),
	};
}

export function applyRuntimeSaveMachineState(runtime: Runtime, state: RuntimeSaveMachineState): void {
	runtime.cpuExecution.reset();
	runtime.frameScheduler.reset();
	runtime.frameLoop.reset();
	runtime.machine.scheduler.reset();
	runtime.machine.scheduler.setNowCycles(state.schedulerNowCycles);
	runtime.vblank.prepareRestore();
	restoreMachineSaveState(runtime.machine, state.machine);
	runtime.applyPublishedGxGpuPcrtcTiming(runtime.machine.gxGpu.readDeviceOutput().pcrtcTiming);
	runtime.frameScheduler.restoreState(state.frameScheduler);
	runtime.frameLoop.restoreState(state.frameLoop);
}
