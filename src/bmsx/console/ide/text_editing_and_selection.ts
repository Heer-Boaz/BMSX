/**
 * Comprehensive text editing and selection module for the console cart editor.
 * Handles ALL text manipulation, selection state, clipboard operations, and editing commands.
 *
 * This module consolidates:
 * - Selection state management and queries
 * - Text insertion and deletion operations
 * - Word-level editing (deleteWord, findWord, etc.)
 * - Line operations (delete, move, indent)
 * - Clipboard operations (copy, cut, paste)
 * - Multi-line editing with selection support
 */

import { $ } from '../../core/game';
import { clamp } from '../../utils/utils';
import { ide_state } from './ide_state';
import type { Position } from './types';
import { isWhitespace, isWordChar } from './text_utils';
import {
	revealCursor,
	clampCursorColumn,
} from './cursor_operations';
import {
	updateDesiredColumn,
	resetBlink,
	markTextMutated,
	invalidateLine,
	invalidateLineRange,
	invalidateHighlightsFromRow,
	recordEditContext,
	prepareUndo,
	currentLine,
} from './console_cart_editor';
import * as constants from './constants';

// ============================================================================
// SELECTION STATE MANAGEMENT
// ============================================================================

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
 * Clamps a position to valid document bounds.
 * @param position The position to clamp, or null
 * @returns The clamped position, or null if input was null
 */
export function clampSelectionPosition(position: Position | null): Position | null {
	if (!position || ide_state.lines.length === 0) {
		return null;
	}
	let row = position.row;
	if (row < 0) {
		row = 0;
	} else if (row >= ide_state.lines.length) {
		row = ide_state.lines.length - 1;
	}
	const line = ide_state.lines[row] ?? '';
	let column = position.column;
	if (column < 0) {
		column = 0;
	} else if (column > line.length) {
		column = line.length;
	}
	return { row, column };
}

// ============================================================================
// POSITION NAVIGATION HELPERS
// ============================================================================

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

/**
 * Gets the character at the specified position.
 * @param row Row index
 * @param column Column index
 * @returns The character, or empty string if position is out of bounds
 */
export function charAt(row: number, column: number): string {
	if (row < 0 || row >= ide_state.lines.length) {
		return '';
	}
	const line = ide_state.lines[row];
	if (column < 0 || column >= line.length) {
		return '';
	}
	return line.charAt(column);
}

/**
 * Finds the start of the word to the left of the cursor.
 * @param row Current row
 * @param column Current column
 * @returns The position of the word start
 */
export function findWordLeft(row: number, column: number): { row: number; column: number } {
	let currentRow = row;
	let currentColumn = column;
	let step = stepLeft(currentRow, currentColumn);
	if (!step) {
		return { row: 0, column: 0 };
	}
	currentRow = step.row;
	currentColumn = step.column;
	let currentChar = charAt(currentRow, currentColumn);
	while (isWhitespace(currentChar)) {
		const previous = stepLeft(currentRow, currentColumn);
		if (!previous) {
			return { row: 0, column: 0 };
		}
		currentRow = previous.row;
		currentColumn = previous.column;
		currentChar = charAt(currentRow, currentColumn);
	}
	const word = isWordChar(currentChar);
	while (true) {
		const previous = stepLeft(currentRow, currentColumn);
		if (!previous) {
			currentRow = 0;
			currentColumn = 0;
			break;
		}
		const previousChar = charAt(previous.row, previous.column);
		if (isWhitespace(previousChar) || isWordChar(previousChar) !== word) {
			break;
		}
		currentRow = previous.row;
		currentColumn = previous.column;
	}
	return { row: currentRow, column: currentColumn };
}

/**
 * Finds the end of the word to the right of the cursor.
 * @param row Current row
 * @param column Current column
 * @returns The position of the word end
 */
export function findWordRight(row: number, column: number): { row: number; column: number } {
	let currentRow = row;
	let currentColumn = column;
	let step = stepRight(currentRow, currentColumn);
	if (!step) {
		const lastRow = ide_state.lines.length - 1;
		return { row: lastRow, column: ide_state.lines[lastRow].length };
	}
	currentRow = step.row;
	currentColumn = step.column;
	let currentChar = charAt(currentRow, currentColumn);
	while (isWhitespace(currentChar)) {
		const next = stepRight(currentRow, currentColumn);
		if (!next) {
			const lastRow = ide_state.lines.length - 1;
			return { row: lastRow, column: ide_state.lines[lastRow].length };
		}
		currentRow = next.row;
		currentColumn = next.column;
		currentChar = charAt(currentRow, currentColumn);
	}
	const word = isWordChar(currentChar);
	while (true) {
		const next = stepRight(currentRow, currentColumn);
		if (!next) {
			const lastRow = ide_state.lines.length - 1;
			currentRow = lastRow;
			currentColumn = ide_state.lines[lastRow].length;
			break;
		}
		const nextChar = charAt(next.row, next.column);
		if (isWhitespace(nextChar) || isWordChar(nextChar) !== word) {
			currentRow = next.row;
			currentColumn = next.column;
			break;
		}
		currentRow = next.row;
		currentColumn = next.column;
	}
	while (isWhitespace(charAt(currentRow, currentColumn))) {
		const next = stepRight(currentRow, currentColumn);
		if (!next) {
			const lastRow = ide_state.lines.length - 1;
			currentRow = lastRow;
			currentColumn = ide_state.lines[lastRow].length;
			break;
		}
		currentRow = next.row;
		currentColumn = next.column;
	}
	return { row: currentRow, column: currentColumn };
}

// ============================================================================
// SELECTION MANIPULATION
// ============================================================================

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
 * Deletes the selection with undo support.
 * This is the high-level version that prepares undo.
 */
export function deleteSelection(): void {
	if (!hasSelection()) {
		return;
	}
	prepareUndo('delete-selection', false);
	replaceSelectionWith('');
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

// ============================================================================
// TEXT INSERTION OPERATIONS
// ============================================================================

/**
 * Inserts text at the current cursor position.
 * If there's a selection, it will be replaced.
 * @param text The text to insert
 */
export function insertText(text: string): void {
	if (text.length === 0) {
		return;
	}
	const coalesce = text.length === 1;
	prepareUndo('insert-text', coalesce);
	if (deleteSelectionIfPresent()) {
		// Selection replaced.
	}
	const line = currentLine();
	const before = line.slice(0, ide_state.cursorColumn);
	const after = line.slice(ide_state.cursorColumn);
	ide_state.lines[ide_state.cursorRow] = before + text + after;
	invalidateLine(ide_state.cursorRow);
	recordEditContext('insert', text);
	ide_state.cursorColumn += text.length;
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	clearSelection();
	revealCursor();
}

/**
 * Inserts a line break at the current cursor position.
 * Auto-indents the new line based on the previous line's indentation.
 */
export function insertLineBreak(): void {
	const sourceRow = ide_state.cursorRow;
	prepareUndo('insert-line-break', false);
	deleteSelectionIfPresent();
	const line = currentLine();
	const before = line.slice(0, ide_state.cursorColumn);
	const after = line.slice(ide_state.cursorColumn);
	ide_state.lines[sourceRow] = before;
	const indentation = extractIndentation(before);
	const newLine = indentation + after;
	ide_state.lines.splice(sourceRow + 1, 0, newLine);
	invalidateLineRange(sourceRow, sourceRow + 1);
	invalidateHighlightsFromRow(sourceRow);
	ide_state.cursorRow = sourceRow + 1;
	ide_state.cursorColumn = indentation.length;
	recordEditContext('insert', '\n');
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	clearSelection();
	revealCursor();
}

/**
 * Extracts the leading whitespace indentation from a string.
 * @param value The string to extract indentation from
 * @returns The indentation string (spaces and tabs)
 */
export function extractIndentation(value: string): string {
	let result = '';
	for (let i = 0; i < value.length; i += 1) {
		const ch = value.charAt(i);
		if (ch === ' ' || ch === '\t') {
			result += ch;
		} else {
			break;
		}
	}
	return result;
}

/**
 * Counts the number of leading indentation characters (spaces and tabs).
 * @param line The line to count indentation for
 * @returns The number of leading whitespace characters
 */
export function countLeadingIndent(line: string): number {
	let count = 0;
	while (count < line.length) {
		const ch = line.charAt(count);
		if (ch === '\t' || ch === ' ') {
			count += 1;
		} else {
			break;
		}
	}
	return count;
}

/**
 * Inserts text from the clipboard at the current cursor position.
 * Handles multi-line text properly.
 * @param text The clipboard text to insert
 */
export function insertClipboardText(text: string): void {
	const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const fragments = normalized.split('\n');
	const currentLineValue = currentLine();
	const before = currentLineValue.slice(0, ide_state.cursorColumn);
	const after = currentLineValue.slice(ide_state.cursorColumn);
	if (fragments.length === 1) {
		const fragment = fragments[0];
		ide_state.lines[ide_state.cursorRow] = before + fragment + after;
		invalidateLine(ide_state.cursorRow);
		ide_state.cursorColumn = before.length + fragment.length;
		recordEditContext('insert', fragment);
	} else {
		const firstLine = before + fragments[0];
		const lastIndex = fragments.length - 1;
		const lastFragment = fragments[lastIndex];
		const newLines: string[] = [];
		newLines.push(firstLine);
		for (let i = 1; i < lastIndex; i += 1) {
			newLines.push(fragments[i]);
		}
		newLines.push(lastFragment + after);
		const insertionRow = ide_state.cursorRow;
		ide_state.lines.splice(insertionRow, 1, ...newLines);
		invalidateLineRange(insertionRow, insertionRow + newLines.length - 1);
		invalidateHighlightsFromRow(insertionRow);
		ide_state.cursorRow = insertionRow + lastIndex;
		ide_state.cursorColumn = lastFragment.length;
		recordEditContext('insert', normalized);
	}
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

// ============================================================================
// TEXT DELETION OPERATIONS
// ============================================================================

/**
 * Deletes the character before the cursor (backspace).
 * If there's a selection, deletes the selection instead.
 */
export function backspace(): void {
	if (!hasSelection() && ide_state.cursorColumn === 0 && ide_state.cursorRow === 0) {
		return;
	}
	prepareUndo('backspace', true);
	if (deleteSelectionIfPresent()) {
		return;
	}
	if (ide_state.cursorColumn > 0) {
		const line = currentLine();
		const removedChar = line.charAt(ide_state.cursorColumn - 1);
		const before = line.slice(0, ide_state.cursorColumn - 1);
		const after = line.slice(ide_state.cursorColumn);
		ide_state.lines[ide_state.cursorRow] = before + after;
		invalidateLine(ide_state.cursorRow);
		ide_state.cursorColumn -= 1;
		recordEditContext('delete', removedChar);
		markTextMutated();
		resetBlink();
		updateDesiredColumn();
		revealCursor();
		return;
	}
	if (ide_state.cursorRow === 0) {
		return;
	}
	const mergedRow = ide_state.cursorRow - 1;
	const previousLine = ide_state.lines[mergedRow];
	const currentLineValue = currentLine();
	recordEditContext('delete', '\n');
	ide_state.lines[mergedRow] = previousLine + currentLineValue;
	ide_state.lines.splice(ide_state.cursorRow, 1);
	invalidateLine(mergedRow);
	invalidateHighlightsFromRow(mergedRow);
	ide_state.cursorRow = mergedRow;
	ide_state.cursorColumn = previousLine.length;
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

/**
 * Deletes the character after the cursor (delete key).
 * If there's a selection, deletes the selection instead.
 */
export function deleteForward(): void {
	if (!hasSelection() && ide_state.cursorColumn >= currentLine().length && ide_state.cursorRow >= ide_state.lines.length - 1) {
		return;
	}
	prepareUndo('delete-forward', true);
	if (deleteSelectionIfPresent()) {
		return;
	}
	const line = currentLine();
	if (ide_state.cursorColumn < line.length) {
		const removedChar = line.charAt(ide_state.cursorColumn);
		const before = line.slice(0, ide_state.cursorColumn);
		const after = line.slice(ide_state.cursorColumn + 1);
		ide_state.lines[ide_state.cursorRow] = before + after;
		invalidateLine(ide_state.cursorRow);
		recordEditContext('delete', removedChar);
		markTextMutated();
		resetBlink();
		updateDesiredColumn();
		revealCursor();
		return;
	}
	if (ide_state.cursorRow >= ide_state.lines.length - 1) {
		return;
	}
	const nextLine = ide_state.lines[ide_state.cursorRow + 1];
	const updatedLine = line + nextLine;
	ide_state.lines[ide_state.cursorRow] = updatedLine;
	ide_state.lines.splice(ide_state.cursorRow + 1, 1);
	invalidateLine(ide_state.cursorRow);
	invalidateHighlightsFromRow(ide_state.cursorRow);
	recordEditContext('delete', '\n');
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

/**
 * Deletes from the cursor to the start of the previous word.
 */
export function deleteWordBackward(): void {
	if (!hasSelection() && ide_state.cursorColumn === 0 && ide_state.cursorRow === 0) {
		return;
	}
	prepareUndo('delete-word-backward', false);
	if (deleteSelectionIfPresent()) {
		return;
	}
	const target = findWordLeft(ide_state.cursorRow, ide_state.cursorColumn);
	if (target.row === ide_state.cursorRow && target.column === ide_state.cursorColumn) {
		backspace();
		return;
	}
	const startRow = target.row;
	const startColumn = target.column;
	const endRow = ide_state.cursorRow;
	const endColumn = ide_state.cursorColumn;
	if (startRow === endRow) {
		const line = ide_state.lines[startRow];
		const removed = line.slice(startColumn, endColumn);
		ide_state.lines[startRow] = line.slice(0, startColumn) + line.slice(endColumn);
		ide_state.cursorColumn = startColumn;
		invalidateLine(startRow);
		recordEditContext('delete', removed);
		markTextMutated();
		resetBlink();
		updateDesiredColumn();
		revealCursor();
		return;
	}
	const firstLine = ide_state.lines[startRow];
	const lastLine = ide_state.lines[endRow];
	const removedParts: string[] = [];
	removedParts.push(firstLine.slice(startColumn));
	for (let row = startRow + 1; row < endRow; row += 1) {
		removedParts.push(ide_state.lines[row]);
	}
	removedParts.push(lastLine.slice(0, endColumn));
	ide_state.lines[startRow] = firstLine.slice(0, startColumn) + lastLine.slice(endColumn);
	ide_state.lines.splice(startRow + 1, endRow - startRow);
	ide_state.cursorRow = startRow;
	ide_state.cursorColumn = startColumn;
	invalidateLine(startRow);
	invalidateHighlightsFromRow(startRow);
	recordEditContext('delete', removedParts.join('\n'));
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

/**
 * Deletes from the cursor to the end of the next word.
 */
export function deleteWordForward(): void {
	if (!hasSelection() && ide_state.cursorRow >= ide_state.lines.length - 1 && ide_state.cursorColumn >= currentLine().length) {
		return;
	}
	prepareUndo('delete-word-forward', false);
	if (deleteSelectionIfPresent()) {
		return;
	}
	const destination = findWordRight(ide_state.cursorRow, ide_state.cursorColumn);
	if (destination.row === ide_state.cursorRow && destination.column === ide_state.cursorColumn) {
		deleteForward();
		return;
	}
	const startRow = ide_state.cursorRow;
	const startColumn = ide_state.cursorColumn;
	const endRow = destination.row;
	const endColumn = destination.column;
	if (startRow === endRow) {
		const line = ide_state.lines[startRow];
		const removed = line.slice(startColumn, endColumn);
		ide_state.lines[startRow] = line.slice(0, startColumn) + line.slice(endColumn);
		invalidateLine(startRow);
		recordEditContext('delete', removed);
	} else {
		const firstLine = ide_state.lines[startRow];
		const lastLine = ide_state.lines[endRow];
		const removedParts: string[] = [];
		removedParts.push(firstLine.slice(startColumn));
		for (let row = startRow + 1; row < endRow; row += 1) {
			removedParts.push(ide_state.lines[row]);
		}
		removedParts.push(lastLine.slice(0, endColumn));
		ide_state.lines[startRow] = firstLine.slice(0, startColumn) + lastLine.slice(endColumn);
		ide_state.lines.splice(startRow + 1, endRow - startRow);
		invalidateLine(startRow);
		invalidateHighlightsFromRow(startRow);
		recordEditContext('delete', removedParts.join('\n'));
	}
	ide_state.cursorRow = startRow;
	ide_state.cursorColumn = startColumn;
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

// ============================================================================
// LINE OPERATIONS
// ============================================================================

/**
 * Deletes the currently active line(s).
 * If there's a selection spanning multiple lines, deletes all selected lines.
 */
export function deleteActiveLines(): void {
	if (ide_state.lines.length === 0) {
		return;
	}
	prepareUndo('delete-active-lines', false);
	const range = getSelectionRange();
	if (!range) {
		const removedRow = ide_state.cursorRow;
		ide_state.lines.splice(removedRow, 1);
		if (ide_state.lines.length === 0) {
			ide_state.lines = [''];
			ide_state.cursorRow = 0;
			ide_state.cursorColumn = 0;
		} else if (ide_state.cursorRow >= ide_state.lines.length) {
			ide_state.cursorRow = ide_state.lines.length - 1;
			ide_state.cursorColumn = ide_state.lines[ide_state.cursorRow].length;
		} else {
			const line = ide_state.lines[ide_state.cursorRow];
			ide_state.cursorColumn = Math.min(ide_state.cursorColumn, line.length);
		}
		invalidateLine(ide_state.cursorRow);
		invalidateHighlightsFromRow(Math.min(removedRow, ide_state.lines.length - 1));
		recordEditContext('delete', '\n');
		markTextMutated();
		resetBlink();
		updateDesiredColumn();
		revealCursor();
		return;
	}
	const { start, end } = range;
	const deletionStart = start.row;
	let deletionEnd = end.row;
	if (end.column === 0 && end.row > start.row) {
		deletionEnd -= 1;
	}
	const count = deletionEnd - deletionStart + 1;
	const deletedLines = ide_state.lines.slice(deletionStart, deletionStart + count);
	ide_state.lines.splice(deletionStart, count);
	if (ide_state.lines.length === 0) {
		ide_state.lines = [''];
	}
	ide_state.cursorRow = clamp(deletionStart, 0, ide_state.lines.length - 1);
	ide_state.cursorColumn = 0;
	ide_state.selectionAnchor = null;
	invalidateLine(ide_state.cursorRow);
	invalidateHighlightsFromRow(deletionStart);
	recordEditContext('delete', deletedLines.join('\n'));
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

/**
 * Gets the line range affected by line operations (move, delete, etc.).
 * If there's a selection, returns the full line range of the selection.
 * Otherwise, returns just the current line.
 */
export function getLineRangeForMovement(): { startRow: number; endRow: number } {
	const range = getSelectionRange();
	if (!range) {
		return { startRow: ide_state.cursorRow, endRow: ide_state.cursorRow };
	}
	let endRow = range.end.row;
	if (range.end.column === 0 && endRow > range.start.row) {
		endRow -= 1;
	}
	return { startRow: range.start.row, endRow };
}

/**
 * Moves the selected line(s) up or down by the specified delta.
 * @param delta Number of lines to move (negative for up, positive for down)
 */
export function moveSelectionLines(delta: number): void {
	if (delta === 0) {
		return;
	}
	const range = getLineRangeForMovement();
	if (delta < 0 && range.startRow === 0) {
		return;
	}
	if (delta > 0 && range.endRow >= ide_state.lines.length - 1) {
		return;
	}
	prepareUndo('move-lines', false);
	const count = range.endRow - range.startRow + 1;
	const block = ide_state.lines.splice(range.startRow, count);
	const targetIndex = range.startRow + delta;
	ide_state.lines.splice(targetIndex, 0, ...block);
	const affectedStart = Math.max(0, Math.min(range.startRow, targetIndex));
	const affectedEnd = Math.min(ide_state.lines.length - 1, Math.max(range.endRow, targetIndex + count - 1));
	if (affectedStart <= affectedEnd) {
		for (let row = affectedStart; row <= affectedEnd; row += 1) {
			invalidateLine(row);
		}
	}
	invalidateHighlightsFromRow(affectedStart);
	ide_state.cursorRow += delta;
	if (ide_state.selectionAnchor) {
		ide_state.selectionAnchor = { row: ide_state.selectionAnchor.row + delta, column: ide_state.selectionAnchor.column };
	}
	clampCursorColumn();
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

// ============================================================================
// INDENTATION OPERATIONS
// ============================================================================

/**
 * Indents the current line or selected lines by adding a tab character.
 */
export function indentSelectionOrLine(): void {
	prepareUndo('indent', false);
	const range = getSelectionRange();
	if (!range) {
		const line = currentLine();
		ide_state.lines[ide_state.cursorRow] = '\t' + line;
		ide_state.cursorColumn += 1;
		invalidateLine(ide_state.cursorRow);
		recordEditContext('insert', '\t');
		markTextMutated();
		resetBlink();
		updateDesiredColumn();
		revealCursor();
		return;
	}
	for (let row = range.start.row; row <= range.end.row; row += 1) {
		ide_state.lines[row] = '\t' + ide_state.lines[row];
		invalidateLine(row);
	}
	if (ide_state.selectionAnchor) {
		ide_state.selectionAnchor = { row: ide_state.selectionAnchor.row, column: ide_state.selectionAnchor.column + 1 };
	}
	ide_state.cursorColumn += 1;
	recordEditContext('insert', '\t');
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

/**
 * Unindents the current line or selected lines by removing one indentation character.
 */
export function unindentSelectionOrLine(): void {
	prepareUndo('unindent', false);
	const range = getSelectionRange();
	if (!range) {
		const line = currentLine();
		const indentation = countLeadingIndent(line);
		if (indentation === 0) {
			return;
		}
		const remove = Math.min(indentation, 1);
		ide_state.lines[ide_state.cursorRow] = line.slice(remove);
		ide_state.cursorColumn = Math.max(0, ide_state.cursorColumn - remove);
		invalidateLine(ide_state.cursorRow);
		recordEditContext('delete', line.slice(0, remove));
		markTextMutated();
		resetBlink();
		updateDesiredColumn();
		revealCursor();
		return;
	}
	for (let row = range.start.row; row <= range.end.row; row += 1) {
		const line = ide_state.lines[row];
		const indentation = countLeadingIndent(line);
		if (indentation > 0) {
			ide_state.lines[row] = line.slice(1);
			invalidateLine(row);
		}
	}
	if (ide_state.selectionAnchor) {
		ide_state.selectionAnchor = { row: ide_state.selectionAnchor.row, column: Math.max(0, ide_state.selectionAnchor.column - 1) };
	}
	ide_state.cursorColumn = Math.max(0, ide_state.cursorColumn - 1);
	recordEditContext('delete', '\t');
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

// ============================================================================
// CLIPBOARD OPERATIONS
// ============================================================================

/**
 * Copies the current selection to the clipboard.
 * Shows a message if nothing is selected.
 */
export async function copySelectionToClipboard(): Promise<void> {
	const text = getSelectionText();
	if (text === null) {
		ide_state.showMessage('Nothing selected to copy', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	await writeClipboard(text, 'Copied selection to clipboard');
}

/**
 * Cuts the current selection to the clipboard (copy + delete).
 * Shows a message if nothing is selected.
 */
export async function cutSelectionToClipboard(): Promise<void> {
	const text = getSelectionText();
	if (text === null) {
		ide_state.showMessage('Nothing selected to cut', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	prepareUndo('cut', false);
	await writeClipboard(text, 'Cut selection to clipboard');
	replaceSelectionWith('');
}

/**
 * Cuts the current line to the clipboard.
 * Used when no selection is active.
 */
export async function cutLineToClipboard(): Promise<void> {
	if (ide_state.lines.length === 0) {
		ide_state.showMessage('Nothing to cut', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const currentLineValue = currentLine();
	const isLastLine = ide_state.cursorRow >= ide_state.lines.length - 1;
	const text = isLastLine ? currentLineValue : currentLineValue + '\n';
	prepareUndo('cut-line', false);
	await writeClipboard(text, 'Cut line to clipboard');
	if (ide_state.lines.length === 1) {
		ide_state.lines[0] = '';
		ide_state.cursorColumn = 0;
	} else {
		const removedRow = ide_state.cursorRow;
		ide_state.lines.splice(ide_state.cursorRow, 1);
		if (ide_state.cursorRow >= ide_state.lines.length) {
			ide_state.cursorRow = ide_state.lines.length - 1;
		}
		const newLength = ide_state.lines[ide_state.cursorRow].length;
		if (ide_state.cursorColumn > newLength) {
			ide_state.cursorColumn = newLength;
		}
		invalidateHighlightsFromRow(Math.min(removedRow, ide_state.lines.length - 1));
	}
	invalidateLine(ide_state.cursorRow);
	ide_state.selectionAnchor = null;
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

/**
 * Pastes text from the editor's internal clipboard.
 */
export function pasteFromClipboard(): void {
	const text = ide_state.customClipboard;
	if (text === null || text.length === 0) {
		ide_state.showMessage('Editor clipboard is empty', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	prepareUndo('paste', false);
	deleteSelectionIfPresent();
	insertClipboardText(text);
	ide_state.showMessage('Pasted from editor clipboard', constants.COLOR_STATUS_SUCCESS, 1.5);
}

/**
 * Writes text to both the internal clipboard and the system clipboard.
 * @param text The text to write
 * @param successMessage Message to show on success
 */
export async function writeClipboard(text: string, successMessage: string): Promise<void> {
	ide_state.customClipboard = text;
	const clipboard = $.platform.clipboard;
	if (!clipboard.isSupported()) {
		const message = successMessage + ' (Editor clipboard only)';
		ide_state.showMessage(message, constants.COLOR_STATUS_SUCCESS, 1.5);
		return;
	}
	try {
		await clipboard.writeText(text);
		ide_state.showMessage(successMessage, constants.COLOR_STATUS_SUCCESS, 1.5);
	}
	catch (error) {
		ide_state.showMessage('System clipboard write failed. Editor clipboard updated.', constants.COLOR_STATUS_WARNING, 3.5);
	}
}
