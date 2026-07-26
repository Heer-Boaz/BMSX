import { machineManager } from '../../machine/ts/core/machine_manager';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { clearRuntimeFault } from '../runtime/fault_state';
import { bootActiveBlua32Media } from '../runtime/lua_pipeline';
import { enterSystemSources } from '../runtime/sources';
import type { RuntimeIdeState } from '../runtime/state';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeFaultState } from '../runtime/fault_state';
import type { RuntimeNativeBridge } from '../runtime/native_bridge';
import type { CartEditor } from '../cart_editor';
import type { GateGroup } from '../../machine/ts/common/taskgate';
import type { OverlayRenderer } from '../runtime/overlay_renderer';
import { applyWorkspaceOverridesToRegistry } from '../workspace/workspace';
import { deactivateEditor } from './overlay_modes';
import { handleLuaError } from './runtime_errors';

async function applyBlua32MediaOverrides(sources: RuntimeSourceState): Promise<boolean> {
	for (let slot = 0; slot < sources.cartridgeSlots.length; slot += 1) {
		const cartridge = sources.cartridgeSlots[slot];
		if (!cartridge || !cartridge.projectRootPath) {
			continue;
		}
		await applyWorkspaceOverridesToRegistry(sources, {
			registry: cartridge.luaSources,
			storage: machineManager.platform.storage,
			includeServer: true,
			projectRootPath: cartridge.projectRootPath,
		});
	}
	await applyWorkspaceOverridesToRegistry(sources, {
		registry: sources.systemLuaSources,
		storage: machineManager.platform.storage,
		includeServer: true,
		projectRootPath: sources.systemProjectRootPath,
	});
	return sources.systemBlua32MediaDirty
		|| sources.cartridgeBlua32MediaDirty[0]
		|| sources.cartridgeBlua32MediaDirty[1];
}

export async function startPreparedRuntime(state: RuntimeIdeState, runtime: Runtime): Promise<void> {
	const rebuildBlua32Media = await applyBlua32MediaOverrides(state.sources);
	enterSystemSources(state.sources);
	await bootPreparedBlua32Media(
		state.sources,
		state.fault,
		state.nativeBridge,
		state.editor,
		state.luaGate,
		runtime,
		rebuildBlua32Media,
	);
}

async function prepareRebootToBootRom(
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	editor: CartEditor,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
): Promise<boolean> {
	clearRuntimeFault(fault, runtime);
	deactivateEditor(editor, overlayRenderer);
	clearLuaBootState(editor, runtime);
	const rebuildBlua32Media = await applyBlua32MediaOverrides(sources);
	enterSystemSources(sources);
	return rebuildBlua32Media;
}

export async function rebootPreparedRuntime(
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	nativeBridge: RuntimeNativeBridge,
	editor: CartEditor,
	luaGate: GateGroup,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
): Promise<void> {
	const gateToken = luaGate.begin({ blocking: true, tag: 'reboot_bootrom' });
	try {
		overlayRenderer.abandonFrame();
		await machineManager.resetRuntime();
		const rebuildBlua32Media = await prepareRebootToBootRom(
			sources,
			fault,
			editor,
			overlayRenderer,
			runtime,
		);
		machineManager.bootstrapStartupAudio();
		try {
			bootActiveBlua32Media(
				sources,
				fault,
				nativeBridge,
				runtime,
				rebuildBlua32Media,
			);
		} catch (error) {
			handleLuaError(fault, sources, runtime, error);
			throw error;
		}
		machineManager.flushSystemOutput(runtime);
	} finally {
		luaGate.end(gateToken);
	}
}

async function bootPreparedBlua32Media(
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	nativeBridge: RuntimeNativeBridge,
	editor: CartEditor,
	luaGate: GateGroup,
	runtime: Runtime,
	rebuildBlua32Media: boolean,
): Promise<void> {
	const gateToken = luaGate.begin({ blocking: true, tag: 'boot' });
	try {
		clearRuntimeFault(fault, runtime);
		clearLuaBootState(editor, runtime);
		bootActiveBlua32Media(
			sources,
			fault,
			nativeBridge,
			runtime,
			rebuildBlua32Media,
		);
	} catch (error) {
		handleLuaError(fault, sources, runtime, error);
		throw new Error(`failed to boot runtime: ${error}`);
	} finally {
		luaGate.end(gateToken);
	}
}

function clearLuaBootState(editor: CartEditor, runtime: Runtime): void {
	runtime.luaInitialized = false;
	editor.clearRuntimeErrorOverlay();
}
