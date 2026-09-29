import type { ResourcePanelController } from '../contrib/resources/panel/controller';
import * as constants from '../../common/constants';
import { getWorkbenchStatusBounds, getStatusMessageLines } from '../common/layout';
import { editorFeedbackState } from '../../common/feedback_state';
import { drawEditorText } from '../../editor/render/text_renderer';
import { measureText } from '../../editor/common/text/layout';
import { api } from '../../runtime/overlay_api';
import { editorViewState } from '../../editor/ui/view/state';
import { problemsPanel } from '../contrib/problems/panel/controller';
import type { RuntimeFaultState } from '../../runtime/fault_state';
import type { EditorPane } from '../services/editor/editor_pane';
import type { EditorInput } from '../ui/tab/model';
import { buildStatusLeftInfo } from './status_bar_info';
import type { RuntimeDebuggerPlanManager } from '../../runtime/debugger_plans';
import type { StudioServerConnectionState } from '../common/server_connection';
import { renderServerConnection } from './server_connection';

export function renderStatusBar(
	resourcePanel: ResourcePanelController,
	fault: RuntimeFaultState,
	editorPane: EditorPane<EditorInput> | null,
	plans: RuntimeDebuggerPlanManager,
	connection: StudioServerConnectionState,
): void {
	const runtimeFaulted = !!fault.faultSnapshot;
	const bounds = getWorkbenchStatusBounds();
	const statusTop = bounds.top, statusBottom = bounds.bottom;
	const statusBackground = constants.COLOR_STATUS_BACKGROUND;
	api.fill_rect(0, statusTop, editorViewState.viewportWidth, statusBottom, 0, statusBackground);
	if (runtimeFaulted) {
		const accentHeightCandidate = (editorViewState.lineHeight / 6) | 0;
		const accentHeight = accentHeightCandidate > 2 ? accentHeightCandidate : 2;
		const accentBottomCandidate = statusTop + accentHeight;
		const accentBottom = accentBottomCandidate < statusBottom ? accentBottomCandidate : statusBottom;
		api.fill_rect(0, statusTop, editorViewState.viewportWidth, accentBottom, 0, constants.COLOR_STATUS_WARNING);
	}
	const statusTextColor = runtimeFaulted ? constants.COLOR_STATUS_ALERT : constants.COLOR_STATUS_TEXT;
	api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
	if (!runtimeFaulted && plans.workbenchControlActive) {
		drawEditorText(editorViewState.font, plans.controlSuspended ? 'LUA CALL PAUSED' : 'LUA CALL RUNNING', bounds.left + 4, statusTop + 2, 0, statusTextColor);
	} else if (editorFeedbackState.message.visible) {
		const lines = getStatusMessageLines();
		let textY = statusTop + 2;
		const textX = bounds.left + 4;
		for (let i = 0; i < lines.length; i += 1) {
			drawEditorText(editorViewState.font, lines[i], textX, textY, 0, editorFeedbackState.message.color);
			textY += editorViewState.lineHeight;
		}
	} else if (problemsPanel.isVisible && problemsPanel.isFocused) {
		const statusLeftInfo = buildStatusLeftInfo();
		if (statusLeftInfo.length > 0) {
			drawEditorText(editorViewState.font, statusLeftInfo, bounds.left + 4, statusTop + 2, 0, statusTextColor);
		}
	} else if (resourcePanel.isVisible()) {
		if (resourcePanel.getMode() === 'command') {
			const info = 'CALL HIERARCHY';
			const hint = 'ENTER toggle/open • LEFT/RIGHT collapse/expand';
			drawEditorText(editorViewState.font, info, bounds.left + 4, statusTop + 2, 0, statusTextColor);
			drawEditorText(editorViewState.font, hint, bounds.right - measureText(hint) - 4, statusTop + 2, 0, statusTextColor);
		} else {
			const filterLabel = resourcePanel.getFilterMode() === 'lua_only' ? 'LUA' : 'ALL';
			const fileInfo = `FILES ${resourcePanel.getFilterMode()} (${filterLabel})`;
			const hint = 'CTRL+SHIFT+L TOGGLE FILTER';
			drawEditorText(editorViewState.font, fileInfo, bounds.left + 4, statusTop + 2, 0, statusTextColor);
			drawEditorText(editorViewState.font, hint, bounds.right - measureText(hint) - 4, statusTop + 2, 0, statusTextColor);
		}
	} else editorPane?.drawStatusBar(bounds, statusTextColor);
	api.popClipRect();
	renderServerConnection(connection, statusTop);
}
