import { machineManager } from '../../core/machine_manager';
import { getMachineVdpModeProfile, PSX_MODEL_PROFILE } from '../../machine/model_registry';
import type { Runtime } from '../../machine/runtime/runtime';
import { applyWorkspaceOverridesToCart, applyWorkspaceOverridesToRegistry } from '../workspace/workspace';
import * as workbenchMode from '../workbench/mode';
import { deactivateEditor, deactivateTerminalMode } from '../workbench/overlay_modes';
import { handleLuaError } from '../workbench/runtime_errors';
import { clearRuntimeFault } from './fault_state';
import { bootActiveProgram, invalidateModuleLookups } from './lua_pipeline';

export async function applyInitialWorkspaceOverrides(runtime: Runtime): Promise<void> {
	if (!runtime.cartLuaSources || !runtime.cartProjectRootPath) {
		return;
	}
	await applyWorkspaceOverridesToCart(runtime, {
		cart: runtime.cartLuaSources,
		storage: machineManager.platform.storage,
		includeServer: true,
		projectRootPath: runtime.cartProjectRootPath,
	});
}

export async function startPreparedRuntime(runtime: Runtime): Promise<void> {
	await applyWorkspaceOverridesToRegistry(runtime, {
		registry: runtime.systemLuaSources,
		storage: machineManager.platform.storage,
		includeServer: true,
		projectRootPath: runtime.systemProjectRootPath,
	});
	const vdpMode = getMachineVdpModeProfile(PSX_MODEL_PROFILE.biosVdpMode);
	workbenchMode.initializeIdeFeatures(runtime, { width: vdpMode.renderWidth, height: vdpMode.renderHeight });
	runtime.enterSystemFirmware();
	await bootPreparedRuntimeProgram(runtime);
}

export async function prepareRebootToBootRom(runtime: Runtime): Promise<void> {
	clearBootFaults(runtime);
	deactivateTerminalMode(runtime);
	deactivateEditor(runtime);
	clearLuaBootState(runtime);
	runtime.cartBoot.reset();
	if (runtime.cartLuaSources && runtime.cartProjectRootPath) {
		await applyWorkspaceOverridesToCart(runtime, {
			cart: runtime.cartLuaSources,
			storage: machineManager.platform.storage,
			includeServer: true,
			projectRootPath: runtime.cartProjectRootPath,
		});
	}
	await applyWorkspaceOverridesToRegistry(runtime, {
		registry: runtime.systemLuaSources,
		storage: machineManager.platform.storage,
		includeServer: true,
		projectRootPath: runtime.systemProjectRootPath,
	});
	runtime.enterSystemFirmware();
}

async function bootPreparedRuntimeProgram(runtime: Runtime): Promise<void> {
	const gateToken = runtime.luaGate.begin({ blocking: true, tag: 'boot' });
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
		runtime.luaGate.end(gateToken);
	}
}

function clearBootFaults(runtime: Runtime): void {
	workbenchMode.clearActiveDebuggerPause(runtime);
	clearRuntimeFault(runtime);
}

function clearLuaBootState(runtime: Runtime): void {
	runtime.luaInitialized = false;
	invalidateModuleLookups(runtime);
	runtime.luaChunkEnvironmentsByPath.clear();
	runtime.luaGenericChunksExecuted.clear();
	machineManager.ideState.editor.clearRuntimeErrorOverlay();
}
