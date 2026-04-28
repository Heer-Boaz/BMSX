import { engineCore } from '../../../../core/engine';
import { lower_bound } from '../../../../common/lower_bound';
import { EditorFont } from './font';
import type { Runtime } from '../../../../machine/runtime/runtime';
import type { FontVariant } from '../../../../render/shared/bmsx_font';
import type { Viewport } from '../../../../rompack/format';
import * as constants from '../../../common/constants';
import type { CodeTabMode } from '../../../common/models';
import { CodeLayout } from '../code/layout';
import { markDiagnosticsDirty } from '../../contrib/diagnostics/analysis';
import { computeSearchPageStats } from '../../contrib/find/search';
import { showEditorMessage } from '../../../common/feedback_state';
import { editorPointerState } from '../../../input/pointer/state';
import { editorCaretState } from './caret/state';
import { getBuiltinIdentifiersSnapshot, requestSemanticRefresh } from '../../contrib/intellisense/engine';
import { ensureCursorVisible, updateDesiredColumn } from './caret/caret';
import { editorDocumentState } from '../../editing/document_state';
import { editorViewState } from './state';
import { editorSearchState, lineJumpState } from '../../contrib/find/widget_state';
import { symbolSearchState } from '../../contrib/symbols/search/state';
import { renameController } from '../../contrib/rename/controller';
import { editorRuntimeState } from '../../common/runtime_state';
import {
	ensureVisualLines,
} from '../../common/text/layout';
import { rewrapRuntimeErrorOverlays } from '../../../runtime_error/navigation';
import { bottomMargin, topMargin } from '../../../workbench/common/layout';
import { createResourceState, resourceSearchState } from '../../../workbench/contrib/resources/widget_state';
import type { InlineFieldMetrics } from '../inline/text_field';

function advanceInlineFieldChar(ch: string): number {
	return editorViewState.font.advance(ch);
}

const editorInlineFieldMetrics: InlineFieldMetrics = {
	advanceChar: advanceInlineFieldChar,
	spaceAdvance: 0,
	tabSpaces: constants.TAB_SPACES,
};

function decimalDigitCount(value: number): number {
	let digits = 1;
	let remaining = value > 1 ? value : 1;
	while (remaining >= 10) {
		remaining = (remaining / 10) | 0;
		digits += 1;
	}
	return digits;
}

export function getBreakpointLaneWidth(): number {
	const width = editorViewState.charAdvance + 2;
	return width > 6 ? width : 6;
}

export function updateGutterWidth(): number {
	const lineCount = editorDocumentState.buffer.getLineCount();
	const computedDigits = decimalDigitCount(lineCount);
	const digitCount = computedDigits > 2 ? computedDigits : 2;
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
	const limit = maximumLineLength() - editorViewState.cachedVisibleColumnCount;
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
	return resourceSearchState.visible ? resourceSearchPageSize() : 0;
}

export function resourceSearchVisibleResultCount(): number {
	if (!resourceSearchState.visible) {
		return 0;
	}
	const remainingCandidate = resourceSearchState.matches.length - resourceSearchState.displayOffset;
	const remaining = remainingCandidate > 0 ? remainingCandidate : 0;
	const capacity = resourceSearchWindowCapacity();
	if (capacity <= 0) {
		return remaining;
	}
	return remaining < capacity ? remaining : capacity;
}

export function isSymbolSearchCompactMode(): boolean {
	return editorViewState.viewportWidth <= constants.SYMBOL_SEARCH_COMPACT_WIDTH;
}

export function symbolSearchEntryHeight(): number {
	if (symbolSearchState.mode === 'references') {
		return editorViewState.lineHeight * 2;
	}
	return symbolSearchState.global && isSymbolSearchCompactMode() ? editorViewState.lineHeight * 2 : editorViewState.lineHeight;
}

export function symbolSearchPageSize(): number {
	if (symbolSearchState.mode === 'references') {
		return constants.REFERENCE_SEARCH_MAX_RESULTS;
	}
	if (!symbolSearchState.global) {
		return constants.SYMBOL_SEARCH_MAX_RESULTS;
	}
	return isSymbolSearchCompactMode() ? constants.SYMBOL_SEARCH_COMPACT_MAX_RESULTS : constants.SYMBOL_SEARCH_MAX_RESULTS;
}

export function symbolSearchVisibleResultCount(): number {
	if (!symbolSearchState.visible) {
		return 0;
	}
	const remainingCandidate = symbolSearchState.matches.length - symbolSearchState.displayOffset;
	const remaining = remainingCandidate > 0 ? remainingCandidate : 0;
	const pageSize = symbolSearchPageSize();
	return remaining < pageSize ? remaining : pageSize;
}

export function applyViewportSize(viewport: Viewport): void {
	editorViewState.viewportWidth = viewport.width;
	editorViewState.viewportHeight = viewport.height;
	editorPointerState.lastPointerRowResolution = null;
}

export function updateViewport(viewport: Viewport): void {
	applyViewportSize(viewport);
	refreshViewportLayout();
}

export function refreshViewportLayout(): void {
	editorViewState.layout.markVisualLinesDirty();
	editorCaretState.cursorRevealSuspended = false;
	ensureCursorVisible();
	rewrapRuntimeErrorOverlays();
}

export function mapScreenPointToViewport(screenX: number, screenY: number): { x: number; y: number; inside: boolean; valid: boolean } {
	const view = engineCore.view;
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
		x: ((relativeX / rect.width) * editorViewState.viewportWidth) | 0,
		y: ((relativeY / rect.height) * editorViewState.viewportHeight) | 0,
		inside,
		valid: true,
	};
}

export function codeViewportTop(): number {
	writeInlineBarLayout();
	return inlineBarLayout.codeViewportTop;
}

export type CodeAreaBounds = {
	codeTop: number;
	codeBottom: number;
	codeLeft: number;
	codeRight: number;
	gutterLeft: number;
	gutterRight: number;
	textLeft: number;
};

const codeAreaBounds: CodeAreaBounds = {
	codeTop: 0,
	codeBottom: 0,
	codeLeft: 0,
	codeRight: 0,
	gutterLeft: 0,
	gutterRight: 0,
	textLeft: 0,
};

export function getCodeAreaBounds(): CodeAreaBounds {
	const codeLeft = editorViewState.codeAreaLeft;
	const gutterLeft = codeLeft;
	const gutterRight = gutterLeft + updateGutterWidth();
	codeAreaBounds.codeTop = codeViewportTop();
	codeAreaBounds.codeBottom = editorViewState.viewportHeight - bottomMargin();
	codeAreaBounds.codeLeft = codeLeft;
	codeAreaBounds.codeRight = editorViewState.viewportWidth;
	codeAreaBounds.gutterLeft = gutterLeft;
	codeAreaBounds.gutterRight = gutterRight;
	codeAreaBounds.textLeft = gutterRight + 2;
	return codeAreaBounds;
}

export type PointerTextPosition = {
	row: number;
	column: number;
};

const pointerTextPosition: PointerTextPosition = {
	row: 0,
	column: 0,
};

export function resolvePointerRow(viewportY: number, bounds: CodeAreaBounds = getCodeAreaBounds()): number {
	ensureVisualLines();
	const relativeY = viewportY - bounds.codeTop;
	let visualIndex = editorViewState.scrollRow + ((relativeY / editorViewState.lineHeight) | 0);
	const visualCount = editorViewState.layout.getVisualLineCount();
	const visualLimit = visualCount > 1 ? visualCount : 1;
	visualIndex = editorViewState.layout.clampVisualIndex(visualLimit, visualIndex);
	const segment = editorViewState.layout.visualIndexToSegment(visualIndex);
	if (!segment) {
		editorPointerState.lastPointerRowResolution = null;
		return editorViewState.layout.clampBufferRow(editorDocumentState.buffer, visualIndex);
	}
	editorPointerState.lastPointerRowResolution = { visualIndex, segment };
	return segment.row;
}

export function resolvePointerColumn(row: number, viewportX: number, bounds: CodeAreaBounds = getCodeAreaBounds()): number {
	const entry = editorViewState.layout.getCachedHighlight(editorDocumentState.buffer, row);
	const line = entry.src;
	if (line.length === 0) {
		return 0;
	}
	const highlight = entry.hi;
	let segmentStartColumn = editorViewState.layout.clampLineLength(line.length, editorViewState.scrollColumn);
	let segmentEndColumn = line.length;
	const lastPointerRowResolution = editorPointerState.lastPointerRowResolution;
	if (editorViewState.wordWrapEnabled && lastPointerRowResolution && lastPointerRowResolution.segment.row === row) {
		const resolvedSegment = lastPointerRowResolution.segment;
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

export function resolvePointerTextPosition(viewportX: number, viewportY: number, bounds: CodeAreaBounds = getCodeAreaBounds()): PointerTextPosition {
	const row = resolvePointerRow(viewportY, bounds);
	pointerTextPosition.row = row;
	pointerTextPosition.column = resolvePointerColumn(row, viewportX, bounds);
	return pointerTextPosition;
}

export function handlePointerAutoScroll(viewportX: number, viewportY: number, bounds: CodeAreaBounds = getCodeAreaBounds()): void {
	if (!editorPointerState.pointerSelecting) {
		return;
	}
	ensureVisualLines();
	let rowDelta = 0;
	if (viewportY < bounds.codeTop) {
		rowDelta = -1;
	} else if (viewportY >= bounds.codeBottom) {
		rowDelta = 1;
	}
	const rows = editorViewState.cachedVisibleRowCount;
	editorViewState.scrollRow = editorViewState.layout.clampVisualScroll(editorViewState.scrollRow + rowDelta, editorViewState.layout.getVisualLineCount(), rows);
	if (viewportX >= bounds.gutterLeft && !editorViewState.wordWrapEnabled) {
		if (viewportX < bounds.textLeft) {
			editorViewState.scrollColumn -= 1;
		} else if (viewportX >= bounds.codeRight) {
			editorViewState.scrollColumn += 1;
		}
		editorViewState.scrollColumn = editorViewState.layout.clampHorizontalScroll(editorViewState.scrollColumn, editorViewState.cachedMaxScrollColumn);
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
	editorViewState.scrollRow = editorViewState.layout.clampVisualScroll(editorViewState.scrollRow + deltaRows, editorViewState.layout.getVisualLineCount(), editorViewState.cachedVisibleRowCount);
}

export function getCreateResourceBarHeight(): number {
	if (!createResourceState.visible) {
		return 0;
	}
	return editorViewState.lineHeight + constants.CREATE_RESOURCE_BAR_MARGIN_Y * 2;
}

export function getSearchBarHeight(): number {
	if (!editorSearchState.visible) {
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
	if (!resourceSearchState.visible) {
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
	if (!symbolSearchState.visible) {
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
	if (!lineJumpState.visible) {
		return 0;
	}
	return editorViewState.lineHeight + constants.LINE_JUMP_BAR_MARGIN_Y * 2;
}

type BarBounds = { top: number; bottom: number; left: number; right: number };
type InlineBarLayout = {
	codeViewportTop: number;
	barHeight: number[];
	barBounds: BarBounds[];
};

function createBarBounds(): BarBounds {
	return { top: 0, bottom: 0, left: 0, right: 0 };
}

const barHeightGetters = [
	getCreateResourceBarHeight,
	getSearchBarHeight,
	getResourceSearchBarHeight,
	getSymbolSearchBarHeight,
	getRenameBarHeight,
	getLineJumpBarHeight,
] as const;

const inlineBarLayout: InlineBarLayout = {
	codeViewportTop: 0,
	barHeight: [0, 0, 0, 0, 0, 0],
	barBounds: [
		createBarBounds(),
		createBarBounds(),
		createBarBounds(),
		createBarBounds(),
		createBarBounds(),
		createBarBounds(),
	],
};

let inlineBarLayoutStamp = 0;
let inlineBarLayoutValid = false;

function addLayoutStamp(stamp: number, value: number): number {
	return ((stamp * 33) ^ value) | 0;
}

function computeInlineBarLayoutStamp(): number {
	let stamp = 5381;
	stamp = addLayoutStamp(stamp, editorViewState.viewportWidth);
	stamp = addLayoutStamp(stamp, editorViewState.viewportHeight);
	stamp = addLayoutStamp(stamp, editorViewState.headerHeight);
	stamp = addLayoutStamp(stamp, editorViewState.tabBarHeight);
	stamp = addLayoutStamp(stamp, editorViewState.tabBarRowCount);
	stamp = addLayoutStamp(stamp, editorViewState.lineHeight);
	stamp = addLayoutStamp(stamp, createResourceState.visible ? 1 : 0);
	stamp = addLayoutStamp(stamp, editorSearchState.visible ? 1 : 0);
	stamp = addLayoutStamp(stamp, editorSearchState.scope === 'global' ? 2 : 1);
	stamp = addLayoutStamp(stamp, editorSearchState.matches.length);
	stamp = addLayoutStamp(stamp, editorSearchState.globalMatches.length);
	stamp = addLayoutStamp(stamp, editorSearchState.displayOffset);
	stamp = addLayoutStamp(stamp, resourceSearchState.visible ? 1 : 0);
	stamp = addLayoutStamp(stamp, resourceSearchState.matches.length);
	stamp = addLayoutStamp(stamp, resourceSearchState.displayOffset);
	stamp = addLayoutStamp(stamp, symbolSearchState.visible ? 1 : 0);
	stamp = addLayoutStamp(stamp, symbolSearchState.matches.length);
	stamp = addLayoutStamp(stamp, symbolSearchState.displayOffset);
	stamp = addLayoutStamp(stamp, symbolSearchState.global ? 1 : 0);
	stamp = addLayoutStamp(stamp, symbolSearchState.mode === 'references' ? 2 : 1);
	stamp = addLayoutStamp(stamp, renameController.isVisible() ? 1 : 0);
	stamp = addLayoutStamp(stamp, renameController.getMatchCount() || 0);
	stamp = addLayoutStamp(stamp, lineJumpState.visible ? 1 : 0);
	return stamp;
}

function writeInlineBarLayout(): void {
	const stamp = computeInlineBarLayoutStamp();
	if (inlineBarLayoutValid && stamp === inlineBarLayoutStamp) {
		return;
	}
	inlineBarLayoutValid = true;
	inlineBarLayoutStamp = stamp;
	let top = topMargin();
	for (let index = 0; index < barHeightGetters.length; index += 1) {
		const height = barHeightGetters[index]();
		const bounds = inlineBarLayout.barBounds[index];
		inlineBarLayout.barHeight[index] = height;
		if (height <= 0) {
			bounds.left = 0;
			bounds.top = top;
			bounds.right = 0;
			bounds.bottom = top;
			continue;
		}
		bounds.left = 0;
		bounds.top = top;
		bounds.right = editorViewState.viewportWidth;
		bounds.bottom = top + height;
		top = bounds.bottom;
	}
	inlineBarLayout.codeViewportTop = top;
}

export function refreshInlineBarLayout(): void {
	writeInlineBarLayout();
}

function getInlineBarBounds(barIndex: number): BarBounds {
	writeInlineBarLayout();
	if (inlineBarLayout.barHeight[barIndex] <= 0) {
		return null;
	}
	return inlineBarLayout.barBounds[barIndex];
}

export function getCreateResourceBarBounds(): BarBounds { return getInlineBarBounds(0); }
export function getSearchBarBounds(): BarBounds { return getInlineBarBounds(1); }
export function getResourceSearchBarBounds(): BarBounds { return getInlineBarBounds(2); }
export function getSymbolSearchBarBounds(): BarBounds { return getInlineBarBounds(3); }
export function getRenameBarBounds(): BarBounds { return getInlineBarBounds(4); }
export function getLineJumpBarBounds(): BarBounds { return getInlineBarBounds(5); }

export function configureFontVariant(runtime: Runtime, variant: FontVariant, activeCodeTabMode: CodeTabMode | null): void {
	editorViewState.fontVariant = variant;
	editorViewState.font = new EditorFont(runtime, variant);
	editorViewState.lineHeight = editorViewState.font.lineHeight;
	editorViewState.charAdvance = editorViewState.font.advance('M');
	editorViewState.spaceAdvance = editorViewState.font.advance(' ');
	editorInlineFieldMetrics.spaceAdvance = editorViewState.spaceAdvance;
	editorViewState.inlineFieldMetricsRef = editorInlineFieldMetrics;
	updateGutterWidth();
	editorViewState.headerHeight = editorViewState.lineHeight + 4;
	editorViewState.tabBarHeight = editorViewState.lineHeight + 3;
	editorViewState.baseBottomMargin = editorViewState.lineHeight + 6;
	editorViewState.layout = new CodeLayout(editorViewState.font, {
		maxHighlightCache: 512,
		semanticDebounceMs: 200,
		clockNow: editorRuntimeState.clockNow,
		getBuiltinIdentifiers: () => getBuiltinIdentifiersSnapshot(runtime),
		computeWrapWidth,
	});
	if (activeCodeTabMode) {
		editorViewState.layout.setCodeTabMode(activeCodeTabMode);
	}
	editorViewState.layout.invalidateAllHighlights();
	editorViewState.layout.markVisualLinesDirty();
}

export function setFontVariant(runtime: Runtime, variant: FontVariant, activeCodeTabMode: CodeTabMode | null, activeContextId: string | null): void {
	configureFontVariant(runtime, variant, activeCodeTabMode);
	ensureVisualLines();
	editorCaretState.cursorRevealSuspended = false;
	ensureCursorVisible();
	rewrapRuntimeErrorOverlays();
	requestSemanticRefresh();
	markDiagnosticsDirty(activeContextId);
}

export function toggleWordWrap(): void {
	ensureVisualLines();
	const previousWrap = editorViewState.wordWrapEnabled;
	const previousVisualCount = editorViewState.layout.getVisualLineCount();
	const previousTopIndex = editorViewState.layout.clampVisualIndex(previousVisualCount, editorViewState.scrollRow);
	const previousTopSegment = editorViewState.layout.visualIndexToSegment(previousTopIndex);
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
	const currentVisualCount = editorViewState.layout.getVisualLineCount();

	editorDocumentState.cursorRow = editorViewState.layout.clampBufferRow(editorDocumentState.buffer, previousCursorRow);
	const currentLine = editorDocumentState.buffer.getLineContent(editorDocumentState.cursorRow);
	editorDocumentState.cursorColumn = editorViewState.layout.clampLineLength(currentLine.length, previousCursorColumn);
	editorDocumentState.desiredColumn = previousDesiredColumn;

	if (editorViewState.wordWrapEnabled) {
		editorViewState.scrollColumn = 0;
		editorViewState.scrollRow = editorViewState.layout.clampVisualScroll(editorViewState.layout.positionToVisualIndex(anchorRow, anchorColumnForWrap), currentVisualCount, editorViewState.cachedVisibleRowCount);
	} else {
		editorViewState.scrollColumn = editorViewState.layout.clampHorizontalScroll(anchorColumnForUnwrap, computeMaximumScrollColumn());
		editorViewState.scrollRow = editorViewState.layout.clampVisualScroll(editorViewState.layout.positionToVisualIndex(anchorRow, editorViewState.scrollColumn), currentVisualCount, editorViewState.cachedVisibleRowCount);
	}
	editorPointerState.lastPointerRowResolution = null;
	ensureCursorVisible();
	updateDesiredColumn();
	showEditorMessage(editorViewState.wordWrapEnabled ? 'Word wrap enabled' : 'Word wrap disabled', constants.COLOR_STATUS_TEXT, 2.5);
}

export function notifyReadOnlyEdit(): void {
	showEditorMessage('Tab is read-only', constants.COLOR_STATUS_WARNING, 1.5);
}

export function getResourcePanelWidth(): number {
	const width = editorViewState.codeAreaLeft;
	return width > 0 ? width : 0;
}

export function computeWrapWidth(): number {
	const bounds = getCodeAreaBounds();
	const available = bounds.codeRight - bounds.textLeft;
	const width = available - 2;
	return width > editorViewState.charAdvance ? width : editorViewState.charAdvance;
}
