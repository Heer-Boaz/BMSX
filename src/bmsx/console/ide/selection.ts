/**
 * Selection management for the console cart editor.
 * Handles text selection state, manipulation, and queries.
 */

import type { Position } from './types';
import { isWhitespace, isWordChar } from './text_utils';
import { ide_state } from './ide_state';
import {
	markTextMutated,
	resetBlink,
	updateDesiredColumn,
	recordEditContext,
	invalidateLineRange,
	invalidateHighlightsFromRow,
} from './console_cart_editor';
import { revealCursor } from './cursor_operations';

/**
 * Sets the selection anchor position.
 * The anchor is one end of the selection range; the cursor is the other end.
 * @param position The position to set as the anchor, or null to clear
 */
export function setSelectionAnchorPosition(position: Position | null): void {
	if (!position) {
		ide_state.selectionAnchor = null;
		return;
	}
	ide_state.selectionAnchor = { row: position.row, column: position.column };
}

/**
 * Clears the current selection by removing the anchor.
 */
export function clearSelection(): void {
	ide_state.selectionAnchor = null;
}

/**
 * Checks if there is an active selection.
 * @returns true if a selection exists (anchor differs from cursor)
 */
export function hasSelection(): boolean {
	return getSelectionRange() !== null;
}

/**
 * Compares two positions to determine their order.
 * @param a First position
 * @param b Second position
 * @returns Negative if a < b, positive if a > b, zero if equal
 */
export function comparePositions(a: Position, b: Position): number {
	if (a.row !== b.row) {
		return a.row - b.row;
	}
	return a.column - b.column;
}

/**
 * Gets the current selection range with normalized start/end positions.
 * @returns The selection range with start <= end, or null if no selection
 */
export function getSelectionRange(): { start: Position; end: Position } | null {
	const anchor = ide_state.selectionAnchor;
	if (!anchor) {
		return null;
	}
	const cursor: Position = { row: ide_state.cursorRow, column: ide_state.cursorColumn };
	if (anchor.row === cursor.row && anchor.column === cursor.column) {
		return null;
	}
	if (comparePositions(cursor, anchor) < 0) {
		return { start: cursor, end: anchor };
	}
	return { start: anchor, end: cursor };
}

/**
 * Gets the text content of the current selection.
 * @returns The selected text, or null if no selection
 */
export function getSelectionText(): string | null {
	const range = getSelectionRange();
	if (!range) {
		return null;
	}
	const { start, end } = range;
	if (start.row === end.row) {
		return ide_state.lines[start.row].slice(start.column, end.column);
	}
	const parts: string[] = [];
	parts.push(ide_state.lines[start.row].slice(start.column));
	for (let row = start.row + 1; row < end.row; row += 1) {
		parts.push(ide_state.lines[row]);
	}
	parts.push(ide_state.lines[end.row].slice(0, end.column));
	return parts.join('\n');
}

/**
 * Ensures that a selection anchor exists at the specified position.
 * Does nothing if an anchor is already set.
 * @param anchor The position to use as the anchor
 */
export function ensureSelectionAnchor(anchor: Position): void {
	if (!ide_state.selectionAnchor) {
		ide_state.selectionAnchor = { row: anchor.row, column: anchor.column };
	}
}

/**
 * Collapses the selection to either its start or end position.
 * @param target 'start' to move cursor to selection start, 'end' for selection end
 */
export function collapseSelectionTo(target: 'start' | 'end'): void {
	const range = getSelectionRange();
	if (!range) {
		return;
	}
	const destination = target === 'start' ? range.start : range.end;
	ide_state.cursorRow = destination.row;
	ide_state.cursorColumn = destination.column;
	ide_state.selectionAnchor = null;
	updateDesiredColumn();
	resetBlink();
	revealCursor();
}

/**
 * Selects the word at the specified position.
 * Word boundaries are determined by character type (word chars, whitespace, or symbols).
 * @param row The row containing the word
 * @param column The column within the word
 */
export function selectWordAtPosition(row: number, column: number): void {
	if (row < 0 || row >= ide_state.lines.length) {
		return;
	}
	const line = ide_state.lines[row];
	if (line.length === 0) {
		ide_state.selectionAnchor = null;
		ide_state.cursorRow = row;
		ide_state.cursorColumn = 0;
		updateDesiredColumn();
		resetBlink();
		revealCursor();
		return;
	}
	let index = column;
	if (index >= line.length) {
		index = line.length - 1;
	}
	if (index < 0) {
		index = 0;
	}
	let start = index;
	let end = index + 1;
	const current = line.charAt(index);
	if (isWordChar(current)) {
		while (start > 0 && isWordChar(line.charAt(start - 1))) {
			start -= 1;
		}
		while (end < line.length && isWordChar(line.charAt(end))) {
			end += 1;
		}
	} else if (isWhitespace(current)) {
		while (start > 0 && isWhitespace(line.charAt(start - 1))) {
			start -= 1;
		}
		while (end < line.length && isWhitespace(line.charAt(end))) {
			end += 1;
		}
	} else {
		while (start > 0) {
			const previous = line.charAt(start - 1);
			if (isWordChar(previous) || isWhitespace(previous)) {
				break;
			}
			start -= 1;
		}
		while (end < line.length) {
			const next = line.charAt(end);
			if (isWordChar(next) || isWhitespace(next)) {
				break;
			}
			end += 1;
		}
	}
	if (end < start) {
		end = start;
	}
	ide_state.selectionAnchor = { row, column: start };
	ide_state.cursorRow = row;
	ide_state.cursorColumn = end;
	updateDesiredColumn();
	resetBlink();
	revealCursor();
}

/**
 * Deletes the current selection if one exists.
 * @returns true if a selection was deleted, false if no selection existed
 */
export function deleteSelectionIfPresent(): boolean {
	if (!hasSelection()) {
		return false;
	}
	replaceSelectionWith('');
	return true;
}

/**
 * Replaces the current selection with the specified text.
 * If no selection exists, this function does nothing.
 * @param text The text to insert in place of the selection
 */
export function replaceSelectionWith(text: string): void {
	const range = getSelectionRange();
	if (!range) {
		return;
	}
	recordEditContext(text.length === 0 ? 'delete' : 'replace', text);
	const { start, end } = range;
	const startLine = ide_state.lines[start.row];
	const endLine = ide_state.lines[end.row];
	const leading = startLine.slice(0, start.column);
	const trailing = endLine.slice(end.column);
	const fragments = text.split('\n');
	if (fragments.length === 1) {
		const combined = leading + fragments[0] + trailing;
		ide_state.lines.splice(start.row, end.row - start.row + 1, combined);
		ide_state.cursorRow = start.row;
		ide_state.cursorColumn = leading.length + fragments[0].length;
	} else {
		const firstLine = leading + fragments[0];
		const lastFragment = fragments[fragments.length - 1];
		const lastLine = lastFragment + trailing;
		const middle = fragments.slice(1, -1);
		ide_state.lines.splice(start.row, end.row - start.row + 1, firstLine, ...middle, lastLine);
		ide_state.cursorRow = start.row + fragments.length - 1;
		ide_state.cursorColumn = lastFragment.length;
	}
	invalidateLineRange(start.row, start.row + fragments.length - 1);
	invalidateHighlightsFromRow(start.row);
	ide_state.selectionAnchor = null;
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

/**
 * Moves one position to the left in the document.
 * @param row Current row
 * @param column Current column
 * @returns The new position, or null if at the start of the document
 */
export function stepLeft(row: number, column: number): { row: number; column: number } | null {
	if (column > 0) {
		return { row, column: column - 1 };
	}
	if (row > 0) {
		return { row: row - 1, column: ide_state.lines[row - 1].length };
	}
	return null;
}

/**
 * Moves one position to the right in the document.
 * @param row Current row
 * @param column Current column
 * @returns The new position, or null if at the end of the document
 */
export function stepRight(row: number, column: number): { row: number; column: number } | null {
	const length = ide_state.lines[row].length;
	if (column < length) {
		return { row, column: column + 1 };
	}
	if (row < ide_state.lines.length - 1) {
		return { row: row + 1, column: 0 };
	}
	return null;
}
