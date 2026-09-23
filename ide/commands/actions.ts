import type { HostExecutionControl } from '../../hosts/common/execution_control';
import { editorRuntimeState } from '../editor/common/runtime_state';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import { LogLevel, type LogOutput } from '../../hosts/common/log';
import type { KeyValueStorage } from '../workspace/key_value_storage';
import type { HotResumeService, HotResumeOperation } from '../workbench/services/execution/hot_resume';
import type { Blua32CartridgeEntry } from '../runtime/lua_pipeline';
import { deactivateEditor } from '../workbench/overlay_modes';
import { handleLuaError } from '../workbench/runtime_errors';
import { rebootPreparedRuntime } from '../workbench/blua32_boot';
import type { EditorActionRequest } from './action_request';
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
	hotResumes: HotResumeService,
	runtimeTasks: RuntimeTaskQueue,
	execution: HostExecutionControl,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
	audioOutput: HostAudioOutput,
	storage: KeyValueStorage,
	logOutput: LogOutput,
	request: EditorActionRequest,
): boolean {
	switch (request.action) {
		case 'hot-resume':
			performHotResume(hotResumes, editor, execution, overlayRenderer, audioOutput, logOutput);
			return true;
		case 'reboot':
		case 'run':
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
				request.action === 'run' ? request.entry : undefined,
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
	hotResumes: HotResumeService,
	editor: CartEditor,
	execution: HostExecutionControl,
	overlayRenderer: OverlayRenderer,
	audioOutput: HostAudioOutput,
	logOutput: LogOutput,
): HotResumeOperation {
	persistWorkspaceSessionLocally();
	const operation = hotResumes.resume();
	showEditorMessage('Hot Resume: pending', constants.COLOR_STATUS_TEXT, 2.0);
	void operation.admission.then(admission => {
		if (hotResumes.latestOperation !== operation || admission.status !== 'accepted'
			|| operation.result !== null && operation.result.status !== 'completed') return;
		execution.requestExecution(true);
		deactivateEditor(editor, overlayRenderer, audioOutput);
	});
	void operation.completion.then(result => {
		if (hotResumes.latestOperation !== operation) return;
		switch (result.status) {
			case 'completed':
				showEditorMessage('Hot Resume: code applied', constants.COLOR_STATUS_TEXT, 2.0);
				return;
			case 'rejected':
			case 'failed':
				logOutput.log(LogLevel.Error, result.error instanceof Error ? result.error.message : String(result.error));
				editor.handleRuntimeTaskError(result.error, 'Failed to resume game');
				return;
			case 'faulted':
				// The stack/overlay remains owned by the supervisor observation.
				showEditorMessage('Hot Resume: guest fault', constants.COLOR_STATUS_ERROR, 2.0);
				return;
			case 'cancelled':
				showEditorMessage('Hot Resume: cancelled', constants.COLOR_STATUS_TEXT, 2.0);
				return;
		}
	});
	return operation;
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
	entry?: Blua32CartridgeEntry,
): boolean {
	const sourceSnapshots = captureLuaTextModelSources(sources);
	persistWorkspaceSessionLocally();
	runtimeTasks.schedule(async () => {
		const booted = await rebootPreparedRuntime(
			sources,
			fault,
			luaTooling,
			debuggerState,
			editor,
			overlayRenderer,
			runtime,
			audioOutput,
			execution,
			storage,
			sourceSnapshots,
			entry,
		);
		if (booted) execution.requestExecution(true);
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
