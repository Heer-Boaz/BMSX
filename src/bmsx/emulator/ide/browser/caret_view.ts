import { clamp } from '../../../utils/clamp';
import * as constants from '../core/constants';
import { getCodeAreaBounds, maximumLineLength } from './editor_view';
import { caretNavigation, ide_state } from '../core/ide_state';
import { ensureVisualLines, getVisualLineCount, positionToVisualIndex, visualIndexToSegment } from '../core/text_utils';

export function revealCursor(): void {
	ide_state.cursorRevealSuspended = false;
	ensureCursorVisible();
}

export function resolveViewportCapacity(): { rows: number; columns: number } {
	ensureVisualLines();
	const bounds = getCodeAreaBounds();
	const gutterOffset = bounds.textLeft - bounds.codeLeft;
	const wrapEnabled = ide_state.wordWrapEnabled;
	const advance = ide_state.warnNonMonospace ? ide_state.spaceAdvance : ide_state.charAdvance;
	const visualCount = getVisualLineCount();

	let horizontalVisible = !wrapEnabled && ide_state.codeHorizontalScrollbarVisible;
	let verticalVisible = ide_state.codeVerticalScrollbarVisible;
	let rowCapacity = 1;
	let columnCapacity = 1;

	for (let i = 0; i < 3; i += 1) {
		const availableHeight = Math.max(0, (bounds.codeBottom - bounds.codeTop) - (horizontalVisible ? constants.SCROLLBAR_WIDTH : 0));
		rowCapacity = Math.max(1, Math.floor(availableHeight / ide_state.lineHeight));
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

	ide_state.codeVerticalScrollbarVisible = verticalVisible;
	ide_state.codeHorizontalScrollbarVisible = !wrapEnabled && horizontalVisible;
	ide_state.cachedVisibleRowCount = rowCapacity;
	ide_state.cachedVisibleColumnCount = columnCapacity;

	return { rows: rowCapacity, columns: columnCapacity };
}

export function centerCursorVertically(): void {
	const { rows } = resolveViewportCapacity();
	const totalVisual = getVisualLineCount();
	const cursorVisualIndex = positionToVisualIndex(ide_state.cursorRow, ide_state.cursorColumn);
	if (rows <= 1) {
		ide_state.scrollRow = ide_state.layout.clampVisualScroll(cursorVisualIndex, totalVisual, rows);
		return;
	}
	const target = cursorVisualIndex - Math.floor(rows / 2);
	ide_state.scrollRow = ide_state.layout.clampVisualScroll(target, totalVisual, rows);
}

export function ensureCursorVisible(): void {
	ide_state.cursorRow = ide_state.layout.clampBufferRow(ide_state.buffer, ide_state.cursorRow);
	const clampedLine = ide_state.buffer.getLineContent(ide_state.cursorRow);
	ide_state.cursorColumn = ide_state.layout.clampLineLength(clampedLine.length, ide_state.cursorColumn);

	const { rows, columns } = resolveViewportCapacity();
	const totalVisual = getVisualLineCount();
	const cursorVisualIndex = positionToVisualIndex(ide_state.cursorRow, ide_state.cursorColumn);
	const maxScrollRow = Math.max(0, totalVisual - rows);
	const verticalMargin = Math.min(3, Math.max(0, Math.floor(rows / 6)));
	const topGuard = ide_state.scrollRow + verticalMargin;
	const bottomGuard = ide_state.scrollRow + rows - 1 - verticalMargin;

	if (cursorVisualIndex < topGuard) {
		ide_state.scrollRow = ide_state.layout.clampVisualScroll(cursorVisualIndex - verticalMargin, totalVisual, rows);
	} else if (cursorVisualIndex > bottomGuard) {
		ide_state.scrollRow = ide_state.layout.clampVisualScroll(cursorVisualIndex - rows + 1 + verticalMargin, totalVisual, rows);
	} else if (ide_state.scrollRow > maxScrollRow) {
		ide_state.scrollRow = ide_state.layout.clampVisualScroll(ide_state.scrollRow, totalVisual, rows);
	}

	if (ide_state.wordWrapEnabled) {
		ide_state.scrollColumn = 0;
		return;
	}

	const lineLength = clampedLine.length;
	const docMaxScrollColumn = Math.max(0, maximumLineLength() - columns);
	const lineMaxScrollColumn = Math.max(0, lineLength - columns);
	const maxScrollColumn = Math.min(docMaxScrollColumn, lineMaxScrollColumn);
	const horizontalMargin = Math.min(4, Math.max(0, Math.floor(columns / 6)));
	const leftGuard = ide_state.scrollColumn + horizontalMargin;
	const rightGuard = ide_state.scrollColumn + columns - 1 - horizontalMargin;

	if (ide_state.cursorColumn < leftGuard) {
		ide_state.scrollColumn = ide_state.layout.clampHorizontalScroll(ide_state.cursorColumn - horizontalMargin, maxScrollColumn);
	} else if (ide_state.cursorColumn > rightGuard) {
		ide_state.scrollColumn = ide_state.layout.clampHorizontalScroll(ide_state.cursorColumn - columns + 1 + horizontalMargin, maxScrollColumn);
	} else {
		ide_state.scrollColumn = ide_state.layout.clampHorizontalScroll(ide_state.scrollColumn, maxScrollColumn);
	}
}

export function setCursorFromVisualIndex(visualIndex: number, desiredColumnHint?: number, desiredOffsetHint?: number): void {
	ensureVisualLines();
	caretNavigation.clear();
	const visualLines = ide_state.layout.getVisualLines();
	if (visualLines.length === 0) {
		ide_state.cursorRow = 0;
		ide_state.cursorColumn = 0;
		updateDesiredColumn();
		return;
	}
	const clampedIndex = ide_state.layout.clampVisualIndex(visualLines.length, visualIndex);
	const segment = visualLines[clampedIndex];
	if (!segment) {
		return;
	}
	const entry = ide_state.layout.getCachedHighlight(ide_state.buffer, segment.row);
	const highlight = entry.hi;
	const line = ide_state.buffer.getLineContent(segment.row);
	const segmentStart = ide_state.layout.clampSegmentStart(line.length, segment.startColumn);
	const segmentEnd = ide_state.layout.clampSegmentEnd(line.length, segmentStart, segment.endColumn);
	const hasDesiredHint = desiredColumnHint !== undefined;
	const hasOffsetHint = desiredOffsetHint !== undefined;
	let targetColumn = hasDesiredHint ? desiredColumnHint! : ide_state.cursorColumn;
	if (ide_state.wordWrapEnabled) {
		const segmentDisplayStart = ide_state.layout.columnToDisplay(highlight, segmentStart);
		const segmentDisplayEnd = ide_state.layout.columnToDisplay(highlight, segmentEnd);
		const segmentWidth = Math.max(0, segmentDisplayEnd - segmentDisplayStart);
		if (hasOffsetHint) {
			const clampedOffset = clamp(desiredOffsetHint, 0, segmentWidth);
			const targetDisplay = clamp(segmentDisplayStart + clampedOffset, segmentDisplayStart, segmentDisplayEnd);
			let columnFromOffset = entry.displayToColumn[targetDisplay];
			if (columnFromOffset === undefined) {
				columnFromOffset = line.length;
			}
			targetColumn = ide_state.layout.clampLineLength(line.length, columnFromOffset);
			targetColumn = ide_state.layout.clampSegmentEnd(line.length, segmentStart, targetColumn);
		} else {
			targetColumn = ide_state.layout.clampLineLength(line.length, targetColumn);
			targetColumn = ide_state.layout.clampSegmentEnd(line.length, segmentStart, targetColumn);
		}
	} else {
		targetColumn = ide_state.layout.clampLineLength(line.length, targetColumn);
	}
	ide_state.cursorRow = segment.row;
	ide_state.cursorColumn = ide_state.layout.clampLineLength(line.length, targetColumn);
	const cursorDisplay = ide_state.layout.columnToDisplay(highlight, ide_state.cursorColumn);
	if (ide_state.wordWrapEnabled) {
		const hasNextSegmentSameRow = (clampedIndex + 1 < visualLines.length)
			&& visualLines[clampedIndex + 1].row === segment.row;
		if (ide_state.cursorColumn < segmentStart) {
			ide_state.cursorColumn = segmentStart;
		}
		if (segmentEnd >= segmentStart && ide_state.cursorColumn > segmentEnd) {
			ide_state.cursorColumn = segmentEnd;
		}
		if (hasNextSegmentSameRow && ide_state.cursorColumn >= segmentEnd) {
			ide_state.cursorColumn = Math.max(segmentStart, segmentEnd - 1);
		}
		const segmentDisplayStart = ide_state.layout.columnToDisplay(highlight, segmentStart);
		ide_state.desiredDisplayOffset = cursorDisplay - segmentDisplayStart;
	} else {
		ide_state.desiredDisplayOffset = cursorDisplay;
	}
	if (hasDesiredHint) {
		ide_state.desiredColumn = Math.max(0, desiredColumnHint!);
	} else {
		ide_state.desiredColumn = ide_state.cursorColumn;
	}
	if (ide_state.desiredDisplayOffset < 0) {
		ide_state.desiredDisplayOffset = 0;
	}
}

export function updateDesiredColumn(): void {
	ide_state.desiredColumn = ide_state.cursorColumn;
	ide_state.desiredDisplayOffset = 0;
	if (ide_state.cursorRow < 0 || ide_state.cursorRow >= ide_state.buffer.getLineCount()) {
		return;
	}
	const entry = ide_state.layout.getCachedHighlight(ide_state.buffer, ide_state.cursorRow);
	const highlight = entry.hi;
	const cursorDisplay = ide_state.layout.columnToDisplay(highlight, ide_state.cursorColumn);
	let segmentStartColumn = 0;
	if (ide_state.wordWrapEnabled) {
		ensureVisualLines();
		const override = caretNavigation.lookup(ide_state.cursorRow, ide_state.cursorColumn);
		if (override) {
			segmentStartColumn = override.segmentStartColumn;
		} else {
			const visualIndex = positionToVisualIndex(ide_state.cursorRow, ide_state.cursorColumn);
			const segment = visualIndexToSegment(visualIndex);
			if (segment) {
				segmentStartColumn = segment.startColumn;
			}
		}
	}
	const segmentDisplayStart = ide_state.layout.columnToDisplay(highlight, segmentStartColumn);
	ide_state.desiredDisplayOffset = cursorDisplay - segmentDisplayStart;
	if (ide_state.desiredDisplayOffset < 0) {
		ide_state.desiredDisplayOffset = 0;
	}
}
