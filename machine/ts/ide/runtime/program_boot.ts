import { machineManager } from '../../core/machine_manager';
import { getMachineVdpModeProfile, PSX_MODEL_PROFILE } from '../../machine/model_registry';
import type { Runtime } from '../../machine/runtime/runtime';
import { applyWorkspaceOverridesToCart, applyWorkspaceOverridesToRegistry } from '../workspace/workspace';
import * as workbenchMode from '../workbench/mode';
import { deactivateEditor, deactivateTerminalMode } from '../workbench/overlay_modes';
import { handleLuaError } from '../workbench/runtime_errors';
import { clearRuntimeFault } from './fault_state';
import { bootActiveProgram, invalidateModuleLookups } from './lua_pipeline';
import { enterSystemSources } from './sources';

export async function applyInitialWorkspaceOverrides(): Promise<void> {
	const sources = machineManager.sourceState;
	if (!sources.cartLuaSources || !sources.cartProjectRootPath) {
		return;
	}
	await applyWorkspaceOverridesToCart({
		cart: sources.cartLuaSources,
		storage: machineManager.platform.storage,
		includeServer: true,
		projectRootPath: sources.cartProjectRootPath,
	});
}

export async function startPreparedRuntime(runtime: Runtime): Promise<void> {
	const sources = machineManager.sourceState;
	await applyWorkspaceOverridesToRegistry({
		registry: sources.systemLuaSources,
		storage: machineManager.platform.storage,
		includeServer: true,
		projectRootPath: sources.systemProjectRootPath,
	});
	const vdpMode = getMachineVdpModeProfile(PSX_MODEL_PROFILE.biosVdpMode);
	workbenchMode.initializeIdeFeatures(runtime, { width: vdpMode.renderWidth, height: vdpMode.renderHeight });
	runtime.enterSystemFirmware();
	enterSystemSources(sources);
	await bootPreparedRuntimeProgram(runtime);
}

export async function prepareRebootToBootRom(runtime: Runtime): Promise<void> {
	clearBootFaults(runtime);
	deactivateTerminalMode();
	deactivateEditor();
	clearLuaBootState(runtime);
	const sources = machineManager.sourceState;
	if (sources.cartLuaSources && sources.cartProjectRootPath) {
		await applyWorkspaceOverridesToCart({
			cart: sources.cartLuaSources,
			storage: machineManager.platform.storage,
			includeServer: true,
			projectRootPath: sources.cartProjectRootPath,
		});
	}
	await applyWorkspaceOverridesToRegistry({
		registry: sources.systemLuaSources,
		storage: machineManager.platform.storage,
		includeServer: true,
		projectRootPath: sources.systemProjectRootPath,
	});
	runtime.enterSystemFirmware();
	enterSystemSources(sources);
}

async function bootPreparedRuntimeProgram(runtime: Runtime): Promise<void> {
	const gateToken = machineManager.ideState.luaGate.begin({ blocking: true, tag: 'boot' });
	try {
		runtime.hostFault.clear();
		clearBootFaults(runtime);
		clearLuaBootState(runtime);
		bootActiveProgram(runtime);
	}
	catch (error) {
		handleLuaError(runtime, error);
		throw new Error(`failed to boot runtime: ${error}`);
	}
	finally {
		machineManager.ideState.luaGate.end(gateToken);
	}
}

function clearBootFaults(runtime: Runtime): void {
	workbenchMode.clearActiveDebuggerPause(runtime);
	clearRuntimeFault(runtime);
}

function clearLuaBootState(runtime: Runtime): void {
	runtime.luaInitialized = false;
	invalidateModuleLookups();
	machineManager.sourceState.luaChunkEnvironmentsByPath.clear();
	machineManager.sourceState.luaGenericChunksExecuted.clear();
	machineManager.ideState.editor.clearRuntimeErrorOverlay();
}
