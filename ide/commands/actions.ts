import type { HostExecutionControl } from '../../hosts/common/execution_control';
import { editorRuntimeState } from '../editor/common/runtime_state';
import { LogLevel, type LogOutput } from '../../hosts/common/log';
import type { BootService, BootOperation } from '../workbench/services/execution/boot';
import type { HotResumeService, HotResumeOperation } from '../workbench/services/execution/hot_resume';
import { deactivateEditor } from '../workbench/overlay_modes';
import type { EditorActionRequest } from './action_request';
import * as constants from '../common/constants';
import { setEditorCaseInsensitivity } from '../editor/render/text_renderer';
import { persistWorkspaceSessionLocally } from '../workbench/workspace/storage';
import type { CartEditor } from '../cart_editor';
import type { OverlayRenderer } from '../runtime/overlay_renderer';
import { showEditorMessage } from '../common/feedback_state';
import type { RunTargetSelection } from '../workbench/services/execution/run_target';
import { navigationState } from '../navigation/navigation_history';

export function performEditorAction(
	editor: CartEditor,
	hotResumes: HotResumeService,
	boots: BootService,
	execution: HostExecutionControl,
	overlayRenderer: OverlayRenderer,
	logOutput: LogOutput,
	request: EditorActionRequest,
	runTargets: RunTargetSelection,
): boolean {
	switch (request.action) {
		case 'hot-resume':
			if (!hotResumes.acceptingRequests) return false;
			performHotResume(hotResumes, editor, execution, overlayRenderer, logOutput, runTargets, request);
			return true;
		case 'reboot':
		case 'run':
			if (!boots.acceptingRequests || request.action === 'run' && runTargets.primary === undefined) return false;
			performReboot(boots, editor, execution, overlayRenderer, logOutput, runTargets, request);
			return true;
		case 'close':
			deactivateEditor(editor, overlayRenderer);
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
	logOutput: LogOutput,
	runTargets: RunTargetSelection,
	request: Extract<EditorActionRequest, { action: 'hot-resume' }>,
): HotResumeOperation {
	persistWorkspaceSessionLocally();
	const selectionRevision = runTargets.revision;
	const operation = hotResumes.resume();
	showEditorMessage('Hot Resume: pending', 'info', 2.0);
	void operation.admission.then(admission => {
		if (hotResumes.latestOperation !== operation || admission.status !== 'accepted'
			|| operation.result !== null && operation.result.status !== 'completed') return;
		const presentation = request.presentation;
		if (selectionRevision !== runTargets.revision || presentation !== undefined
			&& (navigationState.activeOwner !== presentation.group || presentation.generation !== presentation.group.panes.openGeneration)) return;
		execution.requestExecution(true);
		if (presentation !== undefined) deactivateEditor(editor, overlayRenderer);
	});
	void operation.completion.then(result => {
		if (hotResumes.latestOperation !== operation) return;
		switch (result.status) {
			case 'completed':
				showEditorMessage('Hot Resume: code applied', 'info', 2.0);
				return;
			case 'rejected':
			case 'failed':
				logOutput.log(LogLevel.Error, result.error instanceof Error ? result.error.message : String(result.error));
				editor.handleRuntimeTaskError(result.error, 'Failed to resume game');
				return;
			case 'faulted':
				// The stack/overlay remains owned by the supervisor observation.
				showEditorMessage('Hot Resume: guest fault', 'error', 2.0);
				return;
			case 'cancelled':
				showEditorMessage('Hot Resume: cancelled', 'info', 2.0);
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
	logOutput: LogOutput,
	runTargets: RunTargetSelection,
	request: Extract<EditorActionRequest, { action: 'run' | 'reboot' }>,
): BootOperation {
	persistWorkspaceSessionLocally();
	const selectionRevision = runTargets.revision;
	const operation = boots.reboot(request.action === 'run' ? request.entry : undefined);
	showEditorMessage('Reboot: pending', 'info', 2.0);
	void operation.completion.then(result => {
		if (boots.latestOperation !== operation) return;
		switch (result.status) {
			case 'reset': {
				const primary = runTargets.primary;
				const admitted = request.action === 'run'
					? primary !== undefined && runTargets.complete(request.selectionRequest, primary)
					: selectionRevision === runTargets.revision;
				const presentation = request.presentation;
				if (admitted && (presentation === undefined || navigationState.activeOwner === presentation.group
					&& presentation.generation === presentation.group.panes.openGeneration)) {
					execution.requestExecution(true);
					if (presentation !== undefined) deactivateEditor(editor, overlayRenderer);
				}
				showEditorMessage('Reboot: reset complete', 'info', 2.0);
				return;
			}
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
}
