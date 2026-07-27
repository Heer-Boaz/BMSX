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
import { applyAllWorkspaceSourceOverrides } from '../workspace/workspace';
import { workspaceDirtyRecords } from './workspace/state';
import { deactivateEditor } from './overlay_modes';
import { handleLuaError } from './runtime_errors';

function blua32MediaOverridesRequireRebuild(sources: RuntimeSourceState): boolean {
	return sources.systemBlua32MediaDirty
		|| sources.cartridgeBlua32MediaDirty[0]
		|| sources.cartridgeBlua32MediaDirty[1];
}

export async function startPreparedRuntime(state: RuntimeIdeState, runtime: Runtime): Promise<void> {
	enterSystemSources(state.sources);
	await bootPreparedBlua32Media(
		state.sources,
		state.fault,
		state.nativeBridge,
		state.editor,
		state.luaGate,
		runtime,
		blua32MediaOverridesRequireRebuild(state.sources),
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
	await applyAllWorkspaceSourceOverrides(sources, workspaceDirtyRecords);
	enterSystemSources(sources);
	return blua32MediaOverridesRequireRebuild(sources);
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
