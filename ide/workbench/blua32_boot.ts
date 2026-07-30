import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { LogOutput } from '../../hosts/common/log';
import type { KeyValueStorage } from '../workspace/key_value_storage';
import { clearFaultSnapshot } from '../runtime/fault_state';
import { bootActiveBlua32Media } from '../runtime/lua_pipeline';
import { enterSystemSources } from '../runtime/sources';
import type { RuntimeIdeState } from '../runtime/state';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeFaultState } from '../runtime/fault_state';
import type { RuntimeLuaTooling } from '../runtime/lua_tooling';
import type { CartEditor } from '../cart_editor';
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

export function startPreparedRuntime(
	state: RuntimeIdeState,
	runtime: Runtime,
	logOutput: LogOutput,
): void {
	enterSystemSources(state.sources);
	bootPreparedBlua32Media(
		state.sources,
		state.fault,
		state.luaTooling,
		state.editor,
		runtime,
		logOutput,
		blua32MediaOverridesRequireRebuild(state.sources),
	);
}

async function prepareRebootToBootRom(
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	editor: CartEditor,
	overlayRenderer: OverlayRenderer,
	audioOutput: HostAudioOutput,
	storage: KeyValueStorage,
): Promise<boolean> {
	clearFaultSnapshot(fault);
	deactivateEditor(editor, overlayRenderer, audioOutput);
	editor.clearRuntimeErrorOverlay();
	await applyAllWorkspaceSourceOverrides(
		storage,
		sources,
		workspaceDirtyRecords,
	);
	enterSystemSources(sources);
	return blua32MediaOverridesRequireRebuild(sources);
}

export async function rebootPreparedRuntime(
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	luaTooling: RuntimeLuaTooling,
	editor: CartEditor,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
	audioOutput: HostAudioOutput,
	storage: KeyValueStorage,
): Promise<void> {
	const rebuildBlua32Media = await prepareRebootToBootRom(
		sources,
		fault,
		editor,
		overlayRenderer,
		audioOutput,
		storage,
	);
	bootActiveBlua32Media(
		sources,
		fault,
		luaTooling,
		runtime,
		rebuildBlua32Media,
	);
	audioOutput.restart(runtime.timing.ufpsScaled);
}

function bootPreparedBlua32Media(
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	luaTooling: RuntimeLuaTooling,
	editor: CartEditor,
	runtime: Runtime,
	logOutput: LogOutput,
	rebuildBlua32Media: boolean,
): void {
	try {
		clearFaultSnapshot(fault);
		editor.clearRuntimeErrorOverlay();
		bootActiveBlua32Media(
			sources,
			fault,
			luaTooling,
			runtime,
			rebuildBlua32Media,
		);
	} catch (error) {
		handleLuaError(logOutput, fault, sources, runtime, error);
		throw new Error(`failed to boot runtime: ${error}`);
	}
}
