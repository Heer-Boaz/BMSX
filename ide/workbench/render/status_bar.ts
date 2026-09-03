import type { ResourcePanelController } from '../contrib/resources/panel/controller';
import * as constants from '../../common/constants';
import { getActiveSymbolSearchMatch } from '../contrib/code_editor/symbols/shared';
import { statusAreaHeight, getStatusMessageLines } from '../common/layout';
import { editorFeedbackState } from '../../common/feedback_state';
import { drawEditorText } from '../../editor/render/text_renderer';
import { measureText, truncateTextToWidth } from '../../editor/common/text/layout';
import { api } from '../../runtime/overlay_api';
import { editorViewState } from '../../editor/ui/view/state';
import { problemsPanel } from '../contrib/problems/panel/controller';
import { symbolSearchState } from '../contrib/code_editor/symbols/search/state';
import type { RuntimeFaultState } from '../../runtime/fault_state';
import type { EditorPane } from '../services/editor/editor_pane';
import type { EditorInput } from '../ui/tab/model';
import { buildStatusLeftInfo } from './status_bar_info';

export function renderStatusBar(
	resourcePanel: ResourcePanelController,
	fault: RuntimeFaultState,
	editorPane: EditorPane<EditorInput>,
): void {
	const runtimeFaulted = !!fault.faultSnapshot;
	const statusTop = editorViewState.viewportHeight - statusAreaHeight();
	const statusBottom = editorViewState.viewportHeight;
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

	if (editorFeedbackState.message.visible) {
		const lines = getStatusMessageLines();
		let textY = statusTop + 2;
		const textX = 4;
		for (let i = 0; i < lines.length; i += 1) {
			drawEditorText(editorViewState.font, lines[i], textX, textY, 0, constants.COLOR_STATUS_ALERT);
			textY += editorViewState.lineHeight;
		}
		return;
	}
	// When Problems panel owns the status (focused), show its info and stop
	if (problemsPanel.isVisible && problemsPanel.isFocused) {
		const statusLeftInfo = buildStatusLeftInfo();
		if (statusLeftInfo.length === 0) {
			return;
		}
		drawEditorText(editorViewState.font, statusLeftInfo, 4, statusTop + 2, 0, statusTextColor);
		return;
	}

	if (symbolSearchState.visible) {
		const match = getActiveSymbolSearchMatch();
		if (!match) return;
		const symbol = match.entry.symbol;
		const location = symbol.location;
		let displayPath = location.path ?? symbol.path ?? 'NOTHING!';
		if (!displayPath || displayPath.length === 0) {
			displayPath = symbol.name;
		}
		const range = location.range;
		const positionSuffix = range ? `:${range.startLine}:${range.startColumn}` : '';
		const fullText = `${displayPath}${positionSuffix}`;
		const maxPathWidthCandidate = editorViewState.viewportWidth - 8;
		const maxPathWidth = maxPathWidthCandidate > 0 ? maxPathWidthCandidate : 0;
		const pathText = truncateTextToWidth(fullText, maxPathWidth);
		drawEditorText(editorViewState.font, pathText, 4, statusTop + 2, 0, statusTextColor);
		return;
	}

	if (resourcePanel.isVisible()) {
		if (resourcePanel.getMode() === 'command') {
			const info = 'CALL HIERARCHY';
			const hint = 'ENTER toggle/open • LEFT/RIGHT collapse/expand';
			drawEditorText(editorViewState.font, info, 4, statusTop + 2, 0, statusTextColor);
			drawEditorText(editorViewState.font, hint, editorViewState.viewportWidth - measureText(hint) - 4, statusTop + 2, 0, statusTextColor);
			return;
		}
		const filterLabel = resourcePanel.getFilterMode() === 'lua_only' ? 'LUA' : 'ALL';
		const fileInfo = `FILES ${resourcePanel.getFilterMode()} (${filterLabel})`;
		const hint = 'CTRL+SHIFT+L TOGGLE FILTER';
		drawEditorText(editorViewState.font, fileInfo, 4, statusTop + 2, 0, statusTextColor);
		drawEditorText(editorViewState.font, hint, editorViewState.viewportWidth - measureText(hint) - 4, statusTop + 2, 0, statusTextColor);
		return;
	}

	editorPane.drawStatusBar(statusTop, statusTextColor);
}
