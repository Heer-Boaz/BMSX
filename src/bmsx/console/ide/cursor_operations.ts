/**
 * Cursor/Caret movement and navigation operations
 */

import { clamp } from '../../utils/utils';
import { ide_state } from './ide_state';
import type { Position } from './types';
import { resolveIndentAwareHome, resolveSegmentEnd } from './caret_navigation';
import {
	caretNavigation,
	updateDesiredColumn,
	resetBlink,
	onCursorMoved,
	ensureVisualLines,
	getVisualLineCount,
	positionToVisualIndex,
	visualIndexToSegment,
	setCursorFromVisualIndex,
	ensureCursorVisible,
	currentLine,
	findWordLeft,
	findWordRight,
	ensureSelectionAnchor,
	hasSelection,
	collapseSelectionTo,
	clearSelection,
	breakUndoSequence,
	visibleRowCount,
} from './console_cart_editor';
import { isModifierPressed as isModifierPressedGlobal } from './input_helpers';

/**
 * Set cursor to a specific row and column position
 */
export function setCursorPosition(row: number, column: number): void {
	caretNavigation.clear();
	let targetRow = row;
	if (targetRow < 0) {
		targetRow = 0;
	}
	const lastRow = ide_state.lines.length - 1;
	if (targetRow > lastRow) {
		targetRow = lastRow >= 0 ? lastRow : 0;
	}
	let targetColumn = column;
	if (targetColumn < 0) {
		targetColumn = 0;
	}
	const lineLength = ide_state.lines[targetRow]?.length ?? 0;
	if (targetColumn > lineLength) {
		targetColumn = lineLength;
	}
	ide_state.cursorRow = targetRow;
	ide_state.cursorColumn = targetColumn;
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	onCursorMoved();
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
	const targetIndex = clamp(currentIndex + delta, 0, visualCount - 1);
	const desired = ide_state.desiredColumn;
	const desiredDisplay = ide_state.desiredDisplayOffset;
	setCursorFromVisualIndex(targetIndex, desired, desiredDisplay);
	resetBlink();
	revealCursor();
	onCursorMoved();
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
	const line = ide_state.lines[segment.row] ?? '';
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
					const prevLine = ide_state.lines[prevSegment.row] ?? '';
					const prevEnd = Math.max(prevSegment.endColumn, prevSegment.startColumn);
					const hasMoreBefore = prevEnd > prevSegment.startColumn;
					const targetColumn = hasMoreBefore && prevEnd < prevLine.length
						? Math.max(prevSegment.startColumn, prevEnd - 1)
						: Math.min(prevEnd, prevLine.length);
					ide_state.cursorColumn = clamp(targetColumn, 0, prevLine.length);
					moved = true;
				}
			}
			if (!moved && segment.row > 0) {
				ide_state.cursorRow = segment.row - 1;
				ide_state.cursorColumn = ide_state.lines[ide_state.cursorRow].length;
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
			if (!moved && segment.row < ide_state.lines.length - 1) {
				ide_state.cursorRow = segment.row + 1;
				ide_state.cursorColumn = 0;
			}
		}
	}
	ide_state.cursorColumn = clamp(ide_state.cursorColumn, 0, ide_state.lines[ide_state.cursorRow]?.length ?? 0);
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	onCursorMoved();
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
	onCursorMoved();
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
	onCursorMoved();
}

/**
 * Move cursor left by character or word
 */
export function moveCursorLeft(byWord: boolean, select: boolean): void {
	const previous: Position = { row: ide_state.cursorRow, column: ide_state.cursorColumn };
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
export function moveCursorRight(byWord: boolean, select: boolean): void {
	const previous: Position = { row: ide_state.cursorRow, column: ide_state.cursorColumn };
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
export function moveCursorUp(select: boolean): void {
	const previous: Position = { row: ide_state.cursorRow, column: ide_state.cursorColumn };
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
export function moveCursorDown(select: boolean): void {
	const previous: Position = { row: ide_state.cursorRow, column: ide_state.cursorColumn };
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
export function moveCursorHome(select: boolean): void {
	const previousOverride = caretNavigation.peek(ide_state.cursorRow, ide_state.cursorColumn);
	caretNavigation.clear();
	const previous: Position = { row: ide_state.cursorRow, column: ide_state.cursorColumn };
	if (select) {
		ensureSelectionAnchor(previous);
	} else {
		clearSelection();
	}
	const ctrlDown = isModifierPressedGlobal(ide_state.playerIndex, 'ControlLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'ControlRight');
	if (ctrlDown) {
		ide_state.cursorRow = 0;
		ide_state.cursorColumn = 0;
	} else {
		ensureVisualLines();
		const visualIndex = previousOverride?.visualIndex ?? positionToVisualIndex(ide_state.cursorRow, ide_state.cursorColumn);
		const segment = visualIndexToSegment(visualIndex);
		if (segment) {
			ide_state.cursorRow = segment.row;
			const line = ide_state.lines[segment.row] ?? '';
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
export function moveCursorEnd(select: boolean): void {
	const previousOverride = caretNavigation.peek(ide_state.cursorRow, ide_state.cursorColumn);
	caretNavigation.clear();
	const previous: Position = { row: ide_state.cursorRow, column: ide_state.cursorColumn };
	if (select) {
		ensureSelectionAnchor(previous);
	} else {
		clearSelection();
	}
	const ctrlDown = isModifierPressedGlobal(ide_state.playerIndex, 'ControlLeft') || isModifierPressedGlobal(ide_state.playerIndex, 'ControlRight');
	if (ctrlDown) {
		const lastRow = ide_state.lines.length - 1;
		if (lastRow < 0) {
			ide_state.cursorRow = 0;
			ide_state.cursorColumn = 0;
		} else {
			ide_state.cursorRow = lastRow;
			ide_state.cursorColumn = ide_state.lines[lastRow].length;
		}
	} else {
		ensureVisualLines();
		const visualIndex = previousOverride?.visualIndex ?? positionToVisualIndex(ide_state.cursorRow, ide_state.cursorColumn);
		const segment = visualIndexToSegment(visualIndex);
		if (segment) {
			ide_state.cursorRow = segment.row;
			const line = ide_state.lines[segment.row] ?? '';
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
export function pageUp(select: boolean): void {
	const previous: Position = { row: ide_state.cursorRow, column: ide_state.cursorColumn };
	if (select) {
		ensureSelectionAnchor(previous);
	} else {
		clearSelection();
	}
	const rows = visibleRowCount();
	ensureVisualLines();
	const visualCount = getVisualLineCount();
	const currentVisual = positionToVisualIndex(ide_state.cursorRow, ide_state.cursorColumn);
	const targetVisual = clamp(currentVisual - rows, 0, Math.max(0, visualCount - 1));
	setCursorFromVisualIndex(targetVisual, ide_state.desiredColumn, ide_state.desiredDisplayOffset);
	resetBlink();
	breakUndoSequence();
	revealCursor();
}

/**
 * Move cursor down one page
 */
export function pageDown(select: boolean): void {
	const previous: Position = { row: ide_state.cursorRow, column: ide_state.cursorColumn };
	if (select) {
		ensureSelectionAnchor(previous);
	} else {
		clearSelection();
	}
	const rows = visibleRowCount();
	ensureVisualLines();
	const visualCount = getVisualLineCount();
	const currentVisual = positionToVisualIndex(ide_state.cursorRow, ide_state.cursorColumn);
	const targetVisual = clamp(currentVisual + rows, 0, Math.max(0, visualCount - 1));
	setCursorFromVisualIndex(targetVisual, ide_state.desiredColumn, ide_state.desiredDisplayOffset);
	resetBlink();
	breakUndoSequence();
	revealCursor();
}

/**
 * Clamp cursor row to valid range
 */
export function clampCursorRow(): void {
	if (ide_state.cursorRow < 0) {
		ide_state.cursorRow = 0;
	} else if (ide_state.cursorRow >= ide_state.lines.length) {
		ide_state.cursorRow = Math.max(0, ide_state.lines.length - 1);
	}
}

/**
 * Clamp cursor column to valid range for current line
 */
export function clampCursorColumn(): void {
	const line = currentLine();
	if (ide_state.cursorColumn < 0) {
		ide_state.cursorColumn = 0;
		return;
	}
	const length = line.length;
	if (ide_state.cursorColumn > length) {
		ide_state.cursorColumn = length;
	}
}
