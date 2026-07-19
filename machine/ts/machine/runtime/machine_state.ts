import { captureMachineState, restoreMachineState, type MachineState } from '../save_state';
import type { FrameSchedulerStateSnapshot } from '../scheduler/frame';
import type { Runtime } from './runtime';

export type RuntimeMachineState = {
	machine: MachineState;
	frameScheduler: FrameSchedulerStateSnapshot;
	schedulerNowCycles: number;
};

export function captureRuntimeMachineState(runtime: Runtime): RuntimeMachineState {
	return {
		machine: captureMachineState(runtime.machine),
		frameScheduler: runtime.frameScheduler.captureState(),
		schedulerNowCycles: runtime.machine.scheduler.currentNowCycles(),
	};
}

export function applyRuntimeMachineState(runtime: Runtime, state: RuntimeMachineState): void {
	runtime.frameScheduler.reset();
	runtime.frameLoop.reset();
	runtime.machine.scheduler.reset();
	runtime.machine.scheduler.setNowCycles(state.schedulerNowCycles);
	runtime.vblank.prepareRestore();
	restoreMachineState(runtime.machine, state.machine);
	runtime.applyPublishedGxGpuPcrtcTiming(runtime.machine.gxGpu.readDeviceOutput().pcrtcTiming);
	runtime.frameScheduler.restoreState(state.frameScheduler);
}
