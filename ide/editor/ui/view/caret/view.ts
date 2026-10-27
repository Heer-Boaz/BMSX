import type { CodeEditorControl } from '../../code_editor_control';
import { clamp } from '../../../../../machine/ts/common/clamp';
import { ensureVisualLines } from '../../../common/text/layout';
import { resolveCodeAreaViewport, type CodeAreaViewport } from '../../code/area_viewport';
import { resolveCursorVisualIndex } from './visual_index';

export function revealCursor(code: CodeEditorControl): void {
	code.caret.cursorRevealSuspended = false;
	ensureCursorVisible(code);
}

/** Automatic proposals preserve deliberate manual scroll; explicit cursor commands resume following. */
export function revealInlineEdit(code: CodeEditorControl): void {
	if (code.caret.cursorRevealSuspended) return;
	ensureCursorVisible(code);
}

export function resolveViewportCapacity(code: CodeEditorControl): CodeAreaViewport {
	return resolveCodeAreaViewport(code);
}

export function centerCursorVertically(code: CodeEditorControl): void {
	const { rows } = resolveViewportCapacity(code);
	const totalVisual = code.layout.getVisualLineCount();
	const cursorVisual = resolveCursorVisualIndex(code);
	if (rows <= 1) {
		code.setScrollPosition(code.layout.clampVisualScroll(cursorVisual, totalVisual, rows), code.view.scrollLeft);
		return;
	}
	const target = cursorVisual - Math.floor(rows / 2);
	code.setScrollPosition(code.layout.clampVisualScroll(target, totalVisual, rows), code.view.scrollLeft);
}

export function ensureCursorVisible(code: CodeEditorControl): void {
	code.view.cursorRow = code.model.clampRow(code.view.cursorRow);
	code.view.cursorColumn = code.model.clampColumn(code.view.cursorRow, code.view.cursorColumn);

	const { rows, contentWidth, maxScrollLeft: docMaxScrollLeft } = resolveViewportCapacity(code);
	const totalVisual = code.layout.getVisualLineCount();
	const cursorVisual = resolveCursorVisualIndex(code);
	const line = code.layout.getViewLine(code.view.cursorRow);
	const inline = line.inline;
	const lastVisual = inline === null ? cursorVisual : code.layout.displayToVisualIndex(code.view.cursorRow,
		Math.max(inline.startDisplay, inline.endDisplay - 1));
	const spanRows = Math.min(rows, lastVisual - cursorVisual + 1);
	const revealLast = cursorVisual + spanRows - 1;
	const maxScrollRow = Math.max(0, totalVisual - rows);
	const verticalMargin = Math.min(3, Math.trunc(rows / 6), Math.trunc((rows - spanRows) / 2));
	const topGuard = code.view.scrollRow + verticalMargin;
	const bottomGuard = code.view.scrollRow + rows - 1 - verticalMargin;

	if (cursorVisual < topGuard) {
		code.setScrollPosition(code.layout.clampVisualScroll(cursorVisual - verticalMargin, totalVisual, rows), code.view.scrollLeft);
	} else if (revealLast > bottomGuard) {
		code.setScrollPosition(code.layout.clampVisualScroll(revealLast - rows + 1 + verticalMargin, totalVisual, rows), code.view.scrollLeft);
	} else if (code.view.scrollRow > maxScrollRow) {
		code.setScrollPosition(code.layout.clampVisualScroll(code.view.scrollRow, totalVisual, rows), code.view.scrollLeft);
	}

	if (code.view.wordWrapEnabled) {
		code.setScrollPosition(code.view.scrollRow, 0);
		return;
	}

	const cursorDisplay = code.layout.columnToDisplay(line.hi, code.view.cursorColumn);
	const cursorLeft = line.advancePrefix[cursorDisplay];
	const cursorRight = cursorLeft + code.layout.cursorWidth(line, cursorDisplay);
	const end = inline === null ? cursorRight : Math.max(cursorRight, line.advancePrefix[inline.endDisplay]);
	const spanWidth = Math.min(contentWidth, end - cursorLeft);
	const revealRight = cursorLeft + spanWidth;
	const lineWidth = line.advancePrefix[line.hi.text.length] + code.charAdvance;
	const lineMaxScrollLeft = Math.max(0, lineWidth - contentWidth);
	const maxScrollLeft = Math.min(docMaxScrollLeft, lineMaxScrollLeft);
	const horizontalMargin = Math.min(4 * code.charAdvance, contentWidth / 6, (contentWidth - spanWidth) / 2);
	const leftGuard = code.view.scrollLeft + horizontalMargin;
	const rightGuard = code.view.scrollLeft + contentWidth - horizontalMargin;

	if (cursorLeft < leftGuard) {
		code.setScrollPosition(code.view.scrollRow, code.layout.clampHorizontalScroll(cursorLeft - horizontalMargin, maxScrollLeft));
	} else if (revealRight > rightGuard) {
		code.setScrollPosition(code.view.scrollRow, code.layout.clampHorizontalScroll(revealRight - contentWidth + horizontalMargin, maxScrollLeft));
	} else {
		code.setScrollPosition(code.view.scrollRow, code.layout.clampHorizontalScroll(code.view.scrollLeft, maxScrollLeft));
	}
}

export function setCursorFromVisualIndex(code: CodeEditorControl, visualIndex: number, desiredColumnHint?: number, desiredOffsetHint?: number): void {
	ensureVisualLines(code);
	code.clearVisualCursor();
	const visualLines = code.layout.getVisualLines();
	const clampedIndex = code.layout.clampVisualIndex(visualLines.length, visualIndex);
	const segment = visualLines[clampedIndex];
	const entry = code.layout.getViewLine(segment.row);
	const line = entry.src;
	const segmentStart = code.layout.clampSegmentStart(line.length, segment.startColumn);
	const segmentEnd = code.layout.clampSegmentEnd(line.length, segmentStart, segment.endColumn);
	const hasDesiredHint = desiredColumnHint !== undefined;
	const hasOffsetHint = desiredOffsetHint !== undefined;
	let targetColumn = hasDesiredHint ? desiredColumnHint! : code.view.cursorColumn;
	if (code.view.wordWrapEnabled) {
		const segmentDisplayStart = segment.startDisplay;
		const segmentDisplayEnd = segment.endDisplay;
		const segmentWidth = Math.max(0, segmentDisplayEnd - segmentDisplayStart);
		if (hasOffsetHint) {
			const clampedOffset = clamp(desiredOffsetHint, 0, segmentWidth);
			const targetDisplay = clamp(segmentDisplayStart + clampedOffset, segmentDisplayStart, segmentDisplayEnd);
			const columnFromOffset = entry.displayToColumn[targetDisplay];
			targetColumn = code.layout.clampLineLength(line.length, columnFromOffset);
			targetColumn = code.layout.clampSegmentEnd(line.length, segmentStart, targetColumn);
		} else {
			targetColumn = code.layout.clampLineLength(line.length, targetColumn);
			targetColumn = code.layout.clampSegmentEnd(line.length, segmentStart, targetColumn);
		}
	} else {
		targetColumn = code.layout.clampLineLength(line.length, targetColumn);
	}
	if (code.view.wordWrapEnabled) {
		const hasNextSegmentSameRow = (clampedIndex + 1 < visualLines.length)
			&& visualLines[clampedIndex + 1].row === segment.row;
		if (hasNextSegmentSameRow && targetColumn >= segmentEnd) targetColumn = Math.max(segmentStart, segmentEnd - 1);
	}
	code.view.cursorRow = segment.row;
	code.view.cursorColumn = targetColumn;
	code.emitCursorMoved();
	updateDesiredColumn(code);
	if (hasDesiredHint) {
		code.view.desiredColumn = Math.max(0, desiredColumnHint!);
	}
}

export function updateDesiredColumn(code: CodeEditorControl): void {
	code.view.desiredColumn = code.view.cursorColumn;
	code.view.desiredDisplayOffset = 0;
	if (code.view.cursorRow < 0 || code.view.cursorRow >= code.model.buffer.getLineCount()) {
		return;
	}
	const entry = code.layout.getViewLine(code.view.cursorRow);
	const highlight = entry.hi;
	const cursorDisplay = code.layout.columnToDisplay(highlight, code.view.cursorColumn);
	let segmentDisplayStart = 0;
	if (code.view.wordWrapEnabled) {
		ensureVisualLines(code);
		const override = code.visualCursor;
		if (override) {
			segmentDisplayStart = code.layout.visualIndexToSegment(override.visualIndex).startDisplay;
		} else {
			const visualIndex = code.layout.positionToVisualIndex(code.view.cursorRow, code.view.cursorColumn);
			const segment = code.layout.visualIndexToSegment(visualIndex);
			if (segment) {
				segmentDisplayStart = segment.startDisplay;
			}
		}
	}
	code.view.desiredDisplayOffset = cursorDisplay - segmentDisplayStart;
	if (code.view.desiredDisplayOffset < 0) {
		code.view.desiredDisplayOffset = 0;
	}
}
