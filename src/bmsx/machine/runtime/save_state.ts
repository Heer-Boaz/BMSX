import { RuntimeSaveState } from './contracts';
import { Runtime } from './runtime';
import { applyRuntimeCpuState, captureRuntimeCpuState } from './cpu_state';
import { syncRuntimeGameViewStateToTable } from './game/table';
import { cloneGameViewState, copyGameViewState } from './game/view_state';
import { applyRuntimeRenderState, captureRuntimeRenderState } from '../../render/runtime_state';
import { clearBackQueues } from '../../render/shared/queues';
import { restoreVdpContextState } from '../../render/vdp/context_state';
import { applyRuntimeSaveMachineState, captureRuntimeSaveMachineState } from './save_machine_state';

export function captureRuntimeSaveState(): RuntimeSaveState {
	const runtime = Runtime.instance;
	return {
		storageState: runtime.storage.dump(),
		machineState: captureRuntimeSaveMachineState(),
		cpuState: captureRuntimeCpuState(),
		gameViewState: cloneGameViewState(runtime.gameViewState),
		renderState: captureRuntimeRenderState(),
		engineProgramActive: runtime.activeProgramSource === 'engine',
		luaInitialized: runtime.luaInitialized,
		luaRuntimeFailed: runtime.luaRuntimeFailed,
		randomSeed: runtime.randomSeedValue,
		pendingEntryCall: runtime.pendingCall === 'entry',
	};
}

export function applyRuntimeSaveState(state: RuntimeSaveState): void {
	const runtime = Runtime.instance;
	runtime.activateProgramSource(state.engineProgramActive ? 'engine' : 'cart');
	applyRuntimeSaveMachineState(state.machineState);
	restoreVdpContextState(runtime.machine.vdp);
	applyRuntimeCpuState(state.cpuState);
	runtime.storage.restore(state.storageState);
	copyGameViewState(runtime.gameViewState, state.gameViewState);
	applyRuntimeRenderState(state.renderState);
	runtime.luaInitialized = state.luaInitialized;
	runtime.luaRuntimeFailed = state.luaRuntimeFailed;
	runtime.randomSeedValue = state.randomSeed;
	runtime.pendingCall = state.pendingEntryCall ? 'entry' : null;
	syncRuntimeGameViewStateToTable();
	clearBackQueues();
}
