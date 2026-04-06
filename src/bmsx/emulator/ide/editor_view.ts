import { $ } from '../../core/engine_core';
import { clamp } from '../../utils/clamp';
import { lower_bound } from '../../utils/lower_bound';
import { EditorFont } from '../editor_font';
import type { FontVariant } from '../font';
import type { Viewport } from '../../rompack/rompack';
import type { ResourceDescriptor } from '../types';
import * as constants from './constants';
import { CodeLayout } from './code_layout';
import { markDiagnosticsDirty } from './diagnostics';
import { computeSearchPageStats } from './editor_search';
import { ide_state } from './ide_state';
import { requestSemanticRefresh } from './intellisense';
import { ensureCursorVisible } from './caret';
import { splitText } from './text/source_text';
import {
	ensureVisualLines,
	getVisualLineCount,
	measureText,
	positionToVisualIndex,
	rewrapRuntimeErrorOverlays,
	visibleColumnCount,
	visibleRowCount,
	visualIndexToSegment,
	wrapOverlayLine,
} from './text_utils';
import { getBuiltinIdentifiersSnapshot, updateDesiredColumn } from './cart_editor';

function decimalDigitCount(value: number): number {
	let digits = 1;
	let remaining = Math.max(1, value);
	while (remaining >= 10) {
		remaining = Math.floor(remaining / 10);
		digits += 1;
	}
	return digits;
}

export function getBreakpointLaneWidth(): number {
	return Math.max(6, Math.floor(ide_state.charAdvance + 2));
}

export function updateGutterWidth(): number {
	const lineCount = ide_state.buffer.getLineCount();
	const digitCount = Math.max(2, decimalDigitCount(lineCount));
	ide_state.gutterWidth = getBreakpointLaneWidth() + 4 + digitCount * ide_state.font.advance('0');
	return ide_state.gutterWidth;
}

export function maximumLineLength(): number {
	if (!ide_state.maxLineLengthDirty) {
		return ide_state.maxLineLength;
	}
	let maxLength = 0;
	let maxRow = 0;
	const lineCount = ide_state.buffer.getLineCount();
	for (let i = 0; i < lineCount; i += 1) {
		const length = ide_state.buffer.getLineEndOffset(i) - ide_state.buffer.getLineStartOffset(i);
		if (length > maxLength) {
			maxLength = length;
			maxRow = i;
		}
	}
	ide_state.maxLineLength = maxLength;
	ide_state.maxLineLengthRow = maxRow;
	ide_state.maxLineLengthDirty = false;
	return maxLength;
}

export function computeMaximumScrollColumn(): number {
	const limit = maximumLineLength() - visibleColumnCount();
	if (limit <= 0) {
		return 0;
	}
	return limit;
}

export function searchVisibleResultCount(): number {
	return computeSearchPageStats().visible;
}

export function searchResultEntryHeight(): number {
	return ide_state.lineHeight * 2;
}

export function isResourceSearchCompactMode(): boolean {
	return ide_state.viewportWidth <= constants.SYMBOL_SEARCH_COMPACT_WIDTH;
}

export function resourceSearchEntryHeight(): number {
	return isResourceSearchCompactMode() ? ide_state.lineHeight * 2 : ide_state.lineHeight;
}

export function resourceSearchPageSize(): number {
	return isResourceSearchCompactMode() ? constants.QUICK_OPEN_COMPACT_MAX_RESULTS : constants.QUICK_OPEN_MAX_RESULTS;
}

export function resourceSearchWindowCapacity(): number {
	return ide_state.resourceSearchVisible ? resourceSearchPageSize() : 0;
}

export function resourceSearchVisibleResultCount(): number {
	if (!ide_state.resourceSearchVisible) {
		return 0;
	}
	const remaining = Math.max(0, ide_state.resourceSearchMatches.length - ide_state.resourceSearchDisplayOffset);
	const capacity = resourceSearchWindowCapacity();
	if (capacity <= 0) {
		return remaining;
	}
	return Math.min(remaining, capacity);
}

export function isSymbolSearchCompactMode(): boolean {
	return ide_state.viewportWidth <= constants.SYMBOL_SEARCH_COMPACT_WIDTH;
}

export function symbolSearchEntryHeight(): number {
	if (ide_state.symbolSearchMode === 'references') {
		return ide_state.lineHeight * 2;
	}
	return ide_state.symbolSearchGlobal && isSymbolSearchCompactMode() ? ide_state.lineHeight * 2 : ide_state.lineHeight;
}

export function symbolSearchPageSize(): number {
	if (ide_state.symbolSearchMode === 'references') {
		return constants.REFERENCE_SEARCH_MAX_RESULTS;
	}
	if (!ide_state.symbolSearchGlobal) {
		return constants.SYMBOL_SEARCH_MAX_RESULTS;
	}
	return isSymbolSearchCompactMode() ? constants.SYMBOL_SEARCH_COMPACT_MAX_RESULTS : constants.SYMBOL_SEARCH_MAX_RESULTS;
}

export function symbolSearchVisibleResultCount(): number {
	if (!ide_state.symbolSearchVisible) {
		return 0;
	}
	const remaining = Math.max(0, ide_state.symbolSearchMatches.length - ide_state.symbolSearchDisplayOffset);
	return Math.min(remaining, symbolSearchPageSize());
}

export function getTabBarTotalHeight(): number {
	return ide_state.tabBarHeight * Math.max(1, ide_state.tabBarRowCount);
}

export function topMargin(): number {
	return ide_state.headerHeight + getTabBarTotalHeight() + 2;
}

export function getStatusMessageLines(): string[] {
	if (!ide_state.message.visible) {
		return [];
	}
	const rawLines = splitText(ide_state.message.text);
	const maxWidth = Math.max(ide_state.viewportWidth - 8, ide_state.charAdvance);
	const wrappedLines: string[] = [];
	for (let i = 0; i < rawLines.length; i += 1) {
		const wrapped = wrapOverlayLine(rawLines[i], maxWidth);
		for (let j = 0; j < wrapped.length; j += 1) {
			wrappedLines.push(wrapped[j]);
		}
	}
	return wrappedLines.length > 0 ? wrappedLines : [''];
}

export function statusAreaHeight(): number {
	if (!ide_state.message.visible) {
		return ide_state.baseBottomMargin;
	}
	return ide_state.baseBottomMargin + Math.max(1, getStatusMessageLines().length) * ide_state.lineHeight + 4;
}

export function getVisibleProblemsPanelHeight(): number {
	if (!ide_state.problemsPanel?.isVisible) {
		return 0;
	}
	const planned = ide_state.problemsPanel.visibleHeight;
	if (planned <= 0) {
		return 0;
	}
	const maxAvailable = Math.max(0, ide_state.viewportHeight - statusAreaHeight() - (ide_state.headerHeight + getTabBarTotalHeight()));
	if (maxAvailable <= 0) {
		return 0;
	}
	return Math.min(planned, maxAvailable);
}

export function bottomMargin(): number {
	return statusAreaHeight() + getVisibleProblemsPanelHeight();
}

export function applyViewportSize(viewport: Viewport): void {
	ide_state.viewportWidth = viewport.width;
	ide_state.viewportHeight = viewport.height;
	ide_state.lastPointerRowResolution = null;
}

export function updateViewport(viewport: Viewport): void {
	applyViewportSize(viewport);
	if (ide_state.resourcePanel.visible) {
		const bounds = ide_state.resourcePanel.getBounds();
		if (!bounds) {
			hideResourcePanel();
		} else {
			ide_state.resourcePanel.clampHScroll();
			ide_state.resourcePanel.ensureSelectionVisible();
		}
	}
	ide_state.layout.markVisualLinesDirty();
	ide_state.cursorRevealSuspended = false;
	ensureCursorVisible();
	rewrapRuntimeErrorOverlays();
}

export function mapScreenPointToViewport(screenX: number, screenY: number): { x: number; y: number; inside: boolean; valid: boolean } {
	const view = $.view;
	if (!view) {
		return { x: 0, y: 0, inside: false, valid: false };
	}
	const rect = view.surface.measureDisplay();
	if (rect.width <= 0 || rect.height <= 0) {
		return { x: 0, y: 0, inside: false, valid: false };
	}
	const relativeX = screenX - rect.left;
	const relativeY = screenY - rect.top;
	const inside = relativeX >= 0 && relativeX < rect.width && relativeY >= 0 && relativeY < rect.height;
	return {
		x: (relativeX / rect.width) * ide_state.viewportWidth,
		y: (relativeY / rect.height) * ide_state.viewportHeight,
		inside,
		valid: true,
	};
}

export function codeViewportTop(): number {
	return topMargin()
		+ getCreateResourceBarHeight()
		+ getSearchBarHeight()
		+ getResourceSearchBarHeight()
		+ getSymbolSearchBarHeight()
		+ getRenameBarHeight()
		+ getLineJumpBarHeight();
}

export function getCodeAreaBounds(): { codeTop: number; codeBottom: number; codeLeft: number; codeRight: number; gutterLeft: number; gutterRight: number; textLeft: number } {
	const codeLeft = ide_state.resourcePanelVisible ? getResourcePanelWidth() : 0;
	const gutterLeft = codeLeft;
	const gutterRight = gutterLeft + updateGutterWidth();
	return {
		codeTop: codeViewportTop(),
		codeBottom: ide_state.viewportHeight - bottomMargin(),
		codeLeft,
		codeRight: ide_state.viewportWidth,
		gutterLeft,
		gutterRight,
		textLeft: gutterRight + 2,
	};
}

export function resolvePointerRow(viewportY: number): number {
	ensureVisualLines();
	const relativeY = viewportY - getCodeAreaBounds().codeTop;
	let visualIndex = ide_state.scrollRow + Math.floor(relativeY / ide_state.lineHeight);
	const visualCount = getVisualLineCount();
	if (visualIndex < 0) {
		visualIndex = 0;
	}
	if (visualCount > 0 && visualIndex > visualCount - 1) {
		visualIndex = visualCount - 1;
	}
	const segment = visualIndexToSegment(visualIndex);
	if (!segment) {
		ide_state.lastPointerRowResolution = null;
		return clamp(visualIndex, 0, Math.max(0, ide_state.buffer.getLineCount() - 1));
	}
	ide_state.lastPointerRowResolution = { visualIndex, segment };
	return segment.row;
}

export function resolvePointerColumn(row: number, viewportX: number): number {
	const bounds = getCodeAreaBounds();
	const entry = ide_state.layout.getCachedHighlight(ide_state.buffer, row);
	const line = entry.src;
	if (line.length === 0) {
		return 0;
	}
	const highlight = entry.hi;
	let segmentStartColumn = ide_state.scrollColumn;
	let segmentEndColumn = line.length;
	const resolvedSegment = ide_state.lastPointerRowResolution?.segment;
	if (ide_state.wordWrapEnabled && resolvedSegment && resolvedSegment.row === row) {
		segmentStartColumn = resolvedSegment.startColumn;
		segmentEndColumn = resolvedSegment.endColumn;
	}
	if (ide_state.wordWrapEnabled) {
		if (segmentStartColumn < 0) {
			segmentStartColumn = 0;
		}
		if (segmentEndColumn < segmentStartColumn) {
			segmentEndColumn = segmentStartColumn;
		}
	} else {
		segmentStartColumn = Math.min(segmentStartColumn, line.length);
		segmentEndColumn = line.length;
	}
	const effectiveStartColumn = clamp(segmentStartColumn, 0, line.length);
	const startDisplay = ide_state.layout.columnToDisplay(highlight, effectiveStartColumn);
	const offset = viewportX - bounds.textLeft;
	if (offset <= 0) {
		return effectiveStartColumn;
	}
	const target = (entry.advancePrefix[startDisplay] ?? 0) + offset;
	const lower = lower_bound(entry.advancePrefix, target, startDisplay + 1, entry.advancePrefix.length);
	let displayIndex = lower - 1;
	if (displayIndex < startDisplay) {
		displayIndex = startDisplay;
	}
	if (displayIndex >= highlight.text.length) {
		return ide_state.wordWrapEnabled ? Math.min(segmentEndColumn, line.length) : line.length;
	}
	const midpoint = entry.advancePrefix[displayIndex] + (entry.advancePrefix[displayIndex + 1] - entry.advancePrefix[displayIndex]) * 0.5;
	let column = entry.displayToColumn[displayIndex];
	if (column === undefined) {
		column = line.length;
	}
	if (target >= midpoint) {
		column += 1;
	}
	if (ide_state.wordWrapEnabled) {
		column = clamp(column, segmentStartColumn, segmentEndColumn);
	} else if (column > line.length) {
		column = line.length;
	}
	if (column < effectiveStartColumn) {
		column = effectiveStartColumn;
	}
	return Math.max(0, column);
}

export function handlePointerAutoScroll(viewportX: number, viewportY: number): void {
	if (!ide_state.pointerSelecting) {
		return;
	}
	const bounds = getCodeAreaBounds();
	ensureVisualLines();
	if (viewportY < bounds.codeTop && ide_state.scrollRow > 0) {
		ide_state.scrollRow -= 1;
	} else if (viewportY >= bounds.codeBottom && ide_state.scrollRow < getVisualLineCount() - 1) {
		ide_state.scrollRow += 1;
	}
	const maxScrollColumn = computeMaximumScrollColumn();
	if (viewportX >= bounds.gutterLeft && !ide_state.wordWrapEnabled) {
		if (viewportX < bounds.textLeft && ide_state.scrollColumn > 0) {
			ide_state.scrollColumn -= 1;
		} else if (viewportX >= bounds.codeRight && ide_state.scrollColumn < maxScrollColumn) {
			ide_state.scrollColumn += 1;
		}
	}
	if (ide_state.scrollRow < 0) {
		ide_state.scrollRow = 0;
	}
	if (ide_state.scrollColumn < 0) {
		ide_state.scrollColumn = 0;
	}
	if (ide_state.wordWrapEnabled) {
		ide_state.scrollColumn = 0;
	}
	ide_state.scrollRow = clamp(ide_state.scrollRow, 0, Math.max(0, getVisualLineCount() - visibleRowCount()));
	if (!ide_state.wordWrapEnabled) {
		ide_state.scrollColumn = clamp(ide_state.scrollColumn, 0, maxScrollColumn);
	}
}

export function resetPointerClickTracking(): void {
	ide_state.lastPointerClickTimeMs = 0;
	ide_state.lastPointerClickRow = -1;
	ide_state.lastPointerClickColumn = -1;
}

export function scrollRows(deltaRows: number): void {
	if (deltaRows === 0) {
		return;
	}
	ensureVisualLines();
	ide_state.scrollRow = clamp(ide_state.scrollRow + deltaRows, 0, Math.max(0, getVisualLineCount() - visibleRowCount()));
}

export function getCreateResourceBarHeight(): number {
	if (!ide_state.createResourceVisible) {
		return 0;
	}
	return ide_state.lineHeight + constants.CREATE_RESOURCE_BAR_MARGIN_Y * 2;
}

export function getSearchBarHeight(): number {
	if (!ide_state.searchVisible) {
		return 0;
	}
	const baseHeight = ide_state.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	const visible = searchVisibleResultCount();
	if (visible <= 0) {
		return baseHeight;
	}
	return baseHeight + constants.SEARCH_RESULT_SPACING + visible * searchResultEntryHeight();
}

export function getResourceSearchBarHeight(): number {
	if (!ide_state.resourceSearchVisible) {
		return 0;
	}
	const baseHeight = ide_state.lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
	const visible = resourceSearchVisibleResultCount();
	if (visible <= 0) {
		return baseHeight;
	}
	return baseHeight + constants.QUICK_OPEN_RESULT_SPACING + visible * resourceSearchEntryHeight();
}

export function getSymbolSearchBarHeight(): number {
	if (!ide_state.symbolSearchVisible) {
		return 0;
	}
	const baseHeight = ide_state.lineHeight + constants.SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
	const visible = symbolSearchVisibleResultCount();
	if (visible <= 0) {
		return baseHeight;
	}
	return baseHeight + constants.SYMBOL_SEARCH_RESULT_SPACING + visible * symbolSearchEntryHeight();
}

export function getRenameBarHeight(): number {
	if (!ide_state.renameController?.isVisible()) {
		return 0;
	}
	return ide_state.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
}

export function getLineJumpBarHeight(): number {
	if (!ide_state.lineJumpVisible) {
		return 0;
	}
	return ide_state.lineHeight + constants.LINE_JUMP_BAR_MARGIN_Y * 2;
}

export function getCreateResourceBarBounds(): { top: number; bottom: number; left: number; right: number } {
	const height = getCreateResourceBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = ide_state.headerHeight + getTabBarTotalHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: ide_state.viewportWidth,
	};
}

export function getSearchBarBounds(): { top: number; bottom: number; left: number; right: number } {
	const height = getSearchBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = ide_state.headerHeight + getTabBarTotalHeight() + getCreateResourceBarHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: ide_state.viewportWidth,
	};
}

export function getResourceSearchBarBounds(): { top: number; bottom: number; left: number; right: number } {
	const height = getResourceSearchBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = ide_state.headerHeight + getTabBarTotalHeight() + getCreateResourceBarHeight() + getSearchBarHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: ide_state.viewportWidth,
	};
}

export function getSymbolSearchBarBounds(): { top: number; bottom: number; left: number; right: number } {
	const height = getSymbolSearchBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = ide_state.headerHeight + getTabBarTotalHeight()
		+ getCreateResourceBarHeight()
		+ getSearchBarHeight()
		+ getResourceSearchBarHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: ide_state.viewportWidth,
	};
}

export function getRenameBarBounds(): { top: number; bottom: number; left: number; right: number } {
	const height = getRenameBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = ide_state.headerHeight + getTabBarTotalHeight()
		+ getCreateResourceBarHeight()
		+ getSearchBarHeight()
		+ getResourceSearchBarHeight()
		+ getSymbolSearchBarHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: ide_state.viewportWidth,
	};
}

export function getLineJumpBarBounds(): { top: number; bottom: number; left: number; right: number } {
	const height = getLineJumpBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = ide_state.headerHeight + getTabBarTotalHeight()
		+ getCreateResourceBarHeight()
		+ getSearchBarHeight()
		+ getResourceSearchBarHeight()
		+ getSymbolSearchBarHeight()
		+ getRenameBarHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: ide_state.viewportWidth,
	};
}

export function configureFontVariant(variant: FontVariant): void {
	ide_state.fontVariant = variant;
	ide_state.font = new EditorFont(variant);
	ide_state.lineHeight = ide_state.font.lineHeight;
	ide_state.charAdvance = ide_state.font.advance('M');
	ide_state.spaceAdvance = ide_state.font.advance(' ');
	ide_state.inlineFieldMetricsRef = {
		measureText: (text: string) => measureText(text),
		advanceChar: (ch: string) => ide_state.font.advance(ch),
		spaceAdvance: ide_state.spaceAdvance,
		tabSpaces: constants.TAB_SPACES,
	};
	updateGutterWidth();
	ide_state.headerHeight = ide_state.lineHeight + 4;
	ide_state.tabBarHeight = ide_state.lineHeight + 3;
	ide_state.baseBottomMargin = ide_state.lineHeight + 6;
	ide_state.layout = new CodeLayout(ide_state.font, {
		maxHighlightCache: 512,
		semanticDebounceMs: 200,
		clockNow: ide_state.clockNow,
		getBuiltinIdentifiers: () => getBuiltinIdentifiersSnapshot(),
	});
	if (ide_state.resourcePanel) {
		ide_state.resourcePanel.setFontMetrics(ide_state.lineHeight, ide_state.charAdvance);
	}
	ide_state.layout.invalidateAllHighlights();
	ide_state.layout.markVisualLinesDirty();
}

export function setFontVariant(variant: FontVariant): void {
	configureFontVariant(variant);
	ensureVisualLines();
	ide_state.cursorRevealSuspended = false;
	ensureCursorVisible();
	rewrapRuntimeErrorOverlays();
	requestSemanticRefresh();
	markDiagnosticsDirty(ide_state.activeCodeTabContextId);
}

export function toggleWordWrap(): void {
	ensureVisualLines();
	const previousWrap = ide_state.wordWrapEnabled;
	const previousTopIndex = clamp(ide_state.scrollRow, 0, Math.max(0, getVisualLineCount() - 1));
	const previousTopSegment = visualIndexToSegment(previousTopIndex);
	const anchorRow = previousTopSegment ? previousTopSegment.row : ide_state.cursorRow;
	const anchorColumnForWrap = previousTopSegment ? previousTopSegment.startColumn : 0;
	const anchorColumnForUnwrap = previousTopSegment
		? (previousWrap ? previousTopSegment.startColumn : ide_state.scrollColumn)
		: ide_state.scrollColumn;
	const previousCursorRow = ide_state.cursorRow;
	const previousCursorColumn = ide_state.cursorColumn;
	const previousDesiredColumn = ide_state.desiredColumn;

	ide_state.wordWrapEnabled = !previousWrap;
	ide_state.cursorRevealSuspended = false;
	ide_state.layout.markVisualLinesDirty();
	ensureVisualLines();

	ide_state.cursorRow = clamp(previousCursorRow, 0, Math.max(0, ide_state.buffer.getLineCount() - 1));
	const currentLine = ide_state.buffer.getLineContent(ide_state.cursorRow);
	ide_state.cursorColumn = clamp(previousCursorColumn, 0, currentLine.length);
	ide_state.desiredColumn = previousDesiredColumn;

	if (ide_state.wordWrapEnabled) {
		ide_state.scrollColumn = 0;
		ide_state.scrollRow = clamp(positionToVisualIndex(anchorRow, anchorColumnForWrap), 0, Math.max(0, getVisualLineCount() - visibleRowCount()));
	} else {
		ide_state.scrollColumn = clamp(anchorColumnForUnwrap, 0, computeMaximumScrollColumn());
		ide_state.scrollRow = clamp(positionToVisualIndex(anchorRow, ide_state.scrollColumn), 0, Math.max(0, getVisualLineCount() - visibleRowCount()));
	}
	ide_state.lastPointerRowResolution = null;
	ensureCursorVisible();
	updateDesiredColumn();
	ide_state.showMessage(ide_state.wordWrapEnabled ? 'Word wrap enabled' : 'Word wrap disabled', constants.COLOR_STATUS_TEXT, 2.5);
}

export function notifyReadOnlyEdit(): void {
	ide_state.showMessage('Tab is read-only', constants.COLOR_STATUS_WARNING, 1.5);
}

export function hideResourcePanel(): void {
	ide_state.resourcePanel.hide();
	ide_state.resourcePanelFocused = false;
	ide_state.resourcePanelResizing = false;
	resetResourcePanelState();
}

export function resetResourcePanelState(): void {
	ide_state.resourceBrowserItems = [];
	ide_state.resourceBrowserSelectionIndex = -1;
	ide_state.pendingResourceSelectionAssetId = null;
	ide_state.resourcePanelResizing = false;
}

export function refreshResourcePanelContents(): void {
	ide_state.resourcePanel.refresh();
	const state = ide_state.resourcePanel.getStateForRender();
	ide_state.resourcePanelResourceCount = state.items.length;
	ide_state.resourceBrowserItems = state.items;
	ide_state.resourceBrowserSelectionIndex = state.selectionIndex;
}

export function selectResourceInPanel(descriptor: ResourceDescriptor): void {
	if (!descriptor.asset_id || descriptor.asset_id.length === 0) {
		return;
	}
	ide_state.pendingResourceSelectionAssetId = descriptor.asset_id;
	if (ide_state.resourcePanelVisible) {
		applyPendingResourceSelection();
	}
}

export function applyPendingResourceSelection(): void {
	if (!ide_state.resourcePanelVisible || !ide_state.pendingResourceSelectionAssetId) {
		return;
	}
	const index = findResourcePanelIndexByasset_id(ide_state.pendingResourceSelectionAssetId);
	if (index === -1) {
		return;
	}
	ide_state.resourceBrowserSelectionIndex = index;
	ide_state.resourcePanel.ensureSelectionVisible();
	ide_state.pendingResourceSelectionAssetId = null;
}

export function findResourcePanelIndexByasset_id(asset_id: string): number {
	for (let i = 0; i < ide_state.resourceBrowserItems.length; i += 1) {
		if (ide_state.resourceBrowserItems[i].descriptor?.asset_id === asset_id) {
			return i;
		}
	}
	return -1;
}

export function getResourcePanelWidth(): number {
	if (!ide_state.resourcePanelVisible) {
		return 0;
	}
	const bounds = ide_state.resourcePanel.getBounds();
	if (!bounds) {
		return 0;
	}
	return Math.max(0, bounds.right - bounds.left);
}

export function scrollResourceBrowser(amount: number): void {
	if (!ide_state.resourcePanelVisible) {
		return;
	}
	ide_state.resourcePanel.scrollBy(amount);
}
