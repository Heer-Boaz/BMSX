import { clamp } from '../../utils/clamp';
import { getCodeAreaBounds, maximumLineLength } from './editor_view';
import { updateDesiredColumn, breakUndoSequence, currentLine } from './cart_editor';
import { ensureVisualLines, getVisualLineCount, positionToVisualIndex, visualIndexToSegment } from './text_utils';
import { caretNavigation, ide_state } from './ide_state';
import { isShiftDown, isCtrlDown } from './ide_input';
import { resetBlink } from './render/render_caret';
import { findWordLeft, findWordRight, ensureSelectionAnchor, hasSelection, collapseSelectionTo, clearSelection } from './text_editing_and_selection';
import * as constants from './constants';
import type { Position, VisualLineSegment } from './types';

export type VisualCursorOverride = {
	row: number;
	column: number;
	visualIndex: number;
	segmentStartColumn: number;
};

export class CaretNavigationState {
	private override: VisualCursorOverride = null;

	public clear(): void {
		this.override = null;
	}

	public capture(row: number, column: number, visualIndex: number, segmentStartColumn: number): void {
		this.override = {
			row,
			column,
			visualIndex,
			segmentStartColumn,
		};
	}

	public lookup(row: number, column: number): { visualIndex: number; segmentStartColumn: number } {
		const current = this.override;
		if (!current) {
			return null;
		}
		if (current.row !== row || current.column !== column) {
			return null;
		}
		return {
			visualIndex: current.visualIndex,
			segmentStartColumn: current.segmentStartColumn,
		};
	}
}

export function resolveIndentAwareHome(line: string, segment: VisualLineSegment, currentColumn: number): number {
	const lineLength = line.length;
	const segmentStart = ide_state.layout.clampSegmentStart(lineLength, segment.startColumn);
	const segmentEnd = ide_state.layout.clampSegmentEnd(lineLength, segmentStart, segment.endColumn);
	const preferred = findFirstNonWhitespace(line, segmentStart, segmentEnd);
	const targetColumn = currentColumn === preferred ? segmentStart : preferred;
	return ide_state.layout.clampSegmentEnd(lineLength, segmentStart, targetColumn);
}

export function resolveSegmentEnd(line: string, segment: VisualLineSegment): number {
	const lineLength = line.length;
	const segmentStart = ide_state.layout.clampSegmentStart(lineLength, segment.startColumn);
	const segmentEnd = ide_state.layout.clampSegmentEnd(lineLength, segmentStart, segment.endColumn);
	if (segmentEnd >= lineLength) {
		return lineLength;
	}
	if (segmentEnd <= segmentStart) {
		return segmentStart;
	}
	return segmentEnd - 1;
}

export function findFirstNonWhitespace(line: string, startColumn: number, endColumn: number): number {
	for (let column = startColumn; column < endColumn; column += 1) {
		const ch = line.charAt(column);
		if (ch !== ' ' && ch !== '\t') {
			return column;
		}
	}
	return endColumn;
}

/**
 * Set cursor to a specific row and column position
 */
export function setCursorPosition(row: number, column: number): void {
	caretNavigation.clear();
	const buffer = ide_state.buffer;
	const targetRow = ide_state.layout.clampBufferRow(buffer, row);
	const targetColumn = ide_state.layout.clampBufferColumn(buffer, targetRow, column);
	ide_state.cursorRow = targetRow;
	ide_state.cursorColumn = targetColumn;
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	ide_state.completion.onCursorMoved();
}

/**
 * Reveal cursor by ensuring it's visible in viewport
 */
export function revealCursor(): void {
	ide_state.cursorRevealSuspended = false;
	ensureCursorVisible();
}

/**
 * Move cursor vertically by delta lines (supports word wrap)
 */
export function moveCursorVertical(delta: number): void {
	caretNavigation.clear();
	ensureVisualLines();
	const visualCount = getVisualLineCount();
	if (visualCount === 0) {
		return;
	}
	const currentIndex = positionToVisualIndex(ide_state.cursorRow, ide_state.cursorColumn);
	const targetIndex = ide_state.layout.clampVisualIndex(visualCount, currentIndex + delta);
	const desired = ide_state.desiredColumn;
	const desiredDisplay = ide_state.desiredDisplayOffset;
	setCursorFromVisualIndex(targetIndex, desired, desiredDisplay);
	resetBlink();
	revealCursor();
	ide_state.completion.onCursorMoved();
}

/**
 * Move cursor horizontally by delta columns (supports word wrap)
 */
export function moveCursorHorizontal(delta: number): void {
	if (delta === 0) {
		return;
	}
	caretNavigation.clear();
	ensureVisualLines();
	const visualCount = getVisualLineCount();
	if (visualCount === 0) {
		return;
	}
	const visualIndex = positionToVisualIndex(ide_state.cursorRow, ide_state.cursorColumn);
	const segment = visualIndexToSegment(visualIndex);
	if (!segment) {
		return;
	}
	const buffer = ide_state.buffer;
	const line = buffer.getLineContent(segment.row);
	if (delta < 0) {
		// Move left
		if (ide_state.cursorColumn > segment.startColumn) {
			ide_state.cursorColumn -= 1;
		} else {
			let moved = false;
				if (ide_state.wordWrapEnabled && visualIndex > 0) {
					const prevSegment = visualIndexToSegment(visualIndex - 1);
					if (prevSegment && prevSegment.row === segment.row) {
						ide_state.cursorRow = prevSegment.row;
						const prevLine = buffer.getLineContent(prevSegment.row);
						const prevEnd = Math.max(prevSegment.endColumn, prevSegment.startColumn);
						const hasMoreBefore = prevEnd > prevSegment.startColumn;
						const targetColumn = hasMoreBefore && prevEnd < prevLine.length
						? Math.max(prevSegment.startColumn, prevEnd - 1)
						: Math.min(prevEnd, prevLine.length);
					ide_state.cursorColumn = ide_state.layout.clampLineLength(prevLine.length, targetColumn);
					moved = true;
				}
			}
			if (!moved && segment.row > 0) {
				ide_state.cursorRow = segment.row - 1;
				ide_state.cursorColumn = buffer.getLineEndOffset(ide_state.cursorRow) - buffer.getLineStartOffset(ide_state.cursorRow);
			}
		}
	} else {
		// Move right
		if (ide_state.cursorColumn < segment.endColumn && ide_state.cursorColumn < line.length) {
			ide_state.cursorColumn += 1;
		} else {
			let moved = false;
			if (ide_state.wordWrapEnabled && visualIndex < visualCount - 1) {
				const nextSegment = visualIndexToSegment(visualIndex + 1);
				if (nextSegment && nextSegment.row === segment.row) {
					ide_state.cursorRow = nextSegment.row;
					ide_state.cursorColumn = nextSegment.startColumn;
					moved = true;
				}
			}
			if (!moved && segment.row < buffer.getLineCount() - 1) {
				ide_state.cursorRow = segment.row + 1;
				ide_state.cursorColumn = 0;
			}
		}
	}
	const cursorLength = buffer.getLineEndOffset(ide_state.cursorRow) - buffer.getLineStartOffset(ide_state.cursorRow);
	ide_state.cursorColumn = ide_state.layout.clampLineLength(cursorLength, ide_state.cursorColumn);
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	ide_state.completion.onCursorMoved();
}

/**
 * Move cursor one word to the left
 */
export function moveWordLeft(): void {
	caretNavigation.clear();
	const destination = findWordLeft(ide_state.cursorRow, ide_state.cursorColumn);
	ide_state.cursorRow = destination.row;
	ide_state.cursorColumn = destination.column;
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	ide_state.completion.onCursorMoved();
}

/**
 * Move cursor one word to the right
 */
export function moveWordRight(): void {
	caretNavigation.clear();
	const destination = findWordRight(ide_state.cursorRow, ide_state.cursorColumn);
	ide_state.cursorRow = destination.row;
	ide_state.cursorColumn = destination.column;
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	ide_state.completion.onCursorMoved();
}

/**
 * Move cursor left by character or word
 */
export function moveCursorLeft(): void {
	const previous: Position = { row: ide_state.cursorRow, column: ide_state.cursorColumn };
	const select = isShiftDown();
	const byWord = isCtrlDown();
	if (select) {
		ensureSelectionAnchor(previous);
	} else if (hasSelection()) {
		collapseSelectionTo('start');
		breakUndoSequence();
		return;
	}
	if (byWord) {
		moveWordLeft();
	} else {
		moveCursorHorizontal(-1);
	}
	if (!select) {
		clearSelection();
	}
	breakUndoSequence();
	revealCursor();
}

/**
 * Move cursor right by character or word
 */
export function moveCursorRight(): void {
	const previous: Position = { row: ide_state.cursorRow, column: ide_state.cursorColumn };
	const select = isShiftDown();
	const byWord = isCtrlDown();

	if (select) {
		ensureSelectionAnchor(previous);
	} else if (hasSelection()) {
		collapseSelectionTo('end');
		breakUndoSequence();
		return;
	}
	if (byWord) {
		moveWordRight();
	} else {
		moveCursorHorizontal(1);
	}
	if (!select) {
		clearSelection();
	}
	breakUndoSequence();
	revealCursor();
}

/**
 * Move cursor up one line
 */
export function moveCursorUp(): void {
	const previous: Position = { row: ide_state.cursorRow, column: ide_state.cursorColumn };
	const select = isShiftDown();
	if (select) {
		ensureSelectionAnchor(previous);
	} else if (hasSelection()) {
		collapseSelectionTo('start');
		breakUndoSequence();
		return;
	}
	moveCursorVertical(-1);
	if (!select) {
		clearSelection();
	}
	breakUndoSequence();
	revealCursor();
}

/**
 * Move cursor down one line
 */
export function moveCursorDown(): void {
	const previous: Position = { row: ide_state.cursorRow, column: ide_state.cursorColumn };
	const select = isShiftDown();
	if (select) {
		ensureSelectionAnchor(previous);
	} else if (hasSelection()) {
		collapseSelectionTo('end');
		breakUndoSequence();
		return;
	}
	moveCursorVertical(1);
	if (!select) {
		clearSelection();
	}
	breakUndoSequence();
	revealCursor();
}

/**
 * Move cursor to start of line or document
 */
export function moveCursorHome(): void {
	const previousOverride = caretNavigation.lookup(ide_state.cursorRow, ide_state.cursorColumn);
	caretNavigation.clear();
	const buffer = ide_state.buffer;
	const previous: Position = { row: ide_state.cursorRow, column: ide_state.cursorColumn };
	const select = isShiftDown();
	if (select) {
		ensureSelectionAnchor(previous);
	} else {
		clearSelection();
	}
	const ctrlDown = isCtrlDown();
	if (ctrlDown) {
		ide_state.cursorRow = 0;
		ide_state.cursorColumn = 0;
	} else {
		ensureVisualLines();
		const visualIndex = previousOverride?.visualIndex ?? positionToVisualIndex(ide_state.cursorRow, ide_state.cursorColumn);
		const segment = visualIndexToSegment(visualIndex);
		if (segment) {
			ide_state.cursorRow = segment.row;
			const line = buffer.getLineContent(segment.row);
			ide_state.cursorColumn = resolveIndentAwareHome(line, segment, ide_state.cursorColumn);
			caretNavigation.capture(segment.row, ide_state.cursorColumn, visualIndex, segment.startColumn);
		} else {
			ide_state.cursorColumn = 0;
		}
	}
	updateDesiredColumn();
	resetBlink();
	breakUndoSequence();
	revealCursor();
}

/**
 * Move cursor to end of line or document
 */
export function moveCursorEnd(): void {
	const previousOverride = caretNavigation.lookup(ide_state.cursorRow, ide_state.cursorColumn);
	caretNavigation.clear();
	const buffer = ide_state.buffer;
	const previous: Position = { row: ide_state.cursorRow, column: ide_state.cursorColumn };
	const select = isShiftDown();
	if (select) {
		ensureSelectionAnchor(previous);
	} else {
		clearSelection();
	}
	const ctrlDown = isCtrlDown();
	if (ctrlDown) {
		const lastRow = buffer.getLineCount() - 1;
		ide_state.cursorRow = lastRow;
		ide_state.cursorColumn = buffer.getLineEndOffset(lastRow) - buffer.getLineStartOffset(lastRow);
	} else {
		ensureVisualLines();
		const visualIndex = previousOverride?.visualIndex ?? positionToVisualIndex(ide_state.cursorRow, ide_state.cursorColumn);
		const segment = visualIndexToSegment(visualIndex);
		if (segment) {
			ide_state.cursorRow = segment.row;
			const line = buffer.getLineContent(segment.row);
			ide_state.cursorColumn = resolveSegmentEnd(line, segment);
			caretNavigation.capture(segment.row, ide_state.cursorColumn, visualIndex, segment.startColumn);
		} else {
			ide_state.cursorColumn = currentLine().length;
		}
	}
	updateDesiredColumn();
	resetBlink();
	breakUndoSequence();
	revealCursor();
}

/**
 * Move cursor up one page
 */
export function pageUp(): void {
	const previous: Position = { row: ide_state.cursorRow, column: ide_state.cursorColumn };
	const select = isShiftDown();
	if (select) {
		ensureSelectionAnchor(previous);
	} else {
		clearSelection();
	}
	const { rows } = resolveViewportCapacity();
	const visualCount = getVisualLineCount();
	const currentVisual = positionToVisualIndex(ide_state.cursorRow, ide_state.cursorColumn);
	const targetVisual = ide_state.layout.clampVisualScroll(currentVisual - rows, visualCount, rows);
	setCursorFromVisualIndex(targetVisual, ide_state.desiredColumn, ide_state.desiredDisplayOffset);
	resetBlink();
	breakUndoSequence();
	revealCursor();
}

/**
 * Move cursor down one page
 */
export function pageDown(): void {
	const previous: Position = { row: ide_state.cursorRow, column: ide_state.cursorColumn };
	const select = isShiftDown();
	if (select) {
		ensureSelectionAnchor(previous);
	} else {
		clearSelection();
	}
	const { rows } = resolveViewportCapacity();
	const visualCount = getVisualLineCount();
	const currentVisual = positionToVisualIndex(ide_state.cursorRow, ide_state.cursorColumn);
	const targetVisual = ide_state.layout.clampVisualIndex(visualCount, currentVisual + rows);
	setCursorFromVisualIndex(targetVisual, ide_state.desiredColumn, ide_state.desiredDisplayOffset);
	resetBlink();
	breakUndoSequence();
	revealCursor();
}

function resolveViewportCapacity(): { rows: number; columns: number } {
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
	let target = cursorVisualIndex - Math.floor(rows / 2);
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
