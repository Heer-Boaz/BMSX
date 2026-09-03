import { clamp } from '../../../../../machine/ts/common/clamp';
import { ensureVisualLines } from '../../../common/text/layout';
import { editorCaretState } from './state';
import { activeCodeEditor } from '../../code_editor_state';
import { editorViewState } from '../state';
import { resolveCodeAreaViewport, type CodeAreaViewport } from '../../code/area_viewport';
import { caretNavigation } from './state';
import { resolveCursorVisualIndex } from './visual_index';

export function revealCursor(): void {
	editorCaretState.cursorRevealSuspended = false;
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
	activeCodeEditor.view.cursorRow = editorViewState.layout.clampBufferRow(activeCodeEditor.model.buffer, activeCodeEditor.view.cursorRow);
	const clampedLine = activeCodeEditor.model.buffer.getLineContent(activeCodeEditor.view.cursorRow);
	activeCodeEditor.view.cursorColumn = editorViewState.layout.clampLineLength(clampedLine.length, activeCodeEditor.view.cursorColumn);

	const { rows, columns, maxScrollColumn: docMaxScrollColumn } = resolveViewportCapacity();
	const totalVisual = editorViewState.layout.getVisualLineCount();
	const cursorVisual = resolveCursorVisualIndex();
	const maxScrollRow = Math.max(0, totalVisual - rows);
	const verticalMargin = Math.min(3, Math.max(0, Math.floor(rows / 6)));
	const topGuard = activeCodeEditor.view.scrollRow + verticalMargin;
	const bottomGuard = activeCodeEditor.view.scrollRow + rows - 1 - verticalMargin;

	if (cursorVisual < topGuard) {
		activeCodeEditor.view.scrollRow = editorViewState.layout.clampVisualScroll(cursorVisual - verticalMargin, totalVisual, rows);
	} else if (cursorVisual > bottomGuard) {
		activeCodeEditor.view.scrollRow = editorViewState.layout.clampVisualScroll(cursorVisual - rows + 1 + verticalMargin, totalVisual, rows);
	} else if (activeCodeEditor.view.scrollRow > maxScrollRow) {
		activeCodeEditor.view.scrollRow = editorViewState.layout.clampVisualScroll(activeCodeEditor.view.scrollRow, totalVisual, rows);
	}

	if (editorViewState.wordWrapEnabled) {
		activeCodeEditor.view.scrollColumn = 0;
		return;
	}

	const lineLength = clampedLine.length;
	const lineMaxScrollColumn = Math.max(0, lineLength - columns);
	const maxScrollColumn = Math.min(docMaxScrollColumn, lineMaxScrollColumn);
	const horizontalMargin = Math.min(4, Math.max(0, Math.floor(columns / 6)));
	const leftGuard = activeCodeEditor.view.scrollColumn + horizontalMargin;
	const rightGuard = activeCodeEditor.view.scrollColumn + columns - 1 - horizontalMargin;

	if (activeCodeEditor.view.cursorColumn < leftGuard) {
		activeCodeEditor.view.scrollColumn = editorViewState.layout.clampHorizontalScroll(activeCodeEditor.view.cursorColumn - horizontalMargin, maxScrollColumn);
	} else if (activeCodeEditor.view.cursorColumn > rightGuard) {
		activeCodeEditor.view.scrollColumn = editorViewState.layout.clampHorizontalScroll(activeCodeEditor.view.cursorColumn - columns + 1 + horizontalMargin, maxScrollColumn);
	} else {
		activeCodeEditor.view.scrollColumn = editorViewState.layout.clampHorizontalScroll(activeCodeEditor.view.scrollColumn, maxScrollColumn);
	}
}

export function setCursorFromVisualIndex(visualIndex: number, desiredColumnHint?: number, desiredOffsetHint?: number): void {
	ensureVisualLines();
	caretNavigation.clear();
	const visualLines = editorViewState.layout.getVisualLines();
	if (visualLines.length === 0) {
		activeCodeEditor.view.cursorRow = 0;
		activeCodeEditor.view.cursorColumn = 0;
		updateDesiredColumn();
		activeCodeEditor.emitCursorMoved();
		return;
	}
	const clampedIndex = editorViewState.layout.clampVisualIndex(visualLines.length, visualIndex);
	const segment = visualLines[clampedIndex];
	if (!segment) {
		return;
	}
	const entry = editorViewState.layout.getCachedHighlight(activeCodeEditor.model.buffer, segment.row);
	const highlight = entry.hi;
	const line = activeCodeEditor.model.buffer.getLineContent(segment.row);
	const segmentStart = editorViewState.layout.clampSegmentStart(line.length, segment.startColumn);
	const segmentEnd = editorViewState.layout.clampSegmentEnd(line.length, segmentStart, segment.endColumn);
	const hasDesiredHint = desiredColumnHint !== undefined;
	const hasOffsetHint = desiredOffsetHint !== undefined;
	let targetColumn = hasDesiredHint ? desiredColumnHint! : activeCodeEditor.view.cursorColumn;
	if (editorViewState.wordWrapEnabled) {
		const segmentDisplayStart = editorViewState.layout.columnToDisplay(highlight, segmentStart);
		const segmentDisplayEnd = editorViewState.layout.columnToDisplay(highlight, segmentEnd);
		const segmentWidth = Math.max(0, segmentDisplayEnd - segmentDisplayStart);
		if (hasOffsetHint) {
			const clampedOffset = clamp(desiredOffsetHint, 0, segmentWidth);
			const targetDisplay = clamp(segmentDisplayStart + clampedOffset, segmentDisplayStart, segmentDisplayEnd);
			let columnFromOffset = entry.displayToColumn[targetDisplay];
			if (columnFromOffset === undefined) {
				columnFromOffset = line.length;
			}
			targetColumn = editorViewState.layout.clampLineLength(line.length, columnFromOffset);
			targetColumn = editorViewState.layout.clampSegmentEnd(line.length, segmentStart, targetColumn);
		} else {
			targetColumn = editorViewState.layout.clampLineLength(line.length, targetColumn);
			targetColumn = editorViewState.layout.clampSegmentEnd(line.length, segmentStart, targetColumn);
		}
	} else {
		targetColumn = editorViewState.layout.clampLineLength(line.length, targetColumn);
	}
	activeCodeEditor.view.cursorRow = segment.row;
	activeCodeEditor.view.cursorColumn = editorViewState.layout.clampLineLength(line.length, targetColumn);
	const cursorDisplay = editorViewState.layout.columnToDisplay(highlight, activeCodeEditor.view.cursorColumn);
	if (editorViewState.wordWrapEnabled) {
		const hasNextSegmentSameRow = (clampedIndex + 1 < visualLines.length)
			&& visualLines[clampedIndex + 1].row === segment.row;
		if (activeCodeEditor.view.cursorColumn < segmentStart) {
			activeCodeEditor.view.cursorColumn = segmentStart;
		}
		if (segmentEnd >= segmentStart && activeCodeEditor.view.cursorColumn > segmentEnd) {
			activeCodeEditor.view.cursorColumn = segmentEnd;
		}
		if (hasNextSegmentSameRow && activeCodeEditor.view.cursorColumn >= segmentEnd) {
			activeCodeEditor.view.cursorColumn = Math.max(segmentStart, segmentEnd - 1);
		}
		const segmentDisplayStart = editorViewState.layout.columnToDisplay(highlight, segmentStart);
		activeCodeEditor.view.desiredDisplayOffset = cursorDisplay - segmentDisplayStart;
	} else {
		activeCodeEditor.view.desiredDisplayOffset = cursorDisplay;
	}
	if (hasDesiredHint) {
		activeCodeEditor.view.desiredColumn = Math.max(0, desiredColumnHint!);
	} else {
		activeCodeEditor.view.desiredColumn = activeCodeEditor.view.cursorColumn;
	}
	if (activeCodeEditor.view.desiredDisplayOffset < 0) {
		activeCodeEditor.view.desiredDisplayOffset = 0;
	}
	activeCodeEditor.emitCursorMoved();
}

export function updateDesiredColumn(): void {
	activeCodeEditor.view.desiredColumn = activeCodeEditor.view.cursorColumn;
	activeCodeEditor.view.desiredDisplayOffset = 0;
	if (activeCodeEditor.view.cursorRow < 0 || activeCodeEditor.view.cursorRow >= activeCodeEditor.model.buffer.getLineCount()) {
		return;
	}
	const entry = editorViewState.layout.getCachedHighlight(activeCodeEditor.model.buffer, activeCodeEditor.view.cursorRow);
	const highlight = entry.hi;
	const cursorDisplay = editorViewState.layout.columnToDisplay(highlight, activeCodeEditor.view.cursorColumn);
	let segmentStartColumn = 0;
	if (editorViewState.wordWrapEnabled) {
		ensureVisualLines();
		const override = caretNavigation.lookup(activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
		if (override) {
			segmentStartColumn = override.segmentStartColumn;
		} else {
			const visualIndex = editorViewState.layout.positionToVisualIndex(activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
			const segment = editorViewState.layout.visualIndexToSegment(visualIndex);
			if (segment) {
				segmentStartColumn = segment.startColumn;
			}
		}
	}
	const segmentDisplayStart = editorViewState.layout.columnToDisplay(highlight, segmentStartColumn);
	activeCodeEditor.view.desiredDisplayOffset = cursorDisplay - segmentDisplayStart;
	if (activeCodeEditor.view.desiredDisplayOffset < 0) {
		activeCodeEditor.view.desiredDisplayOffset = 0;
	}
}
