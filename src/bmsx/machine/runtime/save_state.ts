import type { CpuRuntimeState } from '../cpu/cpu';
import { consoleCore } from '../../core/console';
import type { RuntimeSaveMachineState } from './save_machine_state';
import type { Runtime } from './runtime';
import { applyRuntimeCpuState, captureRuntimeCpuState } from './cpu_state';
import { restoreVdpContextState } from '../../render/vdp/context_state';
import { applyRuntimeSaveMachineState, captureRuntimeSaveMachineState } from './save_machine_state';

export type RuntimeSaveState = {
	machineState: RuntimeSaveMachineState;
	cpuState: CpuRuntimeState;
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
	restoreVdpContextState(runtime.machine.vdp, consoleCore.view);
	applyRuntimeCpuState(runtime, state.cpuState);
	runtime.luaInitialized = state.luaInitialized;
	runtime.luaRuntimeFailed = state.luaRuntimeFailed;
	runtime.randomSeedValue = state.randomSeed;
	runtime.pendingCall = state.pendingEntryCall ? 'entry' : null;
}
