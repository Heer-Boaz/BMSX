import { clamp } from '../../../utils/clamp';
import * as constants from '../../common/constants';
import { getCodeAreaBounds, maximumLineLength } from './editor_view';
import { caretNavigation } from './caret';
import { editorFeedbackState } from '../../workbench/common/feedback_state';
import { ensureVisualLines, getVisualLineCount, positionToVisualIndex, visualIndexToSegment } from '../../common/text_utils';
import { editorCaretState } from './caret_state';
import { editorDocumentState } from '../editing/editor_document_state';
import { editorViewState } from './editor_view_state';

export function revealCursor(): void {
	editorCaretState.cursorRevealSuspended = false;
	ensureCursorVisible();
}

export function resolveViewportCapacity(): { rows: number; columns: number } {
	ensureVisualLines();
	const bounds = getCodeAreaBounds();
	const gutterOffset = bounds.textLeft - bounds.codeLeft;
	const wrapEnabled = editorViewState.wordWrapEnabled;
	const advance = editorFeedbackState.warnNonMonospace ? editorViewState.spaceAdvance : editorViewState.charAdvance;
	const visualCount = getVisualLineCount();

	let horizontalVisible = !wrapEnabled && editorViewState.codeHorizontalScrollbarVisible;
	let verticalVisible = editorViewState.codeVerticalScrollbarVisible;
	let rowCapacity = 1;
	let columnCapacity = 1;

	for (let i = 0; i < 3; i += 1) {
		const availableHeight = Math.max(0, (bounds.codeBottom - bounds.codeTop) - (horizontalVisible ? constants.SCROLLBAR_WIDTH : 0));
		rowCapacity = Math.max(1, Math.floor(availableHeight / editorViewState.lineHeight));
		verticalVisible = visualCount > rowCapacity;
		const availableWidth = Math.max(
			0,
			(bounds.codeRight - bounds.codeLeft)
			- (verticalVisible ? constants.SCROLLBAR_WIDTH : 0)
			- gutterOffset
			- constants.CODE_AREA_RIGHT_MARGIN,
		);
		columnCapacity = Math.max(1, Math.floor(availableWidth / advance));
		if (wrapEnabled) {
			horizontalVisible = false;
		} else {
			horizontalVisible = maximumLineLength() > columnCapacity;
		}
	}

	editorViewState.codeVerticalScrollbarVisible = verticalVisible;
	editorViewState.codeHorizontalScrollbarVisible = !wrapEnabled && horizontalVisible;
	editorViewState.cachedVisibleRowCount = rowCapacity;
	editorViewState.cachedVisibleColumnCount = columnCapacity;

	return { rows: rowCapacity, columns: columnCapacity };
}

export function centerCursorVertically(): void {
	const { rows } = resolveViewportCapacity();
	const totalVisual = getVisualLineCount();
	const cursorVisualIndex = positionToVisualIndex(editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
	if (rows <= 1) {
		editorViewState.scrollRow = editorViewState.layout.clampVisualScroll(cursorVisualIndex, totalVisual, rows);
		return;
	}
	const target = cursorVisualIndex - Math.floor(rows / 2);
	editorViewState.scrollRow = editorViewState.layout.clampVisualScroll(target, totalVisual, rows);
}

export function ensureCursorVisible(): void {
	editorDocumentState.cursorRow = editorViewState.layout.clampBufferRow(editorDocumentState.buffer, editorDocumentState.cursorRow);
	const clampedLine = editorDocumentState.buffer.getLineContent(editorDocumentState.cursorRow);
	editorDocumentState.cursorColumn = editorViewState.layout.clampLineLength(clampedLine.length, editorDocumentState.cursorColumn);

	const { rows, columns } = resolveViewportCapacity();
	const totalVisual = getVisualLineCount();
	const cursorVisualIndex = positionToVisualIndex(editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
	const maxScrollRow = Math.max(0, totalVisual - rows);
	const verticalMargin = Math.min(3, Math.max(0, Math.floor(rows / 6)));
	const topGuard = editorViewState.scrollRow + verticalMargin;
	const bottomGuard = editorViewState.scrollRow + rows - 1 - verticalMargin;

	if (cursorVisualIndex < topGuard) {
		editorViewState.scrollRow = editorViewState.layout.clampVisualScroll(cursorVisualIndex - verticalMargin, totalVisual, rows);
	} else if (cursorVisualIndex > bottomGuard) {
		editorViewState.scrollRow = editorViewState.layout.clampVisualScroll(cursorVisualIndex - rows + 1 + verticalMargin, totalVisual, rows);
	} else if (editorViewState.scrollRow > maxScrollRow) {
		editorViewState.scrollRow = editorViewState.layout.clampVisualScroll(editorViewState.scrollRow, totalVisual, rows);
	}

	if (editorViewState.wordWrapEnabled) {
		editorViewState.scrollColumn = 0;
		return;
	}

	const lineLength = clampedLine.length;
	const docMaxScrollColumn = Math.max(0, maximumLineLength() - columns);
	const lineMaxScrollColumn = Math.max(0, lineLength - columns);
	const maxScrollColumn = Math.min(docMaxScrollColumn, lineMaxScrollColumn);
	const horizontalMargin = Math.min(4, Math.max(0, Math.floor(columns / 6)));
	const leftGuard = editorViewState.scrollColumn + horizontalMargin;
	const rightGuard = editorViewState.scrollColumn + columns - 1 - horizontalMargin;

	if (editorDocumentState.cursorColumn < leftGuard) {
		editorViewState.scrollColumn = editorViewState.layout.clampHorizontalScroll(editorDocumentState.cursorColumn - horizontalMargin, maxScrollColumn);
	} else if (editorDocumentState.cursorColumn > rightGuard) {
		editorViewState.scrollColumn = editorViewState.layout.clampHorizontalScroll(editorDocumentState.cursorColumn - columns + 1 + horizontalMargin, maxScrollColumn);
	} else {
		editorViewState.scrollColumn = editorViewState.layout.clampHorizontalScroll(editorViewState.scrollColumn, maxScrollColumn);
	}
}

export function setCursorFromVisualIndex(visualIndex: number, desiredColumnHint?: number, desiredOffsetHint?: number): void {
	ensureVisualLines();
	caretNavigation.clear();
	const visualLines = editorViewState.layout.getVisualLines();
	if (visualLines.length === 0) {
		editorDocumentState.cursorRow = 0;
		editorDocumentState.cursorColumn = 0;
		updateDesiredColumn();
		return;
	}
	const clampedIndex = editorViewState.layout.clampVisualIndex(visualLines.length, visualIndex);
	const segment = visualLines[clampedIndex];
	if (!segment) {
		return;
	}
	const entry = editorViewState.layout.getCachedHighlight(editorDocumentState.buffer, segment.row);
	const highlight = entry.hi;
	const line = editorDocumentState.buffer.getLineContent(segment.row);
	const segmentStart = editorViewState.layout.clampSegmentStart(line.length, segment.startColumn);
	const segmentEnd = editorViewState.layout.clampSegmentEnd(line.length, segmentStart, segment.endColumn);
	const hasDesiredHint = desiredColumnHint !== undefined;
	const hasOffsetHint = desiredOffsetHint !== undefined;
	let targetColumn = hasDesiredHint ? desiredColumnHint! : editorDocumentState.cursorColumn;
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
	editorDocumentState.cursorRow = segment.row;
	editorDocumentState.cursorColumn = editorViewState.layout.clampLineLength(line.length, targetColumn);
	const cursorDisplay = editorViewState.layout.columnToDisplay(highlight, editorDocumentState.cursorColumn);
	if (editorViewState.wordWrapEnabled) {
		const hasNextSegmentSameRow = (clampedIndex + 1 < visualLines.length)
			&& visualLines[clampedIndex + 1].row === segment.row;
		if (editorDocumentState.cursorColumn < segmentStart) {
			editorDocumentState.cursorColumn = segmentStart;
		}
		if (segmentEnd >= segmentStart && editorDocumentState.cursorColumn > segmentEnd) {
			editorDocumentState.cursorColumn = segmentEnd;
		}
		if (hasNextSegmentSameRow && editorDocumentState.cursorColumn >= segmentEnd) {
			editorDocumentState.cursorColumn = Math.max(segmentStart, segmentEnd - 1);
		}
		const segmentDisplayStart = editorViewState.layout.columnToDisplay(highlight, segmentStart);
		editorDocumentState.desiredDisplayOffset = cursorDisplay - segmentDisplayStart;
	} else {
		editorDocumentState.desiredDisplayOffset = cursorDisplay;
	}
	if (hasDesiredHint) {
		editorDocumentState.desiredColumn = Math.max(0, desiredColumnHint!);
	} else {
		editorDocumentState.desiredColumn = editorDocumentState.cursorColumn;
	}
	if (editorDocumentState.desiredDisplayOffset < 0) {
		editorDocumentState.desiredDisplayOffset = 0;
	}
}

export function updateDesiredColumn(): void {
	editorDocumentState.desiredColumn = editorDocumentState.cursorColumn;
	editorDocumentState.desiredDisplayOffset = 0;
	if (editorDocumentState.cursorRow < 0 || editorDocumentState.cursorRow >= editorDocumentState.buffer.getLineCount()) {
		return;
	}
	const entry = editorViewState.layout.getCachedHighlight(editorDocumentState.buffer, editorDocumentState.cursorRow);
	const highlight = entry.hi;
	const cursorDisplay = editorViewState.layout.columnToDisplay(highlight, editorDocumentState.cursorColumn);
	let segmentStartColumn = 0;
	if (editorViewState.wordWrapEnabled) {
		ensureVisualLines();
		const override = caretNavigation.lookup(editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
		if (override) {
			segmentStartColumn = override.segmentStartColumn;
		} else {
			const visualIndex = positionToVisualIndex(editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
			const segment = visualIndexToSegment(visualIndex);
			if (segment) {
				segmentStartColumn = segment.startColumn;
			}
		}
	}
	const segmentDisplayStart = editorViewState.layout.columnToDisplay(highlight, segmentStartColumn);
	editorDocumentState.desiredDisplayOffset = cursorDisplay - segmentDisplayStart;
	if (editorDocumentState.desiredDisplayOffset < 0) {
		editorDocumentState.desiredDisplayOffset = 0;
	}
}
