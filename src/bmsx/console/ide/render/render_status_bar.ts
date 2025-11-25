import * as constants from '../constants';
import { statusAreaHeight, getStatusMessageLines, getActiveSymbolSearchMatch, getActiveResourceViewer } from '../console_cart_editor';
import { isResourceViewActive } from '../editor_tabs';
import { ide_state } from '../ide_state';
import { drawEditorText } from '../text_renderer';
import { measureText, truncateTextToWidth } from '../text_utils';
import { api } from '../../runtime';

export function renderStatusBar(): void {
	const statusTop = ide_state.viewportHeight - statusAreaHeight();
	const statusBottom = ide_state.viewportHeight;
	api.rectfill(0, statusTop, ide_state.viewportWidth, statusBottom, undefined, constants.COLOR_STATUS_BACKGROUND);

	if (ide_state.message.visible) {
		const lines = getStatusMessageLines();
		let textY = statusTop + 2;
		const textX = 4;
		for (let i = 0; i < lines.length; i += 1) {
			drawEditorText(api, ide_state.font, lines[i], textX, textY, undefined, constants.COLOR_STATUS_ALERT);
			textY += ide_state.lineHeight;
		}
		return;
	}
	const statusLeftInfo = buildStatusLeftInfo();
	// When Problems panel owns the status (focused), show its info and stop
	if (ide_state.problemsPanel.isVisible() && ide_state.problemsPanel.isFocused() && statusLeftInfo && statusLeftInfo.length > 0) {
		drawEditorText(api, ide_state.font, statusLeftInfo, 4, statusTop + 2, undefined, constants.COLOR_STATUS_TEXT);
		return;
	}

	if (ide_state.symbolSearchVisible) {
		const match = getActiveSymbolSearchMatch();
		if (!match) return;
		const symbol = match.entry.symbol;
		const location = symbol.location;
		let displayPath = location.path ?? symbol.path ?? location.chunkName ?? location.asset_id ?? '';
		if (!displayPath || displayPath.length === 0) {
			displayPath = symbol.name;
		}
		const range = location.range;
		const positionSuffix = range ? `:${range.startLine}:${range.startColumn}` : '';
		const fullText = `${displayPath}${positionSuffix}`;
		const pathText = truncateTextToWidth(fullText, Math.max(0, ide_state.viewportWidth - 8), (ch) => ide_state.font.advance(ch), ide_state.spaceAdvance);
		drawEditorText(api, ide_state.font, pathText, 4, statusTop + 2, undefined, constants.COLOR_STATUS_TEXT);
		return;
	}

	if (ide_state.resourcePanelVisible) {
		const filterLabel = ide_state.resourcePanel.getFilterMode() === 'lua_only' ? 'LUA' : 'ALL';
		const fileInfo = `FILES ${ide_state.resourcePanel.getFilterMode()} (${filterLabel})`;
		const hint = 'CTRL+SHIFT+L TOGGLE FILTER';
		drawEditorText(api, ide_state.font, fileInfo, 4, statusTop + 2, undefined, constants.COLOR_STATUS_TEXT);
		drawEditorText(api, ide_state.font, hint, ide_state.viewportWidth - measureText(hint) - 4, statusTop + 2, undefined, constants.COLOR_STATUS_TEXT);
		return;
	}

	if (isResourceViewActive()) {
		const viewer = getActiveResourceViewer();
		const info = viewer ? `${viewer.descriptor.type.toUpperCase()} ${viewer.descriptor.asset_id}` : 'RESOURCE';
		const detail = viewer ? viewer.descriptor.path : '';
		drawEditorText(api, ide_state.font, info, 4, statusTop + 2, undefined, constants.COLOR_STATUS_TEXT);
		if (detail.length > 0) {
			drawEditorText(api, ide_state.font, detail, ide_state.viewportWidth - measureText(detail) - 4, statusTop + 2, undefined, constants.COLOR_STATUS_TEXT);
		}
		return;
	}

	// Draw filename info on the right. The line/col info remains rendered by the editor for now.
	const filenameInfo = `${ide_state.metadata.title || 'UNTITLED'}.lua`;
	const leftX = 0;
	const glyphSize = measureText('•');
	const indicatorColor = ide_state.serverWorkspaceConnected ? constants.COLOR_SERVER_STATUS_CONNECTED : constants.COLOR_SERVER_STATUS_DISCONNECTED;
	drawEditorText(api, ide_state.font, '•', leftX, statusTop + 2, undefined, indicatorColor);
	let textX = leftX + glyphSize;
	if (statusLeftInfo && statusLeftInfo.length > 0) {
		drawEditorText(api, ide_state.font, statusLeftInfo, textX, statusTop + 2, undefined, constants.COLOR_STATUS_TEXT);
	}
	drawEditorText(api, ide_state.font, filenameInfo, ide_state.viewportWidth - measureText(filenameInfo) - 4, statusTop + 2, undefined, constants.COLOR_STATUS_TEXT);
}

export function buildStatusLeftInfo(): string {
	if (ide_state.problemsPanel.isVisible()) {
		if (ide_state.problemsPanel.isFocused()) {
			const sel = ide_state.problemsPanel.getSelectedDiagnostic();
			if (sel) {
				const file = sel.sourceLabel ?? (sel.chunkName ?? '');
				const parts: string[] = [];
				parts.push(`Ln ${sel.row + 1}, Col ${sel.startColumn + 1}`);
				if (file.length > 0) parts.push(file);
				return parts.join(' • ');
			}
		}
		// When Problems panel is visible but not focused or no selection, don't render default editor position
		return '';
	}
	return `LINE ${ide_state.cursorRow + 1}/${ide_state.lines.length} COL ${ide_state.cursorColumn + 1}`;
}

