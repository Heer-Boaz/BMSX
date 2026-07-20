import { machineManager } from '../../core/machine_manager';
import type { Runtime } from '../../machine/runtime/runtime';
import { applyWorkspaceOverridesToRegistry } from '../workspace/workspace';
import * as workbenchMode from '../workbench/mode';
import { deactivateEditor } from '../workbench/overlay_modes';
import { handleLuaError } from '../workbench/runtime_errors';
import { clearRuntimeFault } from './fault_state';
import { bootActiveProgram } from './lua_pipeline';
import { enterSystemSources } from './sources';

async function applyProgramMediaOverrides(): Promise<boolean> {
	const sources = machineManager.sourceState;
	if (sources.cartLuaSources && sources.cartProjectRootPath) {
		await applyWorkspaceOverridesToRegistry({
			registry: sources.cartLuaSources,
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
	return sources.systemProgramMediaDirty || sources.cartProgramMediaDirty;
}

export async function startPreparedRuntime(runtime: Runtime): Promise<void> {
	const rebuildProgramMedia = await applyProgramMediaOverrides();
	const sources = machineManager.sourceState;
	const viewport = machineManager.view.viewportSize;
	workbenchMode.initializeIdeFeatures(runtime, { width: viewport.x, height: viewport.y });
	runtime.enterSystemFirmware();
	enterSystemSources(sources);
	await bootPreparedRuntimeProgram(runtime, rebuildProgramMedia);
}

export async function prepareRebootToBootRom(runtime: Runtime): Promise<boolean> {
	clearBootFaults(runtime);
	deactivateEditor();
	clearLuaBootState(runtime);
	const rebuildProgramMedia = await applyProgramMediaOverrides();
	const sources = machineManager.sourceState;
	runtime.enterSystemFirmware();
	enterSystemSources(sources);
	return rebuildProgramMedia;
}

async function bootPreparedRuntimeProgram(runtime: Runtime, rebuildProgramMedia: boolean): Promise<void> {
	const gateToken = machineManager.ideState.luaGate.begin({ blocking: true, tag: 'boot' });
	try {
		runtime.hostFault.clear();
		clearBootFaults(runtime);
		clearLuaBootState(runtime);
		bootActiveProgram(runtime, rebuildProgramMedia);
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
	machineManager.sourceState.luaChunkEnvironmentsByPath.clear();
	machineManager.ideState.editor.clearRuntimeErrorOverlay();
}
