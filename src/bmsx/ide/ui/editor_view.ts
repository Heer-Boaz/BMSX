import { $ } from '../../core/engine_core';
import { lower_bound } from '../../utils/lower_bound';
import { EditorFont } from './view/editor_font';
import type { FontVariant } from '../../render/shared/bmsx_font';
import type { Viewport } from '../../rompack/rompack';
import type { ResourceDescriptor } from '../core/types';
import * as constants from '../core/constants';
import { CodeLayout } from './code_layout';
import { markDiagnosticsDirty } from '../contrib/problems/diagnostics';
import { computeSearchPageStats } from '../contrib/find/editor_search';
import { ide_state } from '../core/ide_state';
import { showEditorMessage,editorFeedbackState } from '../core/editor_feedback_state';
import { editorChromeState } from './editor_chrome_state';
import { editorPointerState } from '../input/pointer/editor_pointer_state';
import { editorCaretState } from './caret_state';
import { getBuiltinIdentifiersSnapshot, requestSemanticRefresh } from '../contrib/intellisense/intellisense';
import { findResourcePanelIndexByAssetId } from '../contrib/resources/resource_panel_items';
import { ensureCursorVisible, updateDesiredColumn } from './caret';
import { splitText } from '../text/source_text';
import { editorDocumentState } from '../editing/editor_document_state';
import {
	ensureVisualLines,
	getVisualLineCount,
	positionToVisualIndex,
	rewrapRuntimeErrorOverlays,
	visibleColumnCount,
	visibleRowCount,
	visualIndexToSegment,
	wrapOverlayLine,
} from '../core/text_utils';

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
	return Math.max(6, ide_state.charAdvance + 2);
}

export function updateGutterWidth(): number {
	const lineCount = editorDocumentState.buffer.getLineCount();
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
	const lineCount = editorDocumentState.buffer.getLineCount();
	for (let i = 0; i < lineCount; i += 1) {
		const length = editorDocumentState.buffer.getLineEndOffset(i) - editorDocumentState.buffer.getLineStartOffset(i);
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
	return ide_state.resourceSearch.visible ? resourceSearchPageSize() : 0;
}

export function resourceSearchVisibleResultCount(): number {
	if (!ide_state.resourceSearch.visible) {
		return 0;
	}
	const remaining = Math.max(0, ide_state.resourceSearch.matches.length - ide_state.resourceSearch.displayOffset);
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
	if (ide_state.symbolSearch.mode === 'references') {
		return ide_state.lineHeight * 2;
	}
	return ide_state.symbolSearch.global && isSymbolSearchCompactMode() ? ide_state.lineHeight * 2 : ide_state.lineHeight;
}

export function symbolSearchPageSize(): number {
	if (ide_state.symbolSearch.mode === 'references') {
		return constants.REFERENCE_SEARCH_MAX_RESULTS;
	}
	if (!ide_state.symbolSearch.global) {
		return constants.SYMBOL_SEARCH_MAX_RESULTS;
	}
	return isSymbolSearchCompactMode() ? constants.SYMBOL_SEARCH_COMPACT_MAX_RESULTS : constants.SYMBOL_SEARCH_MAX_RESULTS;
}

export function symbolSearchVisibleResultCount(): number {
	if (!ide_state.symbolSearch.visible) {
		return 0;
	}
	const remaining = Math.max(0, ide_state.symbolSearch.matches.length - ide_state.symbolSearch.displayOffset);
	return Math.min(remaining, symbolSearchPageSize());
}

export function getTabBarTotalHeight(): number {
	return ide_state.tabBarHeight * Math.max(1, ide_state.tabBarRowCount);
}

export function topMargin(): number {
	return ide_state.headerHeight + getTabBarTotalHeight() + 2;
}

export function getStatusMessageLines(): string[] {
	if (!editorFeedbackState.message.visible) {
		return [];
	}
	const rawLines = splitText(editorFeedbackState.message.text);
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
	if (!editorFeedbackState.message.visible) {
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
	editorPointerState.lastPointerRowResolution = null;
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
	editorCaretState.cursorRevealSuspended = false;
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
		x: Math.trunc((relativeX / rect.width) * ide_state.viewportWidth),
		y: Math.trunc((relativeY / rect.height) * ide_state.viewportHeight),
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
	const codeLeft = ide_state.resourcePanel.isVisible() ? getResourcePanelWidth() : 0;
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
	visualIndex = ide_state.layout.clampVisualIndex(Math.max(1, visualCount), visualIndex);
	const segment = visualIndexToSegment(visualIndex);
	if (!segment) {
		editorPointerState.lastPointerRowResolution = null;
		return ide_state.layout.clampBufferRow(editorDocumentState.buffer, visualIndex);
	}
	editorPointerState.lastPointerRowResolution = { visualIndex, segment };
	return segment.row;
}

export function resolvePointerColumn(row: number, viewportX: number): number {
	const bounds = getCodeAreaBounds();
	const entry = ide_state.layout.getCachedHighlight(editorDocumentState.buffer, row);
	const line = entry.src;
	if (line.length === 0) {
		return 0;
	}
	const highlight = entry.hi;
	let segmentStartColumn = ide_state.layout.clampLineLength(line.length, ide_state.scrollColumn);
	let segmentEndColumn = line.length;
	const resolvedSegment = editorPointerState.lastPointerRowResolution?.segment;
	if (ide_state.wordWrapEnabled && resolvedSegment && resolvedSegment.row === row) {
		segmentStartColumn = resolvedSegment.startColumn;
		segmentEndColumn = resolvedSegment.endColumn;
	}
	const segmentStart = ide_state.layout.clampSegmentStart(line.length, segmentStartColumn);
	const segmentEnd = ide_state.layout.clampSegmentEnd(line.length, segmentStart, segmentEndColumn);
	const effectiveStartColumn = segmentStart;
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
		return ide_state.wordWrapEnabled ? segmentEnd : line.length;
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
		column = ide_state.layout.clampLineLength(line.length, column);
		column = ide_state.layout.clampSegmentEnd(line.length, segmentStart, column);
	}
	if (column < segmentStart) {
		column = segmentStart;
	}
	return ide_state.layout.clampLineLength(line.length, column);
}

export function handlePointerAutoScroll(viewportX: number, viewportY: number): void {
	if (!editorPointerState.pointerSelecting) {
		return;
	}
	const bounds = getCodeAreaBounds();
	ensureVisualLines();
	let rowDelta = 0;
	if (viewportY < bounds.codeTop) {
		rowDelta = -1;
	} else if (viewportY >= bounds.codeBottom) {
		rowDelta = 1;
	}
	const rows = visibleRowCount();
	ide_state.scrollRow = ide_state.layout.clampVisualScroll(ide_state.scrollRow + rowDelta, getVisualLineCount(), rows);
	const maxScrollColumn = computeMaximumScrollColumn();
	if (viewportX >= bounds.gutterLeft && !ide_state.wordWrapEnabled) {
		if (viewportX < bounds.textLeft) {
			ide_state.scrollColumn -= 1;
		} else if (viewportX >= bounds.codeRight) {
			ide_state.scrollColumn += 1;
		}
		ide_state.scrollColumn = ide_state.layout.clampHorizontalScroll(ide_state.scrollColumn, maxScrollColumn);
	}
	if (ide_state.wordWrapEnabled) {
		ide_state.scrollColumn = 0;
	}
}

export function scrollRows(deltaRows: number): void {
	if (deltaRows === 0) {
		return;
	}
	ensureVisualLines();
	ide_state.scrollRow = ide_state.layout.clampVisualScroll(ide_state.scrollRow + deltaRows, getVisualLineCount(), visibleRowCount());
}

export function getCreateResourceBarHeight(): number {
	if (!ide_state.createResource.visible) {
		return 0;
	}
	return ide_state.lineHeight + constants.CREATE_RESOURCE_BAR_MARGIN_Y * 2;
}

export function getSearchBarHeight(): number {
	if (!ide_state.search.visible) {
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
	if (!ide_state.resourceSearch.visible) {
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
	if (!ide_state.symbolSearch.visible) {
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
	if (!ide_state.lineJump.visible) {
		return 0;
	}
	return ide_state.lineHeight + constants.LINE_JUMP_BAR_MARGIN_Y * 2;
}

type BarBounds = { top: number; bottom: number; left: number; right: number };

const barHeightGetters = [
	getCreateResourceBarHeight,
	getSearchBarHeight,
	getResourceSearchBarHeight,
	getSymbolSearchBarHeight,
	getRenameBarHeight,
	getLineJumpBarHeight,
] as const;

function computeBarBounds(barIndex: number): BarBounds {
	const height = barHeightGetters[barIndex]();
	if (height <= 0) {
		return null;
	}
	let top = ide_state.headerHeight + getTabBarTotalHeight();
	for (let i = 0; i < barIndex; i++) {
		top += barHeightGetters[i]();
	}
	return { top, bottom: top + height, left: 0, right: ide_state.viewportWidth };
}

export function getCreateResourceBarBounds(): BarBounds { return computeBarBounds(0); }
export function getSearchBarBounds(): BarBounds { return computeBarBounds(1); }
export function getResourceSearchBarBounds(): BarBounds { return computeBarBounds(2); }
export function getSymbolSearchBarBounds(): BarBounds { return computeBarBounds(3); }
export function getRenameBarBounds(): BarBounds { return computeBarBounds(4); }
export function getLineJumpBarBounds(): BarBounds { return computeBarBounds(5); }

export function configureFontVariant(variant: FontVariant): void {
	ide_state.fontVariant = variant;
	ide_state.font = new EditorFont(variant);
	ide_state.lineHeight = ide_state.font.lineHeight;
	ide_state.charAdvance = ide_state.font.advance('M');
	ide_state.spaceAdvance = ide_state.font.advance(' ');
	ide_state.inlineFieldMetricsRef = {
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
	const activeContext = ide_state.activeCodeTabContextId ? ide_state.codeTabContexts.get(ide_state.activeCodeTabContextId) : null;
	if (activeContext) {
		ide_state.layout.setCodeTabMode(activeContext.mode);
	}
	if (ide_state.resourcePanel) {
		ide_state.resourcePanel.setFontMetrics(ide_state.lineHeight, ide_state.charAdvance);
	}
	ide_state.layout.invalidateAllHighlights();
	ide_state.layout.markVisualLinesDirty();
}

export function setFontVariant(variant: FontVariant): void {
	configureFontVariant(variant);
	ensureVisualLines();
	editorCaretState.cursorRevealSuspended = false;
	ensureCursorVisible();
	rewrapRuntimeErrorOverlays();
	requestSemanticRefresh();
	markDiagnosticsDirty(ide_state.activeCodeTabContextId);
}

export function toggleWordWrap(): void {
	ensureVisualLines();
	const previousWrap = ide_state.wordWrapEnabled;
	const previousTopIndex = ide_state.layout.clampVisualIndex(getVisualLineCount(), ide_state.scrollRow);
	const previousTopSegment = visualIndexToSegment(previousTopIndex);
	const anchorRow = previousTopSegment ? previousTopSegment.row : editorDocumentState.cursorRow;
	const anchorColumnForWrap = previousTopSegment ? previousTopSegment.startColumn : 0;
	const anchorColumnForUnwrap = previousTopSegment
		? (previousWrap ? previousTopSegment.startColumn : ide_state.scrollColumn)
		: ide_state.scrollColumn;
	const previousCursorRow = editorDocumentState.cursorRow;
	const previousCursorColumn = editorDocumentState.cursorColumn;
	const previousDesiredColumn = editorDocumentState.desiredColumn;

	ide_state.wordWrapEnabled = !previousWrap;
	editorCaretState.cursorRevealSuspended = false;
	ide_state.layout.markVisualLinesDirty();
	ensureVisualLines();

	editorDocumentState.cursorRow = ide_state.layout.clampBufferRow(editorDocumentState.buffer, previousCursorRow);
	const currentLine = editorDocumentState.buffer.getLineContent(editorDocumentState.cursorRow);
	editorDocumentState.cursorColumn = ide_state.layout.clampLineLength(currentLine.length, previousCursorColumn);
	editorDocumentState.desiredColumn = previousDesiredColumn;

	if (ide_state.wordWrapEnabled) {
		ide_state.scrollColumn = 0;
		ide_state.scrollRow = ide_state.layout.clampVisualScroll(positionToVisualIndex(anchorRow, anchorColumnForWrap), getVisualLineCount(), visibleRowCount());
	} else {
		ide_state.scrollColumn = ide_state.layout.clampHorizontalScroll(anchorColumnForUnwrap, computeMaximumScrollColumn());
		ide_state.scrollRow = ide_state.layout.clampVisualScroll(positionToVisualIndex(anchorRow, ide_state.scrollColumn), getVisualLineCount(), visibleRowCount());
	}
	editorPointerState.lastPointerRowResolution = null;
	ensureCursorVisible();
	updateDesiredColumn();
	showEditorMessage(ide_state.wordWrapEnabled ? 'Word wrap enabled' : 'Word wrap disabled', constants.COLOR_STATUS_TEXT, 2.5);
}

export function notifyReadOnlyEdit(): void {
	showEditorMessage('Tab is read-only', constants.COLOR_STATUS_WARNING, 1.5);
}

export function hideResourcePanel(): void {
	ide_state.resourcePanel.hide();
	editorChromeState.resourcePanelResizing = false;
	resetResourcePanelState();
}

export function resetResourcePanelState(): void {
	ide_state.pendingResourceSelectionAssetId = null;
	editorChromeState.resourcePanelResizing = false;
}

export function refreshResourcePanelContents(): void {
	ide_state.resourcePanel.refresh();
}

export function selectResourceInPanel(descriptor: ResourceDescriptor): void {
	if (!descriptor.asset_id || descriptor.asset_id.length === 0) {
		return;
	}
	ide_state.pendingResourceSelectionAssetId = descriptor.asset_id;
	if (ide_state.resourcePanel.isVisible()) {
		applyPendingResourceSelection();
	}
}

export function applyPendingResourceSelection(): void {
	if (!ide_state.resourcePanel.isVisible() || !ide_state.pendingResourceSelectionAssetId) {
		return;
	}
	const index = findResourcePanelIndexByAssetId(ide_state.resourcePanel.items, ide_state.pendingResourceSelectionAssetId);
	if (index === -1) {
		return;
	}
	ide_state.resourcePanel.setSelectionIndex(index);
	ide_state.resourcePanel.ensureSelectionVisible();
	ide_state.pendingResourceSelectionAssetId = null;
}

export function getResourcePanelWidth(): number {
	if (!ide_state.resourcePanel.isVisible()) {
		return 0;
	}
	const bounds = ide_state.resourcePanel.getBounds();
	if (!bounds) {
		return 0;
	}
	return Math.max(0, bounds.right - bounds.left);
}

export function scrollResourceBrowser(amount: number): void {
	if (!ide_state.resourcePanel.isVisible()) {
		return;
	}
	ide_state.resourcePanel.scrollBy(amount);
}
