import type { ResourcePanelController } from '../contrib/resources/panel/controller';
import * as constants from '../../common/constants';
import { getWorkbenchStatusLayout, getStatusMessageLines, HOST_FAILURE_STATUS } from '../common/layout';
import { editorFeedbackState } from '../../common/feedback_state';
import { drawEditorText } from '../../editor/render/text_renderer';
import { measureText } from '../../editor/common/text/layout';
import { api } from '../../runtime/overlay_api';
import { editorViewState } from '../../editor/ui/view/state';
import { problemsPanel } from '../contrib/problems/panel/controller';
import type { RuntimeFaultState } from '../../runtime/fault_state';
import type { EditorPane } from '../services/editor/editor_pane';
import type { EditorInput } from '../ui/tab/model';
import type { RuntimeLuaEvaluation } from '../../runtime/lua_evaluation';
import type { StudioServerConnectionState } from '../common/server_connection';
import { renderServerConnection } from './server_connection';
import { inputFocus, type InputFocusTarget } from '../../input/focus';

export function renderStatusBar(
	resourcePanel: Pick<ResourcePanelController, 'focusTarget' | 'isVisible' | 'getMode' | 'getFilterMode'>,
	fault: RuntimeFaultState,
	editorPane: Pick<EditorPane<EditorInput>, 'drawStatusBar'> | null,
	evaluation: RuntimeLuaEvaluation,
	connection: StudioServerConnectionState,
	contextTarget: InputFocusTarget | null,
	windowRestoreWidth = 0,
): void {
	const hostFailed = fault.hostFrameFailure !== undefined;
	const runtimeFaulted = hostFailed || fault.faultSnapshot !== null;
	const guestInput = inputFocus.admittedTarget?.guestInput !== undefined;
	const layout = getWorkbenchStatusLayout(guestInput, hostFailed, windowRestoreWidth), bounds = layout.bounds;
	const statusTop = bounds.top, statusBottom = bounds.bottom;
	const statusBackground = constants.COLOR_STATUS_BACKGROUND;
	api.fill_rect(0, statusTop, editorViewState.viewportWidth, statusBottom, 0, statusBackground);
	if (runtimeFaulted) {
		const accentHeightCandidate = (editorViewState.lineHeight / 6) | 0;
		const accentHeight = accentHeightCandidate > 2 ? accentHeightCandidate : 2;
		const accentBottomCandidate = statusTop + accentHeight;
		const accentBottom = accentBottomCandidate < statusBottom ? accentBottomCandidate : statusBottom;
		api.fill_rect(0, statusTop, editorViewState.viewportWidth, accentBottom, 0, constants.COLOR_STATUS_FAULT_MARKER);
	}
	const statusTextColor = runtimeFaulted ? constants.STATUS_MESSAGE_TEXT_COLORS.error : constants.COLOR_STATUS_TEXT;
	if (editorFeedbackState.message.visible) {
		const message = layout.message;
		api.pushClipRect(message.left, message.top, message.right, message.bottom);
		const lines = getStatusMessageLines();
		let textY = message.top + 2;
		const textX = message.left + 4;
		for (let i = 0; i < lines.length; i += 1) {
			drawEditorText(editorViewState.font, lines[i], textX, textY, 0, constants.STATUS_MESSAGE_TEXT_COLORS[editorFeedbackState.message.kind]);
			textY += editorViewState.lineHeight;
		}
		api.popClipRect();
	}
	if (hostFailed) {
		const prefix = layout.hostFault;
		api.pushClipRect(prefix.left, prefix.top, prefix.right, prefix.bottom);
		drawEditorText(editorViewState.font, HOST_FAILURE_STATUS, prefix.left + 4, prefix.top + 2, 0, constants.STATUS_MESSAGE_TEXT_COLORS.error);
		api.popClipRect();
	}
	const context = layout.context;
	api.pushClipRect(context.left, context.top, context.right, context.bottom);
	if (!runtimeFaulted && evaluation.active !== undefined) {
		drawEditorText(editorViewState.font, evaluation.paused ? 'LUA CALL PAUSED' : 'LUA CALL RUNNING', context.left + 4, context.top + 2, 0, statusTextColor);
	} else if (problemsPanel.isVisible && contextTarget === problemsPanel.focusTarget) {
		const diagnostic = problemsPanel.selectedDiagnostic;
		if (diagnostic !== null) {
			const info = `Ln ${diagnostic.row + 1}, Col ${diagnostic.startColumn + 1} • ${diagnostic.model.identity.path}`;
			drawEditorText(editorViewState.font, info, context.left + 4, context.top + 2, 0, statusTextColor);
		}
	} else if (resourcePanel.isVisible() && contextTarget === resourcePanel.focusTarget) {
		if (resourcePanel.getMode() === 'command') {
			const info = 'CALL HIERARCHY';
			const hint = 'ENTER toggle/open • LEFT/RIGHT collapse/expand';
			drawEditorText(editorViewState.font, info, context.left + 4, context.top + 2, 0, statusTextColor);
			if (!guestInput) drawEditorText(editorViewState.font, hint, context.right - measureText(hint) - 4, context.top + 2, 0, statusTextColor);
		} else {
			const fileInfo = resourcePanel.getFilterMode() === 'lua_only' ? 'FILES (LUA)' : 'FILES (ALL)';
			const hint = 'CTRL+SHIFT+L TOGGLE FILTER';
			drawEditorText(editorViewState.font, fileInfo, context.left + 4, context.top + 2, 0, statusTextColor);
			if (!guestInput) drawEditorText(editorViewState.font, hint, context.right - measureText(hint) - 4, context.top + 2, 0, statusTextColor);
		}
	} else editorPane?.drawStatusBar(context, statusTextColor);
	api.popClipRect();
	if (layout.guestHintText !== '') {
		const hint = layout.guestHint;
		api.pushClipRect(hint.left, hint.top, hint.right, hint.bottom);
		drawEditorText(editorViewState.font, layout.guestHintText, hint.left + 4, hint.top + 2, 0, constants.COLOR_STATUS_TEXT);
		api.popClipRect();
	}
	renderServerConnection(connection, layout.connection.top);
}
