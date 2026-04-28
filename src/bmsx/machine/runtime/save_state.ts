import { RuntimeSaveState } from './contracts';
import type { Runtime } from './runtime';
import { applyRuntimeCpuState, captureRuntimeCpuState } from './cpu_state';
import { applyRuntimeRenderState, captureRuntimeRenderState } from '../../render/runtime_state';
import { clearBackQueues } from '../../render/shared/queues';
import { restoreVdpContextState } from '../../render/vdp/context_state';
import { applyRuntimeSaveMachineState, captureRuntimeSaveMachineState } from './save_machine_state';

export function captureRuntimeSaveState(runtime: Runtime): RuntimeSaveState {
	return {
		storageState: runtime.storage.dump(),
		machineState: captureRuntimeSaveMachineState(runtime),
		cpuState: captureRuntimeCpuState(runtime),
		renderState: captureRuntimeRenderState(),
		engineProgramActive: runtime.activeProgramSource === 'engine',
		luaInitialized: runtime.luaInitialized,
		luaRuntimeFailed: runtime.luaRuntimeFailed,
		randomSeed: runtime.randomSeedValue,
		pendingEntryCall: runtime.pendingCall === 'entry',
	};
}

export function applyRuntimeSaveState(runtime: Runtime, state: RuntimeSaveState): void {
	runtime.activateProgramSource(state.engineProgramActive ? 'engine' : 'cart');
	applyRuntimeSaveMachineState(runtime, state.machineState);
	restoreVdpContextState(runtime.machine.vdp);
	applyRuntimeCpuState(runtime, state.cpuState);
	runtime.storage.restore(state.storageState);
	applyRuntimeRenderState(state.renderState);
	runtime.luaInitialized = state.luaInitialized;
	runtime.luaRuntimeFailed = state.luaRuntimeFailed;
	runtime.randomSeedValue = state.randomSeed;
	runtime.pendingCall = state.pendingEntryCall ? 'entry' : null;
	clearBackQueues();
}
