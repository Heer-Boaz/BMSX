import { captureMachineState, restoreMachineState, type MachineState } from '../save_state';
import type { FrameSchedulerStateSnapshot } from '../scheduler/frame';
import type { FrameLoopStateSnapshot } from './frame/loop';
import type { Runtime } from './runtime';

export type RuntimeMachineState = {
	machine: MachineState;
	frameScheduler: FrameSchedulerStateSnapshot;
	frameLoop: FrameLoopStateSnapshot;
	schedulerNowCycles: number;
};

export function captureRuntimeMachineState(runtime: Runtime): RuntimeMachineState {
	return {
		machine: captureMachineState(runtime.machine),
		frameScheduler: runtime.frameScheduler.captureState(),
		frameLoop: runtime.frameLoop.captureState(),
		schedulerNowCycles: runtime.machine.scheduler.currentNowCycles(),
	};
}

export function applyRuntimeMachineState(runtime: Runtime, state: RuntimeMachineState): void {
	runtime.cpuExecution.reset();
	runtime.frameScheduler.reset();
	runtime.frameLoop.reset();
	runtime.machine.scheduler.reset();
	runtime.machine.scheduler.setNowCycles(state.schedulerNowCycles);
	runtime.vblank.prepareRestore();
	restoreMachineState(runtime.machine, state.machine);
	runtime.applyPublishedGxGpuPcrtcTiming(runtime.machine.gxGpu.readDeviceOutput().pcrtcTiming);
	runtime.frameScheduler.restoreState(state.frameScheduler);
	runtime.frameLoop.restoreState(state.frameLoop);
}
