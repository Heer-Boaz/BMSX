import { breakUndoSequence } from './undo_controller';
import { currentLine } from './text_utils';
import { ensureVisualLines, getVisualLineCount, positionToVisualIndex, visualIndexToSegment } from './text_utils';
import { caretNavigation, ide_state } from './ide_state';
import { isShiftDown, isCtrlDown } from './ide_input';
import { resetBlink } from './render/render_caret';
import { findWordLeft, findWordRight, hasSelection, collapseSelectionTo, clearSelection } from './text_editing_and_selection';
import { ensureSingleCursorSelectionAnchor } from './cursor_state';
import type { VisualLineSegment } from './types';
import { revealCursor, resolveViewportCapacity, setCursorFromVisualIndex, updateDesiredColumn } from './caret_view';

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
	const select = isShiftDown();
	const byWord = isCtrlDown();
	if (select) {
		ensureSingleCursorSelectionAnchor(ide_state, ide_state.cursorRow, ide_state.cursorColumn);
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
	const select = isShiftDown();
	const byWord = isCtrlDown();

	if (select) {
		ensureSingleCursorSelectionAnchor(ide_state, ide_state.cursorRow, ide_state.cursorColumn);
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
	const select = isShiftDown();
	if (select) {
		ensureSingleCursorSelectionAnchor(ide_state, ide_state.cursorRow, ide_state.cursorColumn);
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
	const select = isShiftDown();
	if (select) {
		ensureSingleCursorSelectionAnchor(ide_state, ide_state.cursorRow, ide_state.cursorColumn);
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
	const select = isShiftDown();
	if (select) {
		ensureSingleCursorSelectionAnchor(ide_state, ide_state.cursorRow, ide_state.cursorColumn);
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
	const select = isShiftDown();
	if (select) {
		ensureSingleCursorSelectionAnchor(ide_state, ide_state.cursorRow, ide_state.cursorColumn);
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
	const select = isShiftDown();
	if (select) {
		ensureSingleCursorSelectionAnchor(ide_state, ide_state.cursorRow, ide_state.cursorColumn);
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
	const select = isShiftDown();
	if (select) {
		ensureSingleCursorSelectionAnchor(ide_state, ide_state.cursorRow, ide_state.cursorColumn);
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
export { centerCursorVertically, ensureCursorVisible, revealCursor, setCursorFromVisualIndex, updateDesiredColumn } from './caret_view';
