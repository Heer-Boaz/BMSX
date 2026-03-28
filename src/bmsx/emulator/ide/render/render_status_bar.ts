import * as constants from '../constants';
import { getActiveSymbolSearchMatch } from '../cart_editor';
import { statusAreaHeight, getStatusMessageLines } from '../editor_view';
import { isResourceViewActive } from '../editor_tabs';
import { ide_state } from '../ide_state';
import { getActiveResourceViewer } from '../resource_viewer';
import { drawEditorText } from '../text_renderer';
import { measureText, truncateTextToWidth } from '../text_utils';
import { api, Runtime } from '../../runtime';

export function renderStatusBar(): void {
	const runtime = Runtime.instance;
	const runtimeFaulted = runtime ? runtime.hasRuntimeFailed : false;
	const statusTop = ide_state.viewportHeight - statusAreaHeight();
	const statusBottom = ide_state.viewportHeight;
	const statusBackground = constants.COLOR_STATUS_BACKGROUND;
	api.fill_rect(0, statusTop, ide_state.viewportWidth, statusBottom, undefined, statusBackground);
	if (runtimeFaulted) {
		const accentHeight = Math.max(2, Math.floor(ide_state.lineHeight / 6));
		const accentBottom = Math.min(statusBottom, statusTop + accentHeight);
		api.fill_rect_color(0, statusTop, ide_state.viewportWidth, accentBottom, undefined, constants.COLOR_STATUS_WARNING);
	}
	const statusTextColor = runtimeFaulted ? constants.COLOR_STATUS_ALERT : constants.COLOR_STATUS_TEXT;

	if (ide_state.message.visible) {
		const lines = getStatusMessageLines();
		let textY = statusTop + 2;
		const textX = 4;
		for (let i = 0; i < lines.length; i += 1) {
			drawEditorText(ide_state.font, lines[i], textX, textY, undefined, constants.COLOR_STATUS_ALERT);
			textY += ide_state.lineHeight;
		}
		return;
	}
	const statusLeftInfo = buildStatusLeftInfo();
	// When Problems panel owns the status (focused), show its info and stop
	if (ide_state.problemsPanel.isVisible && ide_state.problemsPanel.isFocused && statusLeftInfo && statusLeftInfo.length > 0) {
		drawEditorText(ide_state.font, statusLeftInfo, 4, statusTop + 2, undefined, statusTextColor);
		return;
	}

	if (ide_state.symbolSearchVisible) {
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
		const pathText = truncateTextToWidth(fullText, Math.max(0, ide_state.viewportWidth - 8));
		drawEditorText(ide_state.font, pathText, 4, statusTop + 2, undefined, statusTextColor);
		return;
	}

	if (ide_state.resourcePanelVisible) {
		if (ide_state.resourcePanel.getMode() === 'call_hierarchy') {
			const info = 'CALL HIERARCHY';
			const hint = 'ENTER toggle/open • LEFT/RIGHT collapse/expand';
			drawEditorText(ide_state.font, info, 4, statusTop + 2, undefined, statusTextColor);
			drawEditorText(ide_state.font, hint, ide_state.viewportWidth - measureText(hint) - 4, statusTop + 2, undefined, statusTextColor);
			return;
		}
		const filterLabel = ide_state.resourcePanel.getFilterMode() === 'lua_only' ? 'LUA' : 'ALL';
		const fileInfo = `FILES ${ide_state.resourcePanel.getFilterMode()} (${filterLabel})`;
		const hint = 'CTRL+SHIFT+L TOGGLE FILTER';
		drawEditorText(ide_state.font, fileInfo, 4, statusTop + 2, undefined, statusTextColor);
		drawEditorText(ide_state.font, hint, ide_state.viewportWidth - measureText(hint) - 4, statusTop + 2, undefined, statusTextColor);
		return;
	}

	if (isResourceViewActive()) {
		const viewer = getActiveResourceViewer();
		const info = viewer ? `${viewer.descriptor.type.toUpperCase()} ${viewer.descriptor.asset_id}` : 'RESOURCE';
		const detail = viewer ? viewer.descriptor.path : '';
		drawEditorText(ide_state.font, info, 4, statusTop + 2, undefined, statusTextColor);
		if (detail.length > 0) {
			drawEditorText(ide_state.font, detail, ide_state.viewportWidth - measureText(detail) - 4, statusTop + 2, undefined, statusTextColor);
		}
		return;
	}

	// Draw filename info on the right. The line/col info remains rendered by the editor for now.
	// const filenameInfo = `${ide_state.metadata.title || 'UNTITLED'}.lua`;
	const leftX = 0;
	const glyphSize = measureText('•');
	const indicatorColor = ide_state.serverWorkspaceConnected ? constants.COLOR_SERVER_STATUS_CONNECTED : constants.COLOR_SERVER_STATUS_DISCONNECTED;
	drawEditorText(ide_state.font, '•', leftX, statusTop + 2, undefined, indicatorColor);
	let textX = leftX + glyphSize;
	if (statusLeftInfo && statusLeftInfo.length > 0) {
		drawEditorText(ide_state.font, statusLeftInfo, textX, statusTop + 2, undefined, statusTextColor);
	}
	// drawEditorText(api, ide_state.font, filenameInfo, ide_state.viewportWidth - measureText(filenameInfo) - 4, statusTop + 2, undefined, constants.COLOR_STATUS_TEXT);
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
	return `LINE ${ide_state.cursorRow + 1}/${ide_state.buffer.getLineCount()} COL ${ide_state.cursorColumn + 1}`;
}
