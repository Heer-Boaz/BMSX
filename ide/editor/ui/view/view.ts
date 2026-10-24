import { getWorkbenchEditorBounds } from '../../../workbench/common/layout';
import { write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { EditorFont } from './font';
import type { FontVariant } from '../../../../machine/ts/render/shared/bmsx_font';
import type { HostClock } from '../../../../hosts/common/clock';
import type { Viewport } from '../../../common/viewport';

import * as constants from '../../../common/constants';
import { CodeLayout } from '../code/layout';
import { resolveCodeAreaViewport } from '../code/area_viewport';
import { showEditorMessage } from '../../../common/feedback_state';
import { editorPointerState } from '../../../input/pointer/state';
import { editorCaretState } from './caret/state';
import { getBuiltinIdentifiersSnapshot, requestSemanticRefresh } from '../../contrib/intellisense/engine';
import { ensureCursorVisible, updateDesiredColumn } from './caret/view';
import { activeCodeEditor } from '../code_editor_state';
import type { EditorDocumentMode } from '../../model/text_model';
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
	const lineCount = activeCodeEditor.model.buffer.getLineCount();
	const computedDigits = decimalDigitCount(lineCount);
	const digitCount = computedDigits > 2 ? computedDigits : 2;
	editorViewState.gutterWidth = getBreakpointLaneWidth() + 4 + digitCount * editorViewState.font.advance('0');
	return editorViewState.gutterWidth;
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
	activeCodeEditor.clearVisualCursor();
	editorViewState.layout.markVisualLinesDirty();
	editorCaretState.cursorRevealSuspended = false;
	ensureCursorVisible();
	rewrapRuntimeErrorOverlays();
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
	const bounds = getWorkbenchEditorBounds();
	const gutterLeft = bounds.left;
	const gutterRight = gutterLeft + updateGutterWidth();
	codeAreaBounds.codeTop = editorViewState.codeAreaTop;
	codeAreaBounds.codeBottom = bounds.bottom;
	codeAreaBounds.codeLeft = bounds.left;
	codeAreaBounds.codeRight = bounds.right;
	codeAreaBounds.gutterLeft = gutterLeft;
	codeAreaBounds.gutterRight = gutterRight;
	codeAreaBounds.textLeft = gutterRight + 2;
	return codeAreaBounds;
}

export type PointerTextPosition = {
	row: number;
	column: number;
	injected: boolean;
};

const pointerTextPosition: PointerTextPosition = {
	row: 0,
	column: 0,
	injected: false,
};

export function resolvePointerRow(viewportY: number, bounds: CodeAreaBounds = getCodeAreaBounds()): number {
	ensureVisualLines();
	const relativeY = viewportY - bounds.codeTop;
	let visualIndex = (activeCodeEditor.view.scrollRow | 0) + ((relativeY / editorViewState.lineHeight) | 0);
	const visualCount = editorViewState.layout.getVisualLineCount();
	const visualLimit = visualCount > 1 ? visualCount : 1;
	visualIndex = editorViewState.layout.clampVisualIndex(visualLimit, visualIndex);
	const segment = editorViewState.layout.visualIndexToSegment(visualIndex);
	if (!segment) {
		editorPointerState.lastPointerRowResolution = null;
		return editorViewState.layout.clampBufferRow(activeCodeEditor.model.buffer, visualIndex);
	}
	editorPointerState.lastPointerRowResolution = { visualIndex, segment };
	return segment.row;
}

export function resolvePointerTextPosition(viewportX: number, viewportY: number, bounds: CodeAreaBounds = getCodeAreaBounds()): PointerTextPosition {
	const row = resolvePointerRow(viewportY, bounds);
	const layout = editorViewState.layout;
	const entry = layout.getViewLine(activeCodeEditor.model.buffer, row);
	let startDisplay = 0;
	let endDisplay = entry.hi.text.length;
	let pixelOffset = activeCodeEditor.view.scrollLeft;
	const lastPointerRowResolution = editorPointerState.lastPointerRowResolution;
	if (editorViewState.wordWrapEnabled && lastPointerRowResolution && lastPointerRowResolution.segment.row === row) {
		const resolvedSegment = lastPointerRowResolution.segment;
		startDisplay = resolvedSegment.startDisplay;
		endDisplay = resolvedSegment.endDisplay;
		pixelOffset = entry.advancePrefix[startDisplay];
	}
	const pixel = pixelOffset + viewportX - bounds.textLeft, inline = entry.inline;
	pointerTextPosition.row = row;
	pointerTextPosition.column = layout.hitTestColumn(entry, startDisplay, endDisplay, pixel - entry.advancePrefix[startDisplay]);
	pointerTextPosition.injected = inline !== null && viewportX >= bounds.textLeft && pixel < entry.advancePrefix[endDisplay]
		&& pixel >= entry.advancePrefix[inline.startDisplay] && pixel < entry.advancePrefix[inline.endDisplay];
	return pointerTextPosition;
}

/** Source-position geometry uses the same retained glyph advances and wrapped rows as rendering. */
export function resolveTextPositionBounds(row: number, column: number, out: RectBounds): void {
	ensureVisualLines();
	const layout = editorViewState.layout;
	const bounds = getCodeAreaBounds();
	const visual = layout.positionToVisualIndex(activeCodeEditor.model.buffer, row, column);
	const segment = layout.visualIndexToSegment(visual)!;
	const entry = layout.getViewLine(activeCodeEditor.model.buffer, row);
	const offset = editorViewState.wordWrapEnabled ? entry.advancePrefix[segment.startDisplay] : activeCodeEditor.view.scrollLeft;
	const display = layout.columnToDisplay(entry.hi, column);
	const x = bounds.textLeft + entry.advancePrefix[display] - offset;
	const y = bounds.codeTop + (visual - (activeCodeEditor.view.scrollRow | 0)) * editorViewState.lineHeight;
	write_rect_bounds(out, x, y, x + layout.cursorWidth(entry, display), y + editorViewState.lineHeight);
}

export function handlePointerAutoScroll(viewportX: number, viewportY: number, bounds: CodeAreaBounds = getCodeAreaBounds()): boolean {
	if (!editorPointerState.pointerSelecting) {
		return false;
	}
	const previousRow = activeCodeEditor.view.scrollRow, previousColumn = activeCodeEditor.view.scrollLeft;
	ensureVisualLines();
	let rowDelta = 0;
	if (viewportY < bounds.codeTop) {
		rowDelta = -1;
	} else if (viewportY >= bounds.codeBottom) {
		rowDelta = 1;
	}
	const rows = editorViewState.cachedVisibleRowCount;
	activeCodeEditor.view.scrollRow = editorViewState.layout.clampVisualScroll(activeCodeEditor.view.scrollRow + rowDelta, editorViewState.layout.getVisualLineCount(), rows);
	if (viewportX >= bounds.gutterLeft && !editorViewState.wordWrapEnabled) {
		if (viewportX < bounds.textLeft) {
			activeCodeEditor.view.scrollLeft -= editorViewState.charAdvance;
		} else if (viewportX >= bounds.codeRight) {
			activeCodeEditor.view.scrollLeft += editorViewState.charAdvance;
		}
		activeCodeEditor.view.scrollLeft = editorViewState.layout.clampHorizontalScroll(activeCodeEditor.view.scrollLeft, editorViewState.cachedMaxScrollLeft);
	}
	if (editorViewState.wordWrapEnabled) {
		activeCodeEditor.view.scrollLeft = 0;
	}
	return activeCodeEditor.view.scrollRow !== previousRow || activeCodeEditor.view.scrollLeft !== previousColumn;
}

export function scrollRows(deltaRows: number): void {
	if (deltaRows === 0) {
		return;
	}
	ensureVisualLines();
	activeCodeEditor.view.scrollRow = editorViewState.layout.clampVisualScroll(activeCodeEditor.view.scrollRow + deltaRows, editorViewState.layout.getVisualLineCount(), editorViewState.cachedVisibleRowCount);
}

export function scrollHorizontally(deltaPixels: number): void {
	if (deltaPixels === 0 || editorViewState.wordWrapEnabled) return;
	activeCodeEditor.view.scrollLeft = editorViewState.layout.clampHorizontalScroll(
		activeCodeEditor.view.scrollLeft + deltaPixels, editorViewState.cachedMaxScrollLeft,
	);
}

export function configureFontVariant(
	clock: HostClock,
	variant: FontVariant,
	activeDocumentMode: EditorDocumentMode | null,
): void {
	activeCodeEditor.clearVisualCursor();
	editorViewState.fontVariant = variant;
	editorViewState.font = new EditorFont(variant);
	editorViewState.lineHeight = editorViewState.font.lineHeight;
	editorViewState.charAdvance = editorViewState.font.advance('M');
	editorViewState.spaceAdvance = editorViewState.font.advance(' ');
	editorInlineFieldMetrics.spaceAdvance = editorViewState.spaceAdvance;
	editorViewState.inlineFieldMetricsRef = editorInlineFieldMetrics;
	editorViewState.headerHeight = editorViewState.lineHeight + 4;
	editorViewState.tabBarHeight = editorViewState.lineHeight + 3;
	editorViewState.tabBarTotalHeight = editorViewState.tabBarHeight;
	editorViewState.baseBottomMargin = editorViewState.lineHeight + 6;
	editorViewState.layout = new CodeLayout(editorViewState.font, {
		inlineEdit: activeCodeEditor.inlineEdit,
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
	activeDocumentMode: EditorDocumentMode,
): void {
	configureFontVariant(clock, variant, activeDocumentMode);
	ensureVisualLines();
	editorCaretState.cursorRevealSuspended = false;
	ensureCursorVisible();
	rewrapRuntimeErrorOverlays();
	requestSemanticRefresh();
}

export function toggleWordWrap(): void {
	ensureVisualLines();
	const previousWrap = editorViewState.wordWrapEnabled;
	const previousVisualCount = editorViewState.layout.getVisualLineCount();
	const previousTopIndex = editorViewState.layout.clampVisualIndex(previousVisualCount, activeCodeEditor.view.scrollRow);
	const previousTopSegment = editorViewState.layout.visualIndexToSegment(previousTopIndex);
	const anchorRow = previousTopSegment.row;
	const anchorLine = editorViewState.layout.getViewLine(activeCodeEditor.model.buffer, anchorRow);
	const anchorPixel = previousWrap ? anchorLine.advancePrefix[previousTopSegment.startDisplay] : activeCodeEditor.view.scrollLeft;
	const anchorDisplay = previousWrap ? previousTopSegment.startDisplay : editorViewState.layout.displayAtPixel(anchorLine, anchorPixel);
	const previousCursorRow = activeCodeEditor.view.cursorRow;
	const previousCursorColumn = activeCodeEditor.view.cursorColumn;
	const previousDesiredColumn = activeCodeEditor.view.desiredColumn;
	activeCodeEditor.clearVisualCursor();

	editorViewState.wordWrapEnabled = !previousWrap;
	editorCaretState.cursorRevealSuspended = false;
	editorViewState.layout.markVisualLinesDirty();
	ensureVisualLines();
	const currentVisualCount = editorViewState.layout.getVisualLineCount();

	activeCodeEditor.view.cursorRow = editorViewState.layout.clampBufferRow(activeCodeEditor.model.buffer, previousCursorRow);
	const currentLine = activeCodeEditor.model.buffer.getLineContent(activeCodeEditor.view.cursorRow);
	activeCodeEditor.view.cursorColumn = editorViewState.layout.clampLineLength(currentLine.length, previousCursorColumn);
	activeCodeEditor.view.desiredColumn = previousDesiredColumn;

	if (editorViewState.wordWrapEnabled) {
		activeCodeEditor.view.scrollLeft = 0;
		activeCodeEditor.view.scrollRow = editorViewState.layout.clampVisualScroll(editorViewState.layout.displayToVisualIndex(anchorRow, anchorDisplay), currentVisualCount, editorViewState.cachedVisibleRowCount);
	} else {
		activeCodeEditor.view.scrollLeft = editorViewState.layout.clampHorizontalScroll(anchorPixel, resolveCodeAreaViewport().maxScrollLeft);
		activeCodeEditor.view.scrollRow = editorViewState.layout.clampVisualScroll(editorViewState.layout.displayToVisualIndex(anchorRow, anchorDisplay), currentVisualCount, editorViewState.cachedVisibleRowCount);
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
	// Break before the scrollbar lane and leave room for the block caret at end of line.
	const width = available - constants.SCROLLBAR_WIDTH - constants.CODE_AREA_RIGHT_MARGIN - editorViewState.charAdvance;
	return width > editorViewState.charAdvance ? width : editorViewState.charAdvance;
}
