import type { CpuRuntimeState } from '../cpu/cpu';
import type { RuntimeRenderState } from '../../render/runtime_state';
import type { RuntimeSaveMachineState } from './save_machine_state';
import type { Runtime } from './runtime';
import { applyRuntimeCpuState, captureRuntimeCpuState } from './cpu_state';
import { applyRuntimeRenderState, captureRuntimeRenderState } from '../../render/runtime_state';
import { clearBackQueues } from '../../render/shared/queues';
import { restoreVdpContextState } from '../../render/vdp/context_state';
import { applyRuntimeSaveMachineState, captureRuntimeSaveMachineState } from './save_machine_state';

export type RuntimeSaveState = {
	machineState: RuntimeSaveMachineState;
	cpuState: CpuRuntimeState;
	renderState: RuntimeRenderState;
	systemProgramActive: boolean;
	luaInitialized: boolean;
	luaRuntimeFailed: boolean;
	randomSeed: number;
	pendingEntryCall: boolean;
};

export function captureRuntimeSaveState(runtime: Runtime): RuntimeSaveState {
	return {
		machineState: captureRuntimeSaveMachineState(runtime),
		cpuState: captureRuntimeCpuState(runtime),
		renderState: captureRuntimeRenderState(),
		systemProgramActive: !runtime.cartProgramStarted,
		luaInitialized: runtime.luaInitialized,
		luaRuntimeFailed: runtime.luaRuntimeFailed,
		randomSeed: runtime.randomSeedValue,
		pendingEntryCall: runtime.pendingCall === 'entry',
	};
}

export function applyRuntimeSaveState(runtime: Runtime, state: RuntimeSaveState): void {
	if (state.systemProgramActive) {
		runtime.enterSystemFirmware();
	} else {
		runtime.enterCartProgram();
	}
	applyRuntimeSaveMachineState(runtime, state.machineState);
	restoreVdpContextState(runtime.machine.vdp);
	applyRuntimeCpuState(runtime, state.cpuState);
	applyRuntimeRenderState(state.renderState);
	runtime.luaInitialized = state.luaInitialized;
	runtime.luaRuntimeFailed = state.luaRuntimeFailed;
	runtime.randomSeedValue = state.randomSeed;
	runtime.pendingCall = state.pendingEntryCall ? 'entry' : null;
	clearBackQueues();
}
