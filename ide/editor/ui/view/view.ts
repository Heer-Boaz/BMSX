import type { CodeEditorControl } from '../code_editor_control';
import type { EditorTextModel } from '../../model/text_model';
import type { EditorFont } from './font';
import { write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';

import * as constants from '../../../common/constants';
import { resolveCodeAreaViewport } from '../code/area_viewport';
import { showEditorMessage } from '../../../common/feedback_state';
import { ensureCursorVisible, updateDesiredColumn } from './caret/view';
import {
	ensureVisualLines,
} from '../../common/text/layout';

function decimalDigitCount(value: number): number {
	let digits = 1;
	let remaining = value > 1 ? value : 1;
	while (remaining >= 10) {
		remaining = (remaining / 10) | 0;
		digits += 1;
	}
	return digits;
}

export function getBreakpointLaneWidth(font: EditorFont): number {
	const width = font.charAdvance + 2;
	return width > 6 ? width : 6;
}


const gutterMeasurements = new WeakMap<EditorTextModel, { font: EditorFont; lineCount: number; width: number }>();

/** Intrinsic gutter measurement is shared by retained-input constraints and attached code controls. */
export function measureGutterWidth(model: EditorTextModel, font: EditorFont): number {
	const lineCount = model.buffer.getLineCount();
	let measured = gutterMeasurements.get(model);
	if (measured === undefined) {
		measured = { font, lineCount: -1, width: 0 }; gutterMeasurements.set(model, measured);
	}
	if (measured.font !== font || measured.lineCount !== lineCount) {
		measured.font = font; measured.lineCount = lineCount;
		const computedDigits = decimalDigitCount(lineCount);
		const digitCount = computedDigits > 2 ? computedDigits : 2;
		measured.width = getBreakpointLaneWidth(font) + 4 + digitCount * font.advance('0');
	}
	return measured.width;
}

// A usable editing column is distinct from the wider comfortable reading budget.
const CODE_EDITOR_MINIMUM_COLUMNS = 16;

/** The code owner composes text columns (including a caret column), gutter and scroll/right lanes. */
export function measureCodeEditorWidth(model: EditorTextModel, font: EditorFont, columns = CODE_EDITOR_MINIMUM_COLUMNS + 1): number {
	return measureGutterWidth(model, font) + 2 + font.charAdvance * columns + constants.SCROLLBAR_WIDTH + constants.CODE_AREA_RIGHT_MARGIN;
}

export function refreshViewportLayout(code: CodeEditorControl): void {
	code.clearVisualCursor();
	code.layout.markVisualLinesDirty();
	code.caret.cursorRevealSuspended = false;
	ensureCursorVisible(code);
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

export function getCodeAreaBounds(code: CodeEditorControl): CodeAreaBounds {
	const bounds = code.geometry.clientBounds;
	const gutterLeft = bounds.left;
	const gutterRight = gutterLeft + measureGutterWidth(code.model, code.font);
	code.scratch.codeAreaBounds.codeTop = bounds.top;
	code.scratch.codeAreaBounds.codeBottom = bounds.bottom;
	code.scratch.codeAreaBounds.codeLeft = bounds.left;
	code.scratch.codeAreaBounds.codeRight = bounds.right;
	code.scratch.codeAreaBounds.gutterLeft = gutterLeft;
	code.scratch.codeAreaBounds.gutterRight = gutterRight;
	code.scratch.codeAreaBounds.textLeft = gutterRight + 2;
	return code.scratch.codeAreaBounds;
}

export type PointerTextPosition = {
	row: number;
	column: number;
	injected: boolean;
};

export function resolvePointerRow(code: CodeEditorControl, viewportY: number, bounds: CodeAreaBounds = getCodeAreaBounds(code)): number {
	ensureVisualLines(code);
	const relativeY = viewportY - bounds.codeTop;
	let visualIndex = (code.view.scrollRow | 0) + ((relativeY / code.lineHeight) | 0);
	const visualCount = code.layout.getVisualLineCount();
	const visualLimit = visualCount > 1 ? visualCount : 1;
	visualIndex = code.layout.clampVisualIndex(visualLimit, visualIndex);
	const segment = code.layout.visualIndexToSegment(visualIndex);
	code.scratch.pointerRowResolution.visualIndex = visualIndex;
	code.scratch.pointerRowResolution.segment = segment;
	code.pointer.lastPointerRowResolution = code.scratch.pointerRowResolution;
	return segment.row;
}

export function resolvePointerTextPosition(code: CodeEditorControl, viewportX: number, viewportY: number, bounds: CodeAreaBounds = getCodeAreaBounds(code)): PointerTextPosition {
	const row = resolvePointerRow(code, viewportY, bounds);
	const layout = code.layout;
	const entry = layout.getViewLine(row);
	let startDisplay = 0;
	let endDisplay = entry.hi.text.length;
	let pixelOffset = code.view.scrollLeft;
	const lastPointerRowResolution = code.pointer.lastPointerRowResolution;
	if (code.view.wordWrapEnabled && lastPointerRowResolution && lastPointerRowResolution.segment.row === row) {
		const resolvedSegment = lastPointerRowResolution.segment;
		startDisplay = resolvedSegment.startDisplay;
		endDisplay = resolvedSegment.endDisplay;
		pixelOffset = layout.segmentPixelOffset(entry, resolvedSegment, code.view.scrollLeft, true);
	}
	const pixel = pixelOffset + viewportX - bounds.textLeft, inline = entry.inline;
	code.scratch.pointerTextPosition.row = row;
	code.scratch.pointerTextPosition.column = layout.hitTestColumn(entry, startDisplay, endDisplay, pixel - entry.advancePrefix[startDisplay]);
	code.scratch.pointerTextPosition.injected = inline !== null && viewportX >= bounds.textLeft
		&& pixel >= entry.advancePrefix[startDisplay] && pixel < entry.advancePrefix[endDisplay]
		&& pixel >= entry.advancePrefix[inline.startDisplay] && pixel < entry.advancePrefix[inline.endDisplay];
	return code.scratch.pointerTextPosition;
}

/** Source-position geometry uses the same retained glyph advances and wrapped rows as rendering. */
export function resolveTextPositionBounds(code: CodeEditorControl, row: number, column: number, out: RectBounds): void {
	ensureVisualLines(code);
	const layout = code.layout;
	const bounds = getCodeAreaBounds(code);
	const visual = layout.positionToVisualIndex(row, column);
	const segment = layout.visualIndexToSegment(visual)!;
	const entry = layout.getViewLine(row);
	const offset = layout.segmentPixelOffset(entry, segment, code.view.scrollLeft, code.view.wordWrapEnabled);
	const display = layout.columnToDisplay(entry.hi, column);
	const x = bounds.textLeft + entry.advancePrefix[display] - offset;
	const y = bounds.codeTop + (visual - (code.view.scrollRow | 0)) * code.lineHeight;
	write_rect_bounds(out, x, y, x + layout.cursorWidth(entry, display), y + code.lineHeight);
}

export function handlePointerAutoScroll(code: CodeEditorControl, viewportX: number, viewportY: number, bounds: CodeAreaBounds = getCodeAreaBounds(code)): boolean {
	if (!code.pointer.pointerSelecting) {
		return false;
	}
	const previousRow = code.view.scrollRow, previousColumn = code.view.scrollLeft;
	ensureVisualLines(code);
	let rowDelta = 0;
	if (viewportY < bounds.codeTop) {
		rowDelta = -1;
	} else if (viewportY >= bounds.codeBottom) {
		rowDelta = 1;
	}
	const rows = code.geometry.cachedVisibleRowCount;
	const scrollRow = code.layout.clampVisualScroll(code.view.scrollRow + rowDelta, code.layout.getVisualLineCount(), rows);
	let scrollLeft = code.view.scrollLeft;
	if (viewportX >= bounds.gutterLeft && !code.view.wordWrapEnabled) {
		if (viewportX < bounds.textLeft) {
			scrollLeft -= code.charAdvance;
		} else if (viewportX >= bounds.codeRight) {
			scrollLeft += code.charAdvance;
		}
		scrollLeft = code.layout.clampHorizontalScroll(scrollLeft, code.geometry.cachedMaxScrollLeft);
	}
	code.setScrollPosition(scrollRow, code.view.wordWrapEnabled ? 0 : scrollLeft);
	return code.view.scrollRow !== previousRow || code.view.scrollLeft !== previousColumn;
}

export function scrollRows(code: CodeEditorControl, deltaRows: number): void {
	if (deltaRows === 0) {
		return;
	}
	ensureVisualLines(code);
	code.setScrollPosition(code.layout.clampVisualScroll(code.view.scrollRow + deltaRows, code.layout.getVisualLineCount(), code.geometry.cachedVisibleRowCount), code.view.scrollLeft);
}

export function scrollHorizontally(code: CodeEditorControl, deltaPixels: number): void {
	if (deltaPixels === 0 || code.view.wordWrapEnabled) return;
	code.setScrollPosition(code.view.scrollRow, code.layout.clampHorizontalScroll(
		code.view.scrollLeft + deltaPixels, code.geometry.cachedMaxScrollLeft,
	));
}

export function toggleWordWrap(code: CodeEditorControl): void {
	ensureVisualLines(code);
	const previousWrap = code.view.wordWrapEnabled;
	const previousVisualCount = code.layout.getVisualLineCount();
	const previousTopIndex = code.layout.clampVisualIndex(previousVisualCount, code.view.scrollRow);
	const previousTopSegment = code.layout.visualIndexToSegment(previousTopIndex);
	const anchorRow = previousTopSegment.row;
	const anchorLine = code.layout.getViewLine(anchorRow);
	const anchorPixel = previousWrap ? anchorLine.advancePrefix[previousTopSegment.startDisplay] : code.view.scrollLeft;
	const anchorDisplay = previousWrap ? previousTopSegment.startDisplay : code.layout.displayAtPixel(anchorLine, anchorPixel);
	const previousCursorRow = code.view.cursorRow;
	const previousCursorColumn = code.view.cursorColumn;
	const previousDesiredColumn = code.view.desiredColumn;
	code.clearVisualCursor();

	code.view.wordWrapEnabled = !previousWrap;
	code.caret.cursorRevealSuspended = false;
	code.layout.markVisualLinesDirty();
	ensureVisualLines(code);
	const currentVisualCount = code.layout.getVisualLineCount();

	code.view.cursorRow = code.model.clampRow(previousCursorRow);
	code.view.cursorColumn = code.model.clampColumn(code.view.cursorRow, previousCursorColumn);
	code.view.desiredColumn = previousDesiredColumn;

	if (code.view.wordWrapEnabled) {
		code.setScrollPosition(code.view.scrollRow, 0);
		code.setScrollPosition(code.layout.clampVisualScroll(code.layout.displayToVisualIndex(anchorRow, anchorDisplay), currentVisualCount, code.geometry.cachedVisibleRowCount), code.view.scrollLeft);
	} else {
		code.setScrollPosition(code.view.scrollRow, code.layout.clampHorizontalScroll(anchorPixel, resolveCodeAreaViewport(code).maxScrollLeft));
		code.setScrollPosition(code.layout.clampVisualScroll(code.layout.displayToVisualIndex(anchorRow, anchorDisplay), currentVisualCount, code.geometry.cachedVisibleRowCount), code.view.scrollLeft);
	}
	code.pointer.lastPointerRowResolution = null;
	ensureCursorVisible(code);
	updateDesiredColumn(code);
	showEditorMessage(code.view.wordWrapEnabled ? 'Word wrap enabled' : 'Word wrap disabled', 'info', 2.5);
	code.emitViewStateChanged();
}

export function notifyReadOnlyEdit(): void {
	showEditorMessage('Tab is read-only', 'warning', 1.5);
}

export function computeWrapWidth(code: CodeEditorControl): number {
	const bounds = getCodeAreaBounds(code);
	const available = bounds.codeRight - bounds.textLeft;
	// Break before the scrollbar lane and leave room for the block caret at end of line.
	const width = available - constants.SCROLLBAR_WIDTH - constants.CODE_AREA_RIGHT_MARGIN - code.charAdvance;
	return width > code.charAdvance ? width : code.charAdvance;
}
