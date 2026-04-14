import { $ } from '../../../core/engine_core';
import { lower_bound } from '../../../utils/lower_bound';
import { EditorFont } from './view/editor_font';
import type { FontVariant } from '../../../render/shared/bmsx_font';
import type { Viewport } from '../../../rompack/rompack';
import type { ResourceDescriptor } from '../../common/types';
import * as constants from '../../common/constants';
import { CodeLayout } from './code_layout';
import { markDiagnosticsDirty } from '../../workbench/contrib/problems/diagnostics';
import { computeSearchPageStats } from '../contrib/find/editor_search';
import { showEditorMessage,editorFeedbackState } from '../../workbench/common/feedback_state';
import { editorChromeState } from '../../workbench/ui/chrome_state';
import { editorPointerState } from '../input/pointer/editor_pointer_state';
import { editorCaretState } from './caret_state';
import { getBuiltinIdentifiersSnapshot, requestSemanticRefresh } from '../contrib/intellisense/intellisense';
import { findResourcePanelIndexByAssetId } from '../../workbench/contrib/resources/resource_panel_items';
import { ensureCursorVisible, updateDesiredColumn } from './caret';
import { splitText } from '../text/source_text';
import { editorDocumentState } from '../editing/editor_document_state';
import { editorSessionState } from './editor_session_state';
import { editorViewState } from './editor_view_state';
import { editorFeatureState } from '../common/editor_feature_state';
import { problemsPanel } from '../../workbench/contrib/problems/problems_panel';
import { resourcePanel } from '../../workbench/contrib/resources/resource_panel_controller';
import { renameController } from '../contrib/rename/rename_controller';
import { editorRuntimeState } from '../common/editor_runtime_state';
import {
	ensureVisualLines,
	getVisualLineCount,
	positionToVisualIndex,
	rewrapRuntimeErrorOverlays,
	visibleColumnCount,
	visibleRowCount,
	visualIndexToSegment,
	wrapOverlayLine,
} from '../../common/text_utils';

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
	return Math.max(6, editorViewState.charAdvance + 2);
}

export function updateGutterWidth(): number {
	const lineCount = editorDocumentState.buffer.getLineCount();
	const digitCount = Math.max(2, decimalDigitCount(lineCount));
	editorViewState.gutterWidth = getBreakpointLaneWidth() + 4 + digitCount * editorViewState.font.advance('0');
	return editorViewState.gutterWidth;
}

export function maximumLineLength(): number {
	if (!editorViewState.maxLineLengthDirty) {
		return editorViewState.maxLineLength;
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
	editorViewState.maxLineLength = maxLength;
	editorViewState.maxLineLengthRow = maxRow;
	editorViewState.maxLineLengthDirty = false;
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
	return editorViewState.lineHeight * 2;
}

export function isResourceSearchCompactMode(): boolean {
	return editorViewState.viewportWidth <= constants.SYMBOL_SEARCH_COMPACT_WIDTH;
}

export function resourceSearchEntryHeight(): number {
	return isResourceSearchCompactMode() ? editorViewState.lineHeight * 2 : editorViewState.lineHeight;
}

export function resourceSearchPageSize(): number {
	return isResourceSearchCompactMode() ? constants.QUICK_OPEN_COMPACT_MAX_RESULTS : constants.QUICK_OPEN_MAX_RESULTS;
}

export function resourceSearchWindowCapacity(): number {
	return editorFeatureState.resourceSearch.visible ? resourceSearchPageSize() : 0;
}

export function resourceSearchVisibleResultCount(): number {
	if (!editorFeatureState.resourceSearch.visible) {
		return 0;
	}
	const remaining = Math.max(0, editorFeatureState.resourceSearch.matches.length - editorFeatureState.resourceSearch.displayOffset);
	const capacity = resourceSearchWindowCapacity();
	if (capacity <= 0) {
		return remaining;
	}
	return Math.min(remaining, capacity);
}

export function isSymbolSearchCompactMode(): boolean {
	return editorViewState.viewportWidth <= constants.SYMBOL_SEARCH_COMPACT_WIDTH;
}

export function symbolSearchEntryHeight(): number {
	if (editorFeatureState.symbolSearch.mode === 'references') {
		return editorViewState.lineHeight * 2;
	}
	return editorFeatureState.symbolSearch.global && isSymbolSearchCompactMode() ? editorViewState.lineHeight * 2 : editorViewState.lineHeight;
}

export function symbolSearchPageSize(): number {
	if (editorFeatureState.symbolSearch.mode === 'references') {
		return constants.REFERENCE_SEARCH_MAX_RESULTS;
	}
	if (!editorFeatureState.symbolSearch.global) {
		return constants.SYMBOL_SEARCH_MAX_RESULTS;
	}
	return isSymbolSearchCompactMode() ? constants.SYMBOL_SEARCH_COMPACT_MAX_RESULTS : constants.SYMBOL_SEARCH_MAX_RESULTS;
}

export function symbolSearchVisibleResultCount(): number {
	if (!editorFeatureState.symbolSearch.visible) {
		return 0;
	}
	const remaining = Math.max(0, editorFeatureState.symbolSearch.matches.length - editorFeatureState.symbolSearch.displayOffset);
	return Math.min(remaining, symbolSearchPageSize());
}

export function getTabBarTotalHeight(): number {
	return editorViewState.tabBarHeight * Math.max(1, editorViewState.tabBarRowCount);
}

export function topMargin(): number {
	return editorViewState.headerHeight + getTabBarTotalHeight() + 2;
}

export function getStatusMessageLines(): string[] {
	if (!editorFeedbackState.message.visible) {
		return [];
	}
	const rawLines = splitText(editorFeedbackState.message.text);
	const maxWidth = Math.max(editorViewState.viewportWidth - 8, editorViewState.charAdvance);
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
		return editorViewState.baseBottomMargin;
	}
	return editorViewState.baseBottomMargin + Math.max(1, getStatusMessageLines().length) * editorViewState.lineHeight + 4;
}

export function getVisibleProblemsPanelHeight(): number {
	if (!problemsPanel.isVisible) {
		return 0;
	}
	const planned = problemsPanel.visibleHeight;
	if (planned <= 0) {
		return 0;
	}
	const maxAvailable = Math.max(0, editorViewState.viewportHeight - statusAreaHeight() - (editorViewState.headerHeight + getTabBarTotalHeight()));
	if (maxAvailable <= 0) {
		return 0;
	}
	return Math.min(planned, maxAvailable);
}

export function bottomMargin(): number {
	return statusAreaHeight() + getVisibleProblemsPanelHeight();
}

export function applyViewportSize(viewport: Viewport): void {
	editorViewState.viewportWidth = viewport.width;
	editorViewState.viewportHeight = viewport.height;
	editorPointerState.lastPointerRowResolution = null;
}

export function updateViewport(viewport: Viewport): void {
	applyViewportSize(viewport);
	if (resourcePanel.visible) {
		const bounds = resourcePanel.getBounds();
		if (!bounds) {
			hideResourcePanel();
		} else {
			resourcePanel.clampHScroll();
			resourcePanel.ensureSelectionVisible();
		}
	}
	editorViewState.layout.markVisualLinesDirty();
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
		x: Math.trunc((relativeX / rect.width) * editorViewState.viewportWidth),
		y: Math.trunc((relativeY / rect.height) * editorViewState.viewportHeight),
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
	const codeLeft = resourcePanel.isVisible() ? getResourcePanelWidth() : 0;
	const gutterLeft = codeLeft;
	const gutterRight = gutterLeft + updateGutterWidth();
	return {
		codeTop: codeViewportTop(),
		codeBottom: editorViewState.viewportHeight - bottomMargin(),
		codeLeft,
		codeRight: editorViewState.viewportWidth,
		gutterLeft,
		gutterRight,
		textLeft: gutterRight + 2,
	};
}

export function resolvePointerRow(viewportY: number): number {
	ensureVisualLines();
	const relativeY = viewportY - getCodeAreaBounds().codeTop;
	let visualIndex = editorViewState.scrollRow + Math.floor(relativeY / editorViewState.lineHeight);
	const visualCount = getVisualLineCount();
	visualIndex = editorViewState.layout.clampVisualIndex(Math.max(1, visualCount), visualIndex);
	const segment = visualIndexToSegment(visualIndex);
	if (!segment) {
		editorPointerState.lastPointerRowResolution = null;
		return editorViewState.layout.clampBufferRow(editorDocumentState.buffer, visualIndex);
	}
	editorPointerState.lastPointerRowResolution = { visualIndex, segment };
	return segment.row;
}

export function resolvePointerColumn(row: number, viewportX: number): number {
	const bounds = getCodeAreaBounds();
	const entry = editorViewState.layout.getCachedHighlight(editorDocumentState.buffer, row);
	const line = entry.src;
	if (line.length === 0) {
		return 0;
	}
	const highlight = entry.hi;
	let segmentStartColumn = editorViewState.layout.clampLineLength(line.length, editorViewState.scrollColumn);
	let segmentEndColumn = line.length;
	const resolvedSegment = editorPointerState.lastPointerRowResolution?.segment;
	if (editorViewState.wordWrapEnabled && resolvedSegment && resolvedSegment.row === row) {
		segmentStartColumn = resolvedSegment.startColumn;
		segmentEndColumn = resolvedSegment.endColumn;
	}
	const segmentStart = editorViewState.layout.clampSegmentStart(line.length, segmentStartColumn);
	const segmentEnd = editorViewState.layout.clampSegmentEnd(line.length, segmentStart, segmentEndColumn);
	const effectiveStartColumn = segmentStart;
	const startDisplay = editorViewState.layout.columnToDisplay(highlight, effectiveStartColumn);
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
		return editorViewState.wordWrapEnabled ? segmentEnd : line.length;
	}
	const midpoint = entry.advancePrefix[displayIndex] + (entry.advancePrefix[displayIndex + 1] - entry.advancePrefix[displayIndex]) * 0.5;
	let column = entry.displayToColumn[displayIndex];
	if (column === undefined) {
		column = line.length;
	}
	if (target >= midpoint) {
		column += 1;
	}
	if (editorViewState.wordWrapEnabled) {
		column = editorViewState.layout.clampLineLength(line.length, column);
		column = editorViewState.layout.clampSegmentEnd(line.length, segmentStart, column);
	}
	if (column < segmentStart) {
		column = segmentStart;
	}
	return editorViewState.layout.clampLineLength(line.length, column);
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
	editorViewState.scrollRow = editorViewState.layout.clampVisualScroll(editorViewState.scrollRow + rowDelta, getVisualLineCount(), rows);
	const maxScrollColumn = computeMaximumScrollColumn();
	if (viewportX >= bounds.gutterLeft && !editorViewState.wordWrapEnabled) {
		if (viewportX < bounds.textLeft) {
			editorViewState.scrollColumn -= 1;
		} else if (viewportX >= bounds.codeRight) {
			editorViewState.scrollColumn += 1;
		}
		editorViewState.scrollColumn = editorViewState.layout.clampHorizontalScroll(editorViewState.scrollColumn, maxScrollColumn);
	}
	if (editorViewState.wordWrapEnabled) {
		editorViewState.scrollColumn = 0;
	}
}

export function scrollRows(deltaRows: number): void {
	if (deltaRows === 0) {
		return;
	}
	ensureVisualLines();
	editorViewState.scrollRow = editorViewState.layout.clampVisualScroll(editorViewState.scrollRow + deltaRows, getVisualLineCount(), visibleRowCount());
}

export function getCreateResourceBarHeight(): number {
	if (!editorFeatureState.createResource.visible) {
		return 0;
	}
	return editorViewState.lineHeight + constants.CREATE_RESOURCE_BAR_MARGIN_Y * 2;
}

export function getSearchBarHeight(): number {
	if (!editorFeatureState.search.visible) {
		return 0;
	}
	const baseHeight = editorViewState.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	const visible = searchVisibleResultCount();
	if (visible <= 0) {
		return baseHeight;
	}
	return baseHeight + constants.SEARCH_RESULT_SPACING + visible * searchResultEntryHeight();
}

export function getResourceSearchBarHeight(): number {
	if (!editorFeatureState.resourceSearch.visible) {
		return 0;
	}
	const baseHeight = editorViewState.lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
	const visible = resourceSearchVisibleResultCount();
	if (visible <= 0) {
		return baseHeight;
	}
	return baseHeight + constants.QUICK_OPEN_RESULT_SPACING + visible * resourceSearchEntryHeight();
}

export function getSymbolSearchBarHeight(): number {
	if (!editorFeatureState.symbolSearch.visible) {
		return 0;
	}
	const baseHeight = editorViewState.lineHeight + constants.SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
	const visible = symbolSearchVisibleResultCount();
	if (visible <= 0) {
		return baseHeight;
	}
	return baseHeight + constants.SYMBOL_SEARCH_RESULT_SPACING + visible * symbolSearchEntryHeight();
}

export function getRenameBarHeight(): number {
	if (!renameController.isVisible()) {
		return 0;
	}
	return editorViewState.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
}

export function getLineJumpBarHeight(): number {
	if (!editorFeatureState.lineJump.visible) {
		return 0;
	}
	return editorViewState.lineHeight + constants.LINE_JUMP_BAR_MARGIN_Y * 2;
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
	let top = editorViewState.headerHeight + getTabBarTotalHeight();
	for (let i = 0; i < barIndex; i++) {
		top += barHeightGetters[i]();
	}
	return { top, bottom: top + height, left: 0, right: editorViewState.viewportWidth };
}

export function getCreateResourceBarBounds(): BarBounds { return computeBarBounds(0); }
export function getSearchBarBounds(): BarBounds { return computeBarBounds(1); }
export function getResourceSearchBarBounds(): BarBounds { return computeBarBounds(2); }
export function getSymbolSearchBarBounds(): BarBounds { return computeBarBounds(3); }
export function getRenameBarBounds(): BarBounds { return computeBarBounds(4); }
export function getLineJumpBarBounds(): BarBounds { return computeBarBounds(5); }

export function configureFontVariant(variant: FontVariant): void {
	editorViewState.fontVariant = variant;
	editorViewState.font = new EditorFont(variant);
	editorViewState.lineHeight = editorViewState.font.lineHeight;
	editorViewState.charAdvance = editorViewState.font.advance('M');
	editorViewState.spaceAdvance = editorViewState.font.advance(' ');
	editorViewState.inlineFieldMetricsRef = {
		advanceChar: (ch: string) => editorViewState.font.advance(ch),
		spaceAdvance: editorViewState.spaceAdvance,
		tabSpaces: constants.TAB_SPACES,
	};
	updateGutterWidth();
	editorViewState.headerHeight = editorViewState.lineHeight + 4;
	editorViewState.tabBarHeight = editorViewState.lineHeight + 3;
	editorViewState.baseBottomMargin = editorViewState.lineHeight + 6;
	editorViewState.layout = new CodeLayout(editorViewState.font, {
		maxHighlightCache: 512,
		semanticDebounceMs: 200,
		clockNow: editorRuntimeState.clockNow,
		getBuiltinIdentifiers: () => getBuiltinIdentifiersSnapshot(),
	});
	const activeContext = editorSessionState.activeCodeTabContextId ? editorSessionState.codeTabContexts.get(editorSessionState.activeCodeTabContextId) : null;
	if (activeContext) {
		editorViewState.layout.setCodeTabMode(activeContext.mode);
	}
	if (resourcePanel) {
		resourcePanel.setFontMetrics(editorViewState.lineHeight, editorViewState.charAdvance);
	}
	editorViewState.layout.invalidateAllHighlights();
	editorViewState.layout.markVisualLinesDirty();
}

export function setFontVariant(variant: FontVariant): void {
	configureFontVariant(variant);
	ensureVisualLines();
	editorCaretState.cursorRevealSuspended = false;
	ensureCursorVisible();
	rewrapRuntimeErrorOverlays();
	requestSemanticRefresh();
	markDiagnosticsDirty(editorSessionState.activeCodeTabContextId);
}

export function toggleWordWrap(): void {
	ensureVisualLines();
	const previousWrap = editorViewState.wordWrapEnabled;
	const previousTopIndex = editorViewState.layout.clampVisualIndex(getVisualLineCount(), editorViewState.scrollRow);
	const previousTopSegment = visualIndexToSegment(previousTopIndex);
	const anchorRow = previousTopSegment ? previousTopSegment.row : editorDocumentState.cursorRow;
	const anchorColumnForWrap = previousTopSegment ? previousTopSegment.startColumn : 0;
	const anchorColumnForUnwrap = previousTopSegment
		? (previousWrap ? previousTopSegment.startColumn : editorViewState.scrollColumn)
		: editorViewState.scrollColumn;
	const previousCursorRow = editorDocumentState.cursorRow;
	const previousCursorColumn = editorDocumentState.cursorColumn;
	const previousDesiredColumn = editorDocumentState.desiredColumn;

	editorViewState.wordWrapEnabled = !previousWrap;
	editorCaretState.cursorRevealSuspended = false;
	editorViewState.layout.markVisualLinesDirty();
	ensureVisualLines();

	editorDocumentState.cursorRow = editorViewState.layout.clampBufferRow(editorDocumentState.buffer, previousCursorRow);
	const currentLine = editorDocumentState.buffer.getLineContent(editorDocumentState.cursorRow);
	editorDocumentState.cursorColumn = editorViewState.layout.clampLineLength(currentLine.length, previousCursorColumn);
	editorDocumentState.desiredColumn = previousDesiredColumn;

	if (editorViewState.wordWrapEnabled) {
		editorViewState.scrollColumn = 0;
		editorViewState.scrollRow = editorViewState.layout.clampVisualScroll(positionToVisualIndex(anchorRow, anchorColumnForWrap), getVisualLineCount(), visibleRowCount());
	} else {
		editorViewState.scrollColumn = editorViewState.layout.clampHorizontalScroll(anchorColumnForUnwrap, computeMaximumScrollColumn());
		editorViewState.scrollRow = editorViewState.layout.clampVisualScroll(positionToVisualIndex(anchorRow, editorViewState.scrollColumn), getVisualLineCount(), visibleRowCount());
	}
	editorPointerState.lastPointerRowResolution = null;
	ensureCursorVisible();
	updateDesiredColumn();
	showEditorMessage(editorViewState.wordWrapEnabled ? 'Word wrap enabled' : 'Word wrap disabled', constants.COLOR_STATUS_TEXT, 2.5);
}

export function notifyReadOnlyEdit(): void {
	showEditorMessage('Tab is read-only', constants.COLOR_STATUS_WARNING, 1.5);
}

export function hideResourcePanel(): void {
	resourcePanel.hide();
	editorChromeState.resourcePanelResizing = false;
	resetResourcePanelState();
}

export function resetResourcePanelState(): void {
	editorSessionState.pendingResourceSelectionAssetId = null;
	editorChromeState.resourcePanelResizing = false;
}

export function refreshResourcePanelContents(): void {
	resourcePanel.refresh();
}

export function selectResourceInPanel(descriptor: ResourceDescriptor): void {
	if (!descriptor.asset_id || descriptor.asset_id.length === 0) {
		return;
	}
	editorSessionState.pendingResourceSelectionAssetId = descriptor.asset_id;
	if (resourcePanel.isVisible()) {
		applyPendingResourceSelection();
	}
}

export function applyPendingResourceSelection(): void {
	if (!resourcePanel.isVisible() || !editorSessionState.pendingResourceSelectionAssetId) {
		return;
	}
	const index = findResourcePanelIndexByAssetId(resourcePanel.items, editorSessionState.pendingResourceSelectionAssetId);
	if (index === -1) {
		return;
	}
	resourcePanel.setSelectionIndex(index);
	resourcePanel.ensureSelectionVisible();
	editorSessionState.pendingResourceSelectionAssetId = null;
}

export function getResourcePanelWidth(): number {
	if (!resourcePanel.isVisible()) {
		return 0;
	}
	const bounds = resourcePanel.getBounds();
	if (!bounds) {
		return 0;
	}
	return Math.max(0, bounds.right - bounds.left);
}

export function scrollResourceBrowser(amount: number): void {
	if (!resourcePanel.isVisible()) {
		return;
	}
	resourcePanel.scrollBy(amount);
}
