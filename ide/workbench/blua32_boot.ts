import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { LogOutput } from '../../hosts/common/log';
import type { KeyValueStorage } from '../workspace/key_value_storage';
import { clearFaultSnapshot } from '../runtime/fault_state';
import {
	blua32MediaRequiresRebuild,
	bootInstalledBlua32Media,
	prepareBlua32MediaBoot,
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

async function prepareRebootToBootRom(
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	editor: CartEditor,
	overlayRenderer: OverlayRenderer,
	audioOutput: HostAudioOutput,
	storage: KeyValueStorage,
	sourceSnapshots: ReadonlyArray<LuaTextModelSourceSnapshot>,
): Promise<boolean> {
	clearFaultSnapshot(fault);
	clearExecutionStopHighlights();
	deactivateEditor(editor, overlayRenderer, audioOutput);
	editor.clearRuntimeErrorOverlay();
	await applyAllWorkspaceSourceOverrides(
		storage,
		sources,
		workspaceDirtyRecords,
	);
	applyLuaTextModelSources(sources, sourceSnapshots);
	enterSystemSources(sources);
	return blua32MediaRequiresRebuild(sources);
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
): Promise<void> {
	discardRuntimeDebuggerPlans(debuggerState);
	const rebuildBlua32Media = await prepareRebootToBootRom(
		sources,
		fault,
		editor,
		overlayRenderer,
		audioOutput,
		storage,
		sourceSnapshots,
	);
	const interpreter = prepareBlua32MediaBoot(
		sources,
		luaTooling,
		runtime,
		rebuildBlua32Media,
	);
	bootInstalledBlua32Media(fault, luaTooling, runtime, interpreter);
	audioOutput.muteSystem(false);
	resetRuntimeDebuggerExecution(debuggerState);
	audioOutput.restart(runtime.timing.ufpsScaled);
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
		const interpreter = prepareBlua32MediaBoot(
			sources,
			luaTooling,
			runtime,
			rebuildBlua32Media,
		);
		bootInstalledBlua32Media(fault, luaTooling, runtime, interpreter);
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
