import type { VideoSurface } from '../../../../machine/ts/platform/platform';
import { EditorFont } from './font';
import type { FontVariant } from '../../../../machine/ts/render/shared/bmsx_font';
import type { HostClock } from '../../../../machine/ts/platform/platform';
import type { Viewport } from '../../../common/viewport';
import * as constants from '../../../common/constants';
import { CodeLayout } from '../code/layout';
import { markDiagnosticsDirty } from '../../contrib/diagnostics/state';
import { showEditorMessage } from '../../../common/feedback_state';
import { editorPointerState } from '../../../input/pointer/state';
import { editorCaretState } from './caret/state';
import { getBuiltinIdentifiersSnapshot, requestSemanticRefresh } from '../../contrib/intellisense/engine';
import { ensureCursorVisible, updateDesiredColumn } from './caret/caret';
import { editorDocumentState, type EditorDocumentMode } from '../../editing/document_state';
import { editorViewState } from './state';
import {
	ensureVisualLines,
} from '../../common/text/layout';
import { rewrapRuntimeErrorOverlays } from '../../../runtime_error/navigation';
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

export function applyViewportSize(viewport: Viewport): void {
	editorViewState.viewportWidth = viewport.width;
	editorViewState.viewportHeight = viewport.height;
	editorViewState.codeAreaTop = 0;
	editorViewState.codeAreaBottom = viewport.height;
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

export function mapScreenPointToViewport(
	surface: VideoSurface,
	screenX: number,
	screenY: number,
): { x: number; y: number; inside: boolean; valid: boolean } {
	const rect = surface.measureDisplay();
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
	return editorViewState.codeAreaTop;
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
	codeAreaBounds.codeTop = editorViewState.codeAreaTop;
	codeAreaBounds.codeBottom = editorViewState.codeAreaBottom;
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
	let lower = startDisplay + 1;
	let upper = entry.advancePrefix.length;
	while (lower < upper) {
		const midpointIndex = (lower + upper) >>> 1;
		if (entry.advancePrefix[midpointIndex] < target) {
			lower = midpointIndex + 1;
		} else {
			upper = midpointIndex;
		}
	}
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

export function configureFontVariant(
	clock: HostClock,
	variant: FontVariant,
	activeDocumentMode: EditorDocumentMode | null,
): void {
	editorViewState.fontVariant = variant;
	editorViewState.font = new EditorFont(variant);
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
		clock,
		getBuiltinIdentifiers: () => getBuiltinIdentifiersSnapshot(),
		computeWrapWidth,
	});
	if (activeDocumentMode) {
		editorViewState.layout.setDocumentMode(activeDocumentMode);
	}
	editorViewState.layout.invalidateAllHighlights();
	editorViewState.layout.markVisualLinesDirty();
}

export function setFontVariant(
	clock: HostClock,
	variant: FontVariant,
	activeDocumentMode: EditorDocumentMode | null,
	activeContextId: string | null,
): void {
	configureFontVariant(clock, variant, activeDocumentMode);
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
