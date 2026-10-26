import { clamp } from '../../../../../machine/ts/common/clamp';
import { ensureVisualLines } from '../../../common/text/layout';
import { editorCaretState } from './state';
import { activeCodeEditor } from '../../code_editor_state';
import { editorViewState } from '../state';
import { resolveCodeAreaViewport, type CodeAreaViewport } from '../../code/area_viewport';
import { resolveCursorVisualIndex } from './visual_index';

export function revealCursor(): void {
	editorCaretState.cursorRevealSuspended = false;
	ensureCursorVisible();
}

/** Automatic proposals preserve deliberate manual scroll; explicit cursor commands resume following. */
export function revealInlineEdit(): void {
	if (editorCaretState.cursorRevealSuspended) return;
	ensureCursorVisible();
}

export function resolveViewportCapacity(): CodeAreaViewport {
	return resolveCodeAreaViewport();
}

export function centerCursorVertically(): void {
	const { rows } = resolveViewportCapacity();
	const totalVisual = editorViewState.layout.getVisualLineCount();
	const cursorVisual = resolveCursorVisualIndex();
	if (rows <= 1) {
		activeCodeEditor.view.scrollRow = editorViewState.layout.clampVisualScroll(cursorVisual, totalVisual, rows);
		return;
	}
	const target = cursorVisual - Math.floor(rows / 2);
	activeCodeEditor.view.scrollRow = editorViewState.layout.clampVisualScroll(target, totalVisual, rows);
}

export function ensureCursorVisible(): void {
	activeCodeEditor.view.cursorRow = activeCodeEditor.model.clampRow(activeCodeEditor.view.cursorRow);
	activeCodeEditor.view.cursorColumn = activeCodeEditor.model.clampColumn(activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);

	const { rows, contentWidth, maxScrollLeft: docMaxScrollLeft } = resolveViewportCapacity();
	const totalVisual = editorViewState.layout.getVisualLineCount();
	const cursorVisual = resolveCursorVisualIndex();
	const line = editorViewState.layout.getViewLine(activeCodeEditor.view.cursorRow);
	const inline = line.inline;
	const lastVisual = inline === null ? cursorVisual : editorViewState.layout.displayToVisualIndex(activeCodeEditor.view.cursorRow,
		Math.max(inline.startDisplay, inline.endDisplay - 1));
	const spanRows = Math.min(rows, lastVisual - cursorVisual + 1);
	const revealLast = cursorVisual + spanRows - 1;
	const maxScrollRow = Math.max(0, totalVisual - rows);
	const verticalMargin = Math.min(3, Math.trunc(rows / 6), Math.trunc((rows - spanRows) / 2));
	const topGuard = activeCodeEditor.view.scrollRow + verticalMargin;
	const bottomGuard = activeCodeEditor.view.scrollRow + rows - 1 - verticalMargin;

	if (cursorVisual < topGuard) {
		activeCodeEditor.view.scrollRow = editorViewState.layout.clampVisualScroll(cursorVisual - verticalMargin, totalVisual, rows);
	} else if (revealLast > bottomGuard) {
		activeCodeEditor.view.scrollRow = editorViewState.layout.clampVisualScroll(revealLast - rows + 1 + verticalMargin, totalVisual, rows);
	} else if (activeCodeEditor.view.scrollRow > maxScrollRow) {
		activeCodeEditor.view.scrollRow = editorViewState.layout.clampVisualScroll(activeCodeEditor.view.scrollRow, totalVisual, rows);
	}

	if (editorViewState.wordWrapEnabled) {
		activeCodeEditor.view.scrollLeft = 0;
		return;
	}

	const cursorDisplay = editorViewState.layout.columnToDisplay(line.hi, activeCodeEditor.view.cursorColumn);
	const cursorLeft = line.advancePrefix[cursorDisplay];
	const cursorRight = cursorLeft + editorViewState.layout.cursorWidth(line, cursorDisplay);
	const end = inline === null ? cursorRight : Math.max(cursorRight, line.advancePrefix[inline.endDisplay]);
	const spanWidth = Math.min(contentWidth, end - cursorLeft);
	const revealRight = cursorLeft + spanWidth;
	const lineWidth = line.advancePrefix[line.hi.text.length] + editorViewState.charAdvance;
	const lineMaxScrollLeft = Math.max(0, lineWidth - contentWidth);
	const maxScrollLeft = Math.min(docMaxScrollLeft, lineMaxScrollLeft);
	const horizontalMargin = Math.min(4 * editorViewState.charAdvance, contentWidth / 6, (contentWidth - spanWidth) / 2);
	const leftGuard = activeCodeEditor.view.scrollLeft + horizontalMargin;
	const rightGuard = activeCodeEditor.view.scrollLeft + contentWidth - horizontalMargin;

	if (cursorLeft < leftGuard) {
		activeCodeEditor.view.scrollLeft = editorViewState.layout.clampHorizontalScroll(cursorLeft - horizontalMargin, maxScrollLeft);
	} else if (revealRight > rightGuard) {
		activeCodeEditor.view.scrollLeft = editorViewState.layout.clampHorizontalScroll(revealRight - contentWidth + horizontalMargin, maxScrollLeft);
	} else {
		activeCodeEditor.view.scrollLeft = editorViewState.layout.clampHorizontalScroll(activeCodeEditor.view.scrollLeft, maxScrollLeft);
	}
}

export function setCursorFromVisualIndex(visualIndex: number, desiredColumnHint?: number, desiredOffsetHint?: number): void {
	ensureVisualLines();
	activeCodeEditor.clearVisualCursor();
	const visualLines = editorViewState.layout.getVisualLines();
	const clampedIndex = editorViewState.layout.clampVisualIndex(visualLines.length, visualIndex);
	const segment = visualLines[clampedIndex];
	const entry = editorViewState.layout.getViewLine(segment.row);
	const line = entry.src;
	const segmentStart = editorViewState.layout.clampSegmentStart(line.length, segment.startColumn);
	const segmentEnd = editorViewState.layout.clampSegmentEnd(line.length, segmentStart, segment.endColumn);
	const hasDesiredHint = desiredColumnHint !== undefined;
	const hasOffsetHint = desiredOffsetHint !== undefined;
	let targetColumn = hasDesiredHint ? desiredColumnHint! : activeCodeEditor.view.cursorColumn;
	if (editorViewState.wordWrapEnabled) {
		const segmentDisplayStart = segment.startDisplay;
		const segmentDisplayEnd = segment.endDisplay;
		const segmentWidth = Math.max(0, segmentDisplayEnd - segmentDisplayStart);
		if (hasOffsetHint) {
			const clampedOffset = clamp(desiredOffsetHint, 0, segmentWidth);
			const targetDisplay = clamp(segmentDisplayStart + clampedOffset, segmentDisplayStart, segmentDisplayEnd);
			const columnFromOffset = entry.displayToColumn[targetDisplay];
			targetColumn = editorViewState.layout.clampLineLength(line.length, columnFromOffset);
			targetColumn = editorViewState.layout.clampSegmentEnd(line.length, segmentStart, targetColumn);
		} else {
			targetColumn = editorViewState.layout.clampLineLength(line.length, targetColumn);
			targetColumn = editorViewState.layout.clampSegmentEnd(line.length, segmentStart, targetColumn);
		}
	} else {
		targetColumn = editorViewState.layout.clampLineLength(line.length, targetColumn);
	}
	if (editorViewState.wordWrapEnabled) {
		const hasNextSegmentSameRow = (clampedIndex + 1 < visualLines.length)
			&& visualLines[clampedIndex + 1].row === segment.row;
		if (hasNextSegmentSameRow && targetColumn >= segmentEnd) targetColumn = Math.max(segmentStart, segmentEnd - 1);
	}
	activeCodeEditor.view.cursorRow = segment.row;
	activeCodeEditor.view.cursorColumn = targetColumn;
	activeCodeEditor.emitCursorMoved();
	updateDesiredColumn();
	if (hasDesiredHint) {
		activeCodeEditor.view.desiredColumn = Math.max(0, desiredColumnHint!);
	}
}

export function updateDesiredColumn(): void {
	activeCodeEditor.view.desiredColumn = activeCodeEditor.view.cursorColumn;
	activeCodeEditor.view.desiredDisplayOffset = 0;
	if (activeCodeEditor.view.cursorRow < 0 || activeCodeEditor.view.cursorRow >= activeCodeEditor.model.buffer.getLineCount()) {
		return;
	}
	const entry = editorViewState.layout.getViewLine(activeCodeEditor.view.cursorRow);
	const highlight = entry.hi;
	const cursorDisplay = editorViewState.layout.columnToDisplay(highlight, activeCodeEditor.view.cursorColumn);
	let segmentDisplayStart = 0;
	if (editorViewState.wordWrapEnabled) {
		ensureVisualLines();
		const override = activeCodeEditor.visualCursor;
		if (override) {
			segmentDisplayStart = editorViewState.layout.visualIndexToSegment(override.visualIndex).startDisplay;
		} else {
			const visualIndex = editorViewState.layout.positionToVisualIndex(activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
			const segment = editorViewState.layout.visualIndexToSegment(visualIndex);
			if (segment) {
				segmentDisplayStart = segment.startDisplay;
			}
		}
	}
	activeCodeEditor.view.desiredDisplayOffset = cursorDisplay - segmentDisplayStart;
	if (activeCodeEditor.view.desiredDisplayOffset < 0) {
		activeCodeEditor.view.desiredDisplayOffset = 0;
	}
}
