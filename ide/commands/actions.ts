import type { HostExecutionControl } from '../../hosts/common/execution_control';
import { editorRuntimeState } from '../editor/common/runtime_state';
import { applyAllWorkspaceSourceOverrides, applyLuaTextModelSources } from '../workspace/workspace';
import { workspaceDirtyRecords } from '../workbench/workspace/state';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { Input } from '../../hosts/common/input/manager';
import { LogLevel, type LogOutput } from '../../hosts/common/log';
import type { KeyValueStorage } from '../workspace/key_value_storage';
import { buildBlua32Revision, hotResume, type BuiltBlua32Revision } from '../runtime/hot_resume';
import { blua32MediaRequiresRebuild } from '../runtime/lua_pipeline';
import { deactivateEditor } from '../workbench/overlay_modes';
import { handleLuaError } from '../workbench/runtime_errors';
import { rebootPreparedRuntime } from '../workbench/blua32_boot';
import type { ActionPromptAction } from '../common/models';
import * as constants from '../common/constants';
import { setEditorCaseInsensitivity } from '../editor/render/text_renderer';
import { editorViewState } from '../editor/ui/view/state';
import { captureLuaTextModelSources } from '../workbench/services/working_copy/lua_sources';
import { persistWorkspaceSessionLocally } from '../workbench/workspace/storage';
import type { CartEditor } from '../cart_editor';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeFaultState } from '../runtime/fault_state';
import type { RuntimeLuaTooling } from '../runtime/lua_tooling';
import type { OverlayRenderer } from '../runtime/overlay_renderer';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import type { RuntimeDebuggerState } from '../runtime/debugger_state';
import { showEditorMessage } from '../common/feedback_state';

export function performEditorAction(
	editor: CartEditor,
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	luaTooling: RuntimeLuaTooling,
	debuggerState: RuntimeDebuggerState,
	input: Input,
	runtimeTasks: RuntimeTaskQueue,
	execution: HostExecutionControl,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
	audioOutput: HostAudioOutput,
	storage: KeyValueStorage,
	logOutput: LogOutput,
	action: ActionPromptAction,
): boolean {
	switch (action) {
		case 'hot-resume':
			performHotResume(
				editor,
				sources,
				fault,
				luaTooling,
				debuggerState,
				input,
				runtimeTasks,
				execution,
				overlayRenderer,
				runtime,
				audioOutput,
				storage,
				logOutput,
			);
			return true;
		case 'reboot':
			return performReboot(
				editor,
				sources,
				fault,
				luaTooling,
				debuggerState,
				runtimeTasks,
				execution,
				overlayRenderer,
				runtime,
				audioOutput,
				storage,
				logOutput,
			);
		case 'close':
			deactivateEditor(editor, overlayRenderer, audioOutput);
			return true;
		case 'theme-toggle':
			toggleThemeMode();
			return true;
		default:
			return false;
	}
}

export function performHotResume(
	editor: CartEditor,
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	luaTooling: RuntimeLuaTooling,
	debuggerState: RuntimeDebuggerState,
	input: Input,
	runtimeTasks: RuntimeTaskQueue,
	execution: HostExecutionControl,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
	audioOutput: HostAudioOutput,
	storage: KeyValueStorage,
	logOutput: LogOutput,
): Promise<void> {
	console.log('Performing hot resume.');
	const sourceSnapshots = captureLuaTextModelSources(sources);
	persistWorkspaceSessionLocally();
	const handleHotResumeError = (error: unknown): void => {
		console.error(error);
		logOutput.log(LogLevel.Error, error instanceof Error ? error.message : String(error));
		editor.handleRuntimeTaskError(error, 'Failed to resume game');
	};
	return runtimeTasks.schedule(async () => {
		let built: BuiltBlua32Revision | null;
		try {
			await applyAllWorkspaceSourceOverrides(storage, sources, workspaceDirtyRecords);
			applyLuaTextModelSources(sources, sourceSnapshots);
			built = blua32MediaRequiresRebuild(sources)
				? buildBlua32Revision(sources, luaTooling, runtime,
					sources.systemBlua32MediaDirty, sources.cartridgeBlua32MediaDirty)
				: null;
		} catch (error) {
			// Source/build rejection precedes machine mutation. Keep the installed
			// execution available; the operation queue must not latch a host fault.
			handleHotResumeError(error);
			return;
		}
		hotResume(
			sources,
			luaTooling,
			fault,
			debuggerState,
			input,
			runtimeTasks,
			editor,
			runtime,
			built,
			handleHotResumeError,
			() => {
				showEditorMessage('Hot Resume: code applied', constants.COLOR_STATUS_TEXT, 2.0);
			},
		);
		execution.requestExecution(true);
		deactivateEditor(editor, overlayRenderer, audioOutput);
	}, handleHotResumeError);
}

export function performReboot(
	editor: CartEditor,
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	luaTooling: RuntimeLuaTooling,
	debuggerState: RuntimeDebuggerState,
	runtimeTasks: RuntimeTaskQueue,
	execution: HostExecutionControl,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
	audioOutput: HostAudioOutput,
	storage: KeyValueStorage,
	logOutput: LogOutput,
): boolean {
	deactivateEditor(editor, overlayRenderer, audioOutput);
	const sourceSnapshots = captureLuaTextModelSources(sources);
	persistWorkspaceSessionLocally();
	runtimeTasks.schedule(async () => {
		console.info('[IDE] Performing cold reboot through bootrom');
		await rebootPreparedRuntime(
			sources,
			fault,
			luaTooling,
			debuggerState,
			editor,
			overlayRenderer,
			runtime,
			audioOutput,
			storage,
			sourceSnapshots,
		);
		execution.requestExecution(true);
	}, (error) => {
		handleLuaError(
			logOutput,
			fault,
			sources,
			runtime,
			luaTooling.suspendedGuest,
			error,
		);
		editor.handleRuntimeTaskError(error, 'Failed to reboot game');
	});
	return true;
}

function toggleThemeMode(): void {
	const currentVariant = constants.getActiveIdeThemeVariant();
	let nextVariant: string;
	switch (currentVariant) {
		case 'light':
			nextVariant = 'dark';
			break;
		case 'dark':
			nextVariant = 'light';
			break;
		default:
			throw new Error(`[IDE] Unknown theme variant: ${currentVariant}`);
	}
	constants.setIdeThemeVariant(nextVariant);
	editorRuntimeState.themeVariant = constants.getActiveIdeThemeVariant();
	setEditorCaseInsensitivity(editorRuntimeState.uppercaseDisplay);
	editorViewState.layout.invalidateAllHighlights();
}
