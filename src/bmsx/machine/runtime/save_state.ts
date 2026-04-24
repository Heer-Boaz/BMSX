import type { RuntimeSaveState } from './contracts';
import type { Runtime } from './runtime';
import { resetTransientState } from '../../render/shared/queues';
import { applyRuntimeCpuState, captureRuntimeCpuState } from './cpu_state';
import { syncRuntimeGameViewStateToTable } from './game/table';
import { cloneGameViewState, copyGameViewState } from './game/view_state';
import { applyRuntimeRenderState, captureRuntimeRenderState } from './render/state';
import { applyRuntimeSaveMachineState, captureRuntimeSaveMachineState } from './save_machine_state';

export function captureRuntimeSaveState(runtime: Runtime): RuntimeSaveState {
	return {
		storageState: runtime.storage.dump(),
		machineState: captureRuntimeSaveMachineState(runtime),
		cpuState: captureRuntimeCpuState(runtime),
		gameViewState: cloneGameViewState(runtime.gameViewState),
		renderState: captureRuntimeRenderState(),
		engineProgramActive: runtime.activeLuaSources === runtime.engineLuaSources,
		luaInitialized: runtime.luaInitialized,
		luaRuntimeFailed: runtime.luaRuntimeFailed,
		randomSeed: runtime.randomSeedValue,
		pendingEntryCall: runtime.pendingCall === 'entry',
	};
}

export function applyRuntimeSaveState(runtime: Runtime, state: RuntimeSaveState): void {
	runtime.activateProgramSource(state.engineProgramActive ? 'engine' : 'cart');
	applyRuntimeSaveMachineState(runtime, state.machineState);
	applyRuntimeCpuState(runtime, state.cpuState);
	runtime.storage.restore(state.storageState);
	copyGameViewState(runtime.gameViewState, state.gameViewState);
	applyRuntimeRenderState(state.renderState);
	runtime.luaInitialized = state.luaInitialized;
	runtime.luaRuntimeFailed = state.luaRuntimeFailed;
	runtime.randomSeedValue = state.randomSeed;
	runtime.pendingCall = state.pendingEntryCall ? 'entry' : null;
	syncRuntimeGameViewStateToTable(runtime);
	resetTransientState();
}
