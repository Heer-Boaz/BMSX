import { machineManager } from '../../machine/ts/core/machine_manager';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { applyWorkspaceOverridesToRegistry } from '../workspace/workspace';
import * as workbenchMode from './mode';
import { deactivateEditor } from './overlay_modes';
import { handleLuaError } from './runtime_errors';
import { clearRuntimeFault } from '../runtime/fault_state';
import { bootActiveBlua32Media } from '../runtime/lua_pipeline';
import { enterSystemSources } from '../runtime/sources';

async function applyBlua32MediaOverrides(): Promise<boolean> {
	const sources = machineManager.sourceState;
	for (let slot = 0; slot < sources.cartridgeSlots.length; slot += 1) {
		const cartridge = sources.cartridgeSlots[slot];
		if (cartridge === null || !cartridge.projectRootPath) {
			continue;
		}
		await applyWorkspaceOverridesToRegistry({
			registry: cartridge.luaSources,
			storage: machineManager.platform.storage,
			includeServer: true,
			projectRootPath: cartridge.projectRootPath,
		});
	}
	await applyWorkspaceOverridesToRegistry({
		registry: sources.systemLuaSources,
		storage: machineManager.platform.storage,
		includeServer: true,
		projectRootPath: sources.systemProjectRootPath,
	});
	return sources.systemBlua32MediaDirty
		|| sources.cartridgeBlua32MediaDirty[0]
		|| sources.cartridgeBlua32MediaDirty[1];
}

export async function startPreparedRuntime(runtime: Runtime): Promise<void> {
	const rebuildBlua32Media = await applyBlua32MediaOverrides();
	const sources = machineManager.sourceState;
	const viewport = machineManager.view.viewportSize;
	workbenchMode.initializeIdeFeatures(runtime, { width: viewport.x, height: viewport.y });
	enterSystemSources(sources);
	await bootPreparedBlua32Media(runtime, rebuildBlua32Media);
}

export async function prepareRebootToBootRom(runtime: Runtime): Promise<boolean> {
	clearBootFaults(runtime);
	deactivateEditor();
	clearLuaBootState(runtime);
	const rebuildBlua32Media = await applyBlua32MediaOverrides();
	const sources = machineManager.sourceState;
	enterSystemSources(sources);
	return rebuildBlua32Media;
}

async function bootPreparedBlua32Media(runtime: Runtime, rebuildBlua32Media: boolean): Promise<void> {
	const gateToken = machineManager.ideState.luaGate.begin({ blocking: true, tag: 'boot' });
	try {
		runtime.hostFault.clear();
		clearBootFaults(runtime);
		clearLuaBootState(runtime);
		bootActiveBlua32Media(runtime, rebuildBlua32Media);
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
	machineManager.ideState.editor.clearRuntimeErrorOverlay();
}
