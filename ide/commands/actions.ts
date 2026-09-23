import type { HostExecutionControl } from '../../hosts/common/execution_control';
import { editorRuntimeState } from '../editor/common/runtime_state';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import { LogLevel, type LogOutput } from '../../hosts/common/log';
import type { BootService, BootOperation } from '../workbench/services/execution/boot';
import type { HotResumeService, HotResumeOperation } from '../workbench/services/execution/hot_resume';
import type { Blua32CartridgeEntry } from '../runtime/lua_pipeline';
import { deactivateEditor } from '../workbench/overlay_modes';
import type { EditorActionRequest } from './action_request';
import * as constants from '../common/constants';
import { setEditorCaseInsensitivity } from '../editor/render/text_renderer';
import { editorViewState } from '../editor/ui/view/state';
import { persistWorkspaceSessionLocally } from '../workbench/workspace/storage';
import type { CartEditor } from '../cart_editor';
import type { OverlayRenderer } from '../runtime/overlay_renderer';
import { showEditorMessage } from '../common/feedback_state';

export function performEditorAction(
	editor: CartEditor,
	hotResumes: HotResumeService,
	boots: BootService,
	execution: HostExecutionControl,
	overlayRenderer: OverlayRenderer,
	audioOutput: HostAudioOutput,
	logOutput: LogOutput,
	request: EditorActionRequest,
): boolean {
	switch (request.action) {
		case 'hot-resume':
			if (!hotResumes.acceptingRequests) return false;
			performHotResume(hotResumes, editor, execution, overlayRenderer, audioOutput, logOutput);
			return true;
		case 'reboot':
		case 'run':
			if (!boots.acceptingRequests) return false;
			performReboot(boots, editor, execution, overlayRenderer, audioOutput, logOutput,
				request.action === 'run' ? request.entry : undefined);
			return true;
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
	boots: BootService,
	editor: CartEditor,
	execution: HostExecutionControl,
	overlayRenderer: OverlayRenderer,
	audioOutput: HostAudioOutput,
	logOutput: LogOutput,
	entry?: Blua32CartridgeEntry,
): BootOperation {
	persistWorkspaceSessionLocally();
	const operation = boots.reboot(entry);
	showEditorMessage('Reboot: pending', constants.COLOR_STATUS_TEXT, 2.0);
	void operation.completion.then(result => {
		if (boots.latestOperation !== operation) return;
		switch (result.status) {
			case 'reset':
				execution.requestExecution(true);
				deactivateEditor(editor, overlayRenderer, audioOutput);
				showEditorMessage('Reboot: reset complete', constants.COLOR_STATUS_TEXT, 2.0);
				return;
			case 'rejected':
			case 'failed':
				logOutput.log(LogLevel.Error, result.error instanceof Error ? result.error.message : String(result.error));
				editor.handleRuntimeTaskError(result.error, 'Failed to reboot game');
				return;
			case 'cancelled':
				return;
		}
	});
	return operation;
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
