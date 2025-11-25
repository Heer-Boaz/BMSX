import { BmsxConsoleApi } from '../../api';
import * as constants from '../constants';
import type { BmsxConsoleMetadata, ConsoleLuaSymbolEntry } from '../../types';
import { statusAreaHeight, getStatusMessageLines, getActiveSymbolSearchMatch, getActiveResourceViewer } from '../console_cart_editor';
import { isResourceViewActive } from '../editor_tabs';
import { ide_state } from '../ide_state';
import { drawEditorText } from '../text_renderer';
import { measureText, truncateTextToWidth } from '../text_utils';

// const STATUS_LOG_PREFIX = '[IDE Status]';

export interface StatusBarHost {
	viewportWidth: number;
	viewportHeight: number;
	bottomMargin: number;
	lineHeight: number;
	measureText: (text: string) => number;
	drawText: (api: BmsxConsoleApi, text: string, x: number, y: number, color: number) => void;
	truncateTextToWidth: (text: string, maxWidth: number) => string;
	message: { visible: boolean };
	getStatusMessageLines: () => string[];
	symbolSearchVisible: boolean;
	getActiveSymbolSearchMatch: () => { entry: { symbol: ConsoleLuaSymbolEntry } } | null;
	resourcePanelVisible: boolean;
	resourcePanelFilterMode: 'lua_only' | 'all';
	resourcePanelResourceCount: number;
	isResourceViewActive: () => boolean;
	getActiveResourceViewer: () => { descriptor: { type: string; asset_id: string; path: string } } | null;
	metadata: BmsxConsoleMetadata;
	statusLeftInfo?: string | null;
	serverConnected: boolean;
	debugPauseActive: boolean;
	// When the problems panel is focused, override status bar left text
	problemsPanelFocused?: boolean;
}

export function renderStatusBar(api: BmsxConsoleApi, host: StatusBarHost): void {
	const statusTop = host.viewportHeight - host.bottomMargin;
	const statusBottom = host.viewportHeight;
	api.rectfill(0, statusTop, host.viewportWidth, statusBottom, constants.COLOR_STATUS_BACKGROUND);

	if (host.message.visible) {
		const lines = host.getStatusMessageLines();
		let textY = statusTop + 2;
		const textX = 4;
		for (let i = 0; i < lines.length; i += 1) {
			host.drawText(api, lines[i], textX, textY, constants.COLOR_STATUS_ALERT);
			textY += host.lineHeight;
		}
		return;
	}

	// When Problems panel owns the status (focused), show its info and stop
	if (host.problemsPanelFocused && host.statusLeftInfo && host.statusLeftInfo.length > 0) {
		host.drawText(api, host.statusLeftInfo, 4, statusTop + 2, constants.COLOR_STATUS_TEXT);
		return;
	}

	if (host.symbolSearchVisible) {
		const match = host.getActiveSymbolSearchMatch();
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
		const pathText = host.truncateTextToWidth(fullText, Math.max(0, host.viewportWidth - 8));
		host.drawText(api, pathText, 4, statusTop + 2, constants.COLOR_STATUS_TEXT);
		return;
	}

	if (host.resourcePanelVisible) {
		const filterLabel = host.resourcePanelFilterMode === 'lua_only' ? 'LUA' : 'ALL';
		const fileInfo = `FILES ${host.resourcePanelResourceCount} (${filterLabel})`;
		const hint = 'CTRL+SHIFT+L TOGGLE FILTER';
		host.drawText(api, fileInfo, 4, statusTop + 2, constants.COLOR_STATUS_TEXT);
		host.drawText(api, hint, host.viewportWidth - host.measureText(hint) - 4, statusTop + 2, constants.COLOR_STATUS_TEXT);
		return;
	}

	if (host.isResourceViewActive()) {
		const viewer = host.getActiveResourceViewer();
		const info = viewer ? `${viewer.descriptor.type.toUpperCase()} ${viewer.descriptor.asset_id}` : 'RESOURCE';
		const detail = viewer ? viewer.descriptor.path : '';
		host.drawText(api, info, 4, statusTop + 2, constants.COLOR_STATUS_TEXT);
		if (detail.length > 0) {
			host.drawText(api, detail, host.viewportWidth - host.measureText(detail) - 4, statusTop + 2, constants.COLOR_STATUS_TEXT);
		}
		return;
	}

	// Draw filename info on the right. The line/col info remains rendered by the editor for now.
	const filenameInfo = `${host.metadata.title || 'UNTITLED'}.lua`;
	const leftX = 0;
	const glyphSize = host.measureText('•');
	const indicatorColor = host.serverConnected ? constants.COLOR_SERVER_STATUS_CONNECTED : constants.COLOR_SERVER_STATUS_DISCONNECTED;
	host.drawText(api, '•', leftX, statusTop + 2, indicatorColor);
	let textX = leftX + glyphSize;
	if (host.statusLeftInfo && host.statusLeftInfo.length > 0) {
		host.drawText(api, host.statusLeftInfo, textX, statusTop + 2, constants.COLOR_STATUS_TEXT);
		// if (host.debugPauseActive) {
			// console.log(`${STATUS_LOG_PREFIX} ${host.statusLeftInfo}`);
		// }
	}
	host.drawText(api, filenameInfo, host.viewportWidth - host.measureText(filenameInfo) - 4, statusTop + 2, constants.COLOR_STATUS_TEXT);
}export function drawStatusBar(api: BmsxConsoleApi): void {
	const host = {
		viewportWidth: ide_state.viewportWidth,
		viewportHeight: ide_state.viewportHeight,
		bottomMargin: statusAreaHeight(),
		lineHeight: ide_state.lineHeight,
		measureText: (text: string) => measureText(text),
		drawText: (api2: BmsxConsoleApi, text: string, x: number, y: number, color: number) => drawEditorText(api2, ide_state.font, text, x, y, color),
		truncateTextToWidth: (text: string, maxWidth: number) => truncateTextToWidth(text, maxWidth, (ch) => ide_state.font.advance(ch), ide_state.spaceAdvance),
		message: ide_state.message,
		getStatusMessageLines: () => getStatusMessageLines(),
		symbolSearchVisible: ide_state.symbolSearchVisible,
		getActiveSymbolSearchMatch: () => getActiveSymbolSearchMatch(),
		resourcePanelVisible: ide_state.resourcePanelVisible,
		resourcePanelFilterMode: ide_state.resourcePanel.getFilterMode(),
		resourcePanelResourceCount: ide_state.resourcePanelResourceCount,
		isResourceViewActive: () => isResourceViewActive(),
		getActiveResourceViewer: () => getActiveResourceViewer(),
		metadata: ide_state.metadata,
		statusLeftInfo: buildStatusLeftInfo(),
		serverConnected: ide_state.serverWorkspaceConnected,
		debugPauseActive: ide_state.executionStopRow !== null,
		problemsPanelFocused: ide_state.problemsPanel.isVisible() && ide_state.problemsPanel.isFocused(),
	};
	renderStatusBar(api, host);
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

