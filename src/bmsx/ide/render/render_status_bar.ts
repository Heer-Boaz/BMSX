import * as constants from '../core/constants';
import { getActiveSymbolSearchMatch } from '../contrib/symbols/symbol_search_shared';
import { statusAreaHeight, getStatusMessageLines } from '../ui/editor_view';
import { getActiveCodeTabContext, isCodeTabActive, isResourceViewActive } from '../ui/editor_tabs';
import { ide_state } from '../core/ide_state';
import { editorFeedbackState } from '../core/editor_feedback_state';
import { getActiveResourceViewer } from '../contrib/resources/resource_viewer';
import { drawEditorText } from './text_renderer';
import { measureText, truncateTextToWidth } from '../core/text_utils';
import { Runtime } from '../../emulator/runtime';
import { api } from '../ui/view/overlay_api';
import { workspaceState } from '../core/workspace_storage';
import { editorDocumentState } from '../editing/editor_document_state';
import { editorViewState } from '../ui/editor_view_state';

export function renderStatusBar(): void {
	const runtime = Runtime.instance;
	const runtimeFaulted = runtime ? runtime.hasRuntimeFailed : false;
	const statusTop = editorViewState.viewportHeight - statusAreaHeight();
	const statusBottom = editorViewState.viewportHeight;
	const statusBackground = constants.COLOR_STATUS_BACKGROUND;
	api.fill_rect(0, statusTop, editorViewState.viewportWidth, statusBottom, undefined, statusBackground);
	if (runtimeFaulted) {
		const accentHeight = Math.max(2, Math.trunc(editorViewState.lineHeight / 6));
		const accentBottom = Math.min(statusBottom, statusTop + accentHeight);
		api.fill_rect_color(0, statusTop, editorViewState.viewportWidth, accentBottom, undefined, constants.COLOR_STATUS_WARNING);
	}
	const statusTextColor = runtimeFaulted ? constants.COLOR_STATUS_ALERT : constants.COLOR_STATUS_TEXT;

	if (editorFeedbackState.message.visible) {
		const lines = getStatusMessageLines();
		let textY = statusTop + 2;
		const textX = 4;
		for (let i = 0; i < lines.length; i += 1) {
			drawEditorText(editorViewState.font, lines[i], textX, textY, undefined, constants.COLOR_STATUS_ALERT);
			textY += editorViewState.lineHeight;
		}
		return;
	}
	const statusLeftInfo = buildStatusLeftInfo();
	// When Problems panel owns the status (focused), show its info and stop
	if (ide_state.problemsPanel.isVisible && ide_state.problemsPanel.isFocused && statusLeftInfo && statusLeftInfo.length > 0) {
		drawEditorText(editorViewState.font, statusLeftInfo, 4, statusTop + 2, undefined, statusTextColor);
		return;
	}

	if (ide_state.symbolSearch.visible) {
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
		const pathText = truncateTextToWidth(fullText, Math.max(0, editorViewState.viewportWidth - 8));
		drawEditorText(editorViewState.font, pathText, 4, statusTop + 2, undefined, statusTextColor);
		return;
	}

	if (ide_state.resourcePanel.isVisible()) {
		if (ide_state.resourcePanel.getMode() === 'call_hierarchy') {
			const info = 'CALL HIERARCHY';
			const hint = 'ENTER toggle/open • LEFT/RIGHT collapse/expand';
			drawEditorText(editorViewState.font, info, 4, statusTop + 2, undefined, statusTextColor);
			drawEditorText(editorViewState.font, hint, editorViewState.viewportWidth - measureText(hint) - 4, statusTop + 2, undefined, statusTextColor);
			return;
		}
		const filterLabel = ide_state.resourcePanel.getFilterMode() === 'lua_only' ? 'LUA' : 'ALL';
		const fileInfo = `FILES ${ide_state.resourcePanel.getFilterMode()} (${filterLabel})`;
		const hint = 'CTRL+SHIFT+L TOGGLE FILTER';
		drawEditorText(editorViewState.font, fileInfo, 4, statusTop + 2, undefined, statusTextColor);
		drawEditorText(editorViewState.font, hint, editorViewState.viewportWidth - measureText(hint) - 4, statusTop + 2, undefined, statusTextColor);
		return;
	}

	if (isResourceViewActive()) {
		const viewer = getActiveResourceViewer();
		const info = viewer ? `${viewer.descriptor.type.toUpperCase()} ${viewer.descriptor.asset_id}` : 'RESOURCE';
		const detail = viewer ? viewer.descriptor.path : '';
		drawEditorText(editorViewState.font, info, 4, statusTop + 2, undefined, statusTextColor);
		if (detail.length > 0) {
			drawEditorText(editorViewState.font, detail, editorViewState.viewportWidth - measureText(detail) - 4, statusTop + 2, undefined, statusTextColor);
		}
		return;
	}

	// Draw filename info on the right. The line/col info remains rendered by the editor for now.
	// const filenameInfo = `${ide_state.metadata.title || 'UNTITLED'}.lua`;
	const leftX = 0;
	const glyphSize = measureText('•');
	const indicatorColor = workspaceState.serverConnected ? constants.COLOR_SERVER_STATUS_CONNECTED : constants.COLOR_SERVER_STATUS_DISCONNECTED;
	drawEditorText(editorViewState.font, '•', leftX, statusTop + 2, undefined, indicatorColor);
	let textX = leftX + glyphSize;
	if (statusLeftInfo && statusLeftInfo.length > 0) {
		drawEditorText(editorViewState.font, statusLeftInfo, textX, statusTop + 2, undefined, statusTextColor);
	}
	if (isCodeTabActive()) {
		const context = getActiveCodeTabContext();
		let detail = '';
		let detailColor = statusTextColor;
		if (context.runtimeSyncState === 'diverged') {
			detail = 'SAVED, RUNTIME NOT APPLIED';
			detailColor = constants.COLOR_STATUS_WARNING;
		} else if (context.runtimeSyncState === 'restart_pending') {
			detail = 'RESTART PENDING';
		}
		if (detail.length > 0) {
			drawEditorText(editorViewState.font, detail, editorViewState.viewportWidth - measureText(detail) - 4, statusTop + 2, undefined, detailColor);
		}
	}
	// drawEditorText(api, editorViewState.font, filenameInfo, editorViewState.viewportWidth - measureText(filenameInfo) - 4, statusTop + 2, undefined, constants.COLOR_STATUS_TEXT);
}

export function buildStatusLeftInfo(): string {
	if (ide_state.problemsPanel.isVisible) {
		if (ide_state.problemsPanel.isFocused) {
			const sel = ide_state.problemsPanel.selectedDiagnostic;
			if (sel) {
				const file = sel.sourceLabel ?? (sel.path ?? '');
				const parts: string[] = [];
				parts.push(`Ln ${sel.row + 1}, Col ${sel.startColumn + 1}`);
				if (file.length > 0) parts.push(file);
				return parts.join(' • ');
			}
		}
		// When Problems panel is visible but not focused or no selection, don't render default editor position
		return '';
	}
	return `LINE ${editorDocumentState.cursorRow + 1}/${editorDocumentState.buffer.getLineCount()} COL ${editorDocumentState.cursorColumn + 1}`;
}
