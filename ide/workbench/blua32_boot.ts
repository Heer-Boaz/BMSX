import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { LogOutput } from '../../hosts/common/log';
import type { KeyValueStorage } from '../workspace/key_value_storage';
import { clearFaultSnapshot } from '../runtime/fault_state';
import {
	blua32MediaRequiresRebuild,
	bootInstalledBlua32Media,
	installBlua32Media,
	prepareBlua32MediaBoot,
	type Blua32CartridgeEntry,
	type PreparedBlua32Boot,
} from '../runtime/lua_pipeline';
import { enterSystemSources } from '../runtime/sources';
import type { RuntimeIdeState } from './state';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeFaultState } from '../runtime/fault_state';
import type { RuntimeLuaTooling } from '../runtime/lua_tooling';
import {
	discardRuntimeDebuggerPlans,
	resetRuntimeDebuggerExecution,
	type RuntimeDebuggerState,
} from '../runtime/debugger_state';
import type { CartEditor } from '../cart_editor';
import type { OverlayRenderer } from '../runtime/overlay_renderer';
import { applyAllWorkspaceSourceOverrides, applyLuaTextModelSources } from '../workspace/workspace';
import { workspaceDirtyRecords } from './workspace/state';
import { deactivateEditor } from './overlay_modes';
import { handleLuaError } from './runtime_errors';
import { clearExecutionStopHighlights } from '../runtime_error/navigation';
import type { LuaTextModelSourceSnapshot } from './services/working_copy/lua_sources';

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
		state.debugger,
		state.editor,
		runtime,
		logOutput,
		blua32MediaRequiresRebuild(state.sources),
	);
}

export async function rebootPreparedRuntime(
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	luaTooling: RuntimeLuaTooling,
	debuggerState: RuntimeDebuggerState,
	editor: CartEditor,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
	audioOutput: HostAudioOutput,
	storage: KeyValueStorage,
	sourceSnapshots: ReadonlyArray<LuaTextModelSourceSnapshot>,
	entry?: Blua32CartridgeEntry,
): Promise<boolean> {
	let prepared: PreparedBlua32Boot;
	try {
		await applyAllWorkspaceSourceOverrides(storage, sources, workspaceDirtyRecords);
		applyLuaTextModelSources(sources, sourceSnapshots);
		prepared = prepareBlua32MediaBoot(sources, luaTooling, runtime,
			blua32MediaRequiresRebuild(sources), entry);
	} catch (error) {
		// Build rejection is not a guest fault: keep the installed execution,
		// debugger stop and editor available so the source can be corrected.
		console.error(error);
		editor.handleRuntimeTaskError(error, 'Build failed');
		return false;
	}
	clearFaultSnapshot(fault);
	clearExecutionStopHighlights();
	discardRuntimeDebuggerPlans(debuggerState);
	deactivateEditor(editor, overlayRenderer, audioOutput);
	editor.clearRuntimeErrorOverlay();
	if (prepared.installation !== null) installBlua32Media(sources, runtime, prepared.installation);
	enterSystemSources(sources);
	bootInstalledBlua32Media(fault, luaTooling, runtime, prepared.interpreter);
	audioOutput.muteSystem(false);
	resetRuntimeDebuggerExecution(debuggerState);
	audioOutput.restart(runtime.timing.ufpsScaled);
	return true;
}

function bootPreparedBlua32Media(
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	luaTooling: RuntimeLuaTooling,
	debuggerState: RuntimeDebuggerState,
	editor: CartEditor,
	runtime: Runtime,
	logOutput: LogOutput,
	rebuildBlua32Media: boolean,
): void {
	try {
		clearFaultSnapshot(fault);
		editor.clearRuntimeErrorOverlay();
		const prepared = prepareBlua32MediaBoot(
			sources,
			luaTooling,
			runtime,
			rebuildBlua32Media,
		);
		if (prepared.installation !== null) installBlua32Media(sources, runtime, prepared.installation);
		bootInstalledBlua32Media(fault, luaTooling, runtime, prepared.interpreter);
		resetRuntimeDebuggerExecution(debuggerState);
	} catch (error) {
		handleLuaError(
			logOutput,
			fault,
			sources,
			runtime,
			luaTooling.suspendedGuest,
			error,
		);
		throw new Error(`failed to boot runtime: ${error}`);
	}
}
