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

import { $ } from '../../core/engine_core';
import { clamp } from '../../utils/clamp';
import { ide_state } from './ide_state';
import type { EditContext, Position } from './types';
import { getActiveCodeTabContext } from './editor_tabs';
import {
	revealCursor,
	clampCursorColumn,
} from './caret';
import {
	applyUndoableReplace,
	updateDesiredColumn,
	invalidateLineRange,
	recordEditContext,
	prepareUndo,
	currentLine,
} from './cart_editor';
import { markDiagnosticsDirty } from './diagnostics';
import { markTextMutated } from './text_utils';
import { capturePreMutationSource } from './text_utils';
import { resetBlink } from './render/render_caret';
import * as constants from './constants';
import { formatLuaDocument } from './lua/lua_formatter';
import { extractErrorMessage } from '../../lua/luavalue';
import { LuaLexer } from '../../lua/syntax/lualexer';
import { getTextSnapshot } from './text/source_text';
import type { MutableTextPosition, TextBuffer } from './text/text_buffer';

const tmpPosition: MutableTextPosition = { row: 0, column: 0 };

function bufferCharAtOffset(buffer: TextBuffer, offset: number): string {
	const code = buffer.charCodeAt(offset);
	return Number.isNaN(code) ? '' : String.fromCharCode(code);
}

function editorAllowsMutation(): boolean {
	return ide_state.activeContextReadOnly !== true;
}

// ============================================================================
// SELECTION STATE MANAGEMENT
// ============================================================================

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
export function getSelectionRange(): { start: Position; end: Position } {
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
export function getSelectionText(): string {
	const range = getSelectionRange();
	if (!range) {
		return null;
	}
	const buffer = ide_state.buffer;
	const start = range.start;
	const end = range.end;
	const startOffset = buffer.offsetAt(start.row, start.column);
	const endOffset = buffer.offsetAt(end.row, end.column);
	return buffer.getTextRange(startOffset, endOffset);
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
	const buffer = ide_state.buffer;
	const lineCount = buffer.getLineCount();
	let targetRow = row;
	if (targetRow < 0) {
		targetRow = 0;
	} else if (targetRow >= lineCount) {
		targetRow = lineCount - 1;
	}
	const line = buffer.getLineContent(targetRow);
	if (line.length === 0) {
		ide_state.selectionAnchor = null;
		ide_state.cursorRow = targetRow;
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
	if (LuaLexer.isIdentifierPart(current)) {
		while (start > 0 && LuaLexer.isIdentifierPart(line.charAt(start - 1))) {
			start -= 1;
		}
		while (end < line.length && LuaLexer.isIdentifierPart(line.charAt(end))) {
			end += 1;
		}
	} else if (LuaLexer.isWhitespace(current)) {
		while (start > 0 && LuaLexer.isWhitespace(line.charAt(start - 1))) {
			start -= 1;
		}
		while (end < line.length && LuaLexer.isWhitespace(line.charAt(end))) {
			end += 1;
		}
	} else {
		while (start > 0) {
			const previous = line.charAt(start - 1);
			if (LuaLexer.isIdentifierPart(previous) || LuaLexer.isWhitespace(previous)) {
				break;
			}
			start -= 1;
		}
		while (end < line.length) {
			const next = line.charAt(end);
			if (LuaLexer.isIdentifierPart(next) || LuaLexer.isWhitespace(next)) {
				break;
			}
			end += 1;
		}
	}
	if (end < start) {
		end = start;
	}
	ide_state.selectionAnchor = { row: targetRow, column: start };
	ide_state.cursorRow = targetRow;
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
export function clampSelectionPosition(position: Position): Position {
	if (!position) {
		return null;
	}
	const buffer = ide_state.buffer;
	const lineCount = buffer.getLineCount();
	let row = position.row;
	if (row < 0) {
		row = 0;
	} else if (row >= lineCount) {
		row = lineCount - 1;
	}
	const lineLength = buffer.getLineEndOffset(row) - buffer.getLineStartOffset(row);
	let column = position.column;
	if (column < 0) {
		column = 0;
	} else if (column > lineLength) {
		column = lineLength;
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
export function stepLeft(row: number, column: number): { row: number; column: number } {
	if (column > 0) {
		return { row, column: column - 1 };
	}
	if (row > 0) {
		const previousRow = row - 1;
		const buffer = ide_state.buffer;
		const length = buffer.getLineEndOffset(previousRow) - buffer.getLineStartOffset(previousRow);
		return { row: previousRow, column: length };
	}
	return null;
}

/**
 * Moves one position to the right in the document.
 * @param row Current row
 * @param column Current column
 * @returns The new position, or null if at the end of the document
 */
export function stepRight(row: number, column: number): { row: number; column: number } {
	const buffer = ide_state.buffer;
	const length = buffer.getLineEndOffset(row) - buffer.getLineStartOffset(row);
	if (column < length) {
		return { row, column: column + 1 };
	}
	if (row < buffer.getLineCount() - 1) {
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
	const buffer = ide_state.buffer;
	const lineCount = buffer.getLineCount();
	if (row < 0 || row >= lineCount) {
		return '';
	}
	const lineStart = buffer.getLineStartOffset(row);
	const lineEnd = buffer.getLineEndOffset(row);
	const length = lineEnd - lineStart;
	if (column < 0 || column >= length) {
		return '';
	}
	const offset = lineStart + column;
	return bufferCharAtOffset(buffer, offset);
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
	while (LuaLexer.isWhitespace(currentChar)) {
		const previous = stepLeft(currentRow, currentColumn);
		if (!previous) {
			return { row: 0, column: 0 };
		}
		currentRow = previous.row;
		currentColumn = previous.column;
		currentChar = charAt(currentRow, currentColumn);
	}
	const word = LuaLexer.isIdentifierPart(currentChar);
	while (true) {
		const previous = stepLeft(currentRow, currentColumn);
		if (!previous) {
			currentRow = 0;
			currentColumn = 0;
			break;
		}
		const previousChar = charAt(previous.row, previous.column);
		if (LuaLexer.isWhitespace(previousChar) || LuaLexer.isIdentifierPart(previousChar) !== word) {
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
		const buffer = ide_state.buffer;
		const lastRow = buffer.getLineCount() - 1;
		const length = buffer.getLineEndOffset(lastRow) - buffer.getLineStartOffset(lastRow);
		return { row: lastRow, column: length };
	}
	currentRow = step.row;
	currentColumn = step.column;
	let currentChar = charAt(currentRow, currentColumn);
	while (LuaLexer.isWhitespace(currentChar)) {
		const next = stepRight(currentRow, currentColumn);
		if (!next) {
			const buffer = ide_state.buffer;
			const lastRow = buffer.getLineCount() - 1;
			const length = buffer.getLineEndOffset(lastRow) - buffer.getLineStartOffset(lastRow);
			return { row: lastRow, column: length };
		}
		currentRow = next.row;
		currentColumn = next.column;
		currentChar = charAt(currentRow, currentColumn);
	}
	const word = LuaLexer.isIdentifierPart(currentChar);
	while (true) {
		const next = stepRight(currentRow, currentColumn);
		if (!next) {
			const buffer = ide_state.buffer;
			const lastRow = buffer.getLineCount() - 1;
			currentRow = lastRow;
			currentColumn = buffer.getLineEndOffset(lastRow) - buffer.getLineStartOffset(lastRow);
			break;
		}
		const nextChar = charAt(next.row, next.column);
		if (LuaLexer.isWhitespace(nextChar) || LuaLexer.isIdentifierPart(nextChar) !== word) {
			currentRow = next.row;
			currentColumn = next.column;
			break;
		}
		currentRow = next.row;
		currentColumn = next.column;
	}
	while (LuaLexer.isWhitespace(charAt(currentRow, currentColumn))) {
		const next = stepRight(currentRow, currentColumn);
		if (!next) {
			const buffer = ide_state.buffer;
			const lastRow = buffer.getLineCount() - 1;
			currentRow = lastRow;
			currentColumn = buffer.getLineEndOffset(lastRow) - buffer.getLineStartOffset(lastRow);
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
	if (!editorAllowsMutation() || !hasSelection()) {
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
	if (!editorAllowsMutation()) {
		return;
	}
	capturePreMutationSource();
	const range = getSelectionRange();
	if (!range) {
		return;
	}

	const buffer = ide_state.buffer;
	const start = range.start;
	const end = range.end;
	const startOffset = buffer.offsetAt(start.row, start.column);
	const endOffset = buffer.offsetAt(end.row, end.column);
	applyUndoableReplace(startOffset, endOffset - startOffset, text);

	const newOffset = startOffset + text.length;
	buffer.positionAt(newOffset, tmpPosition);
	ide_state.cursorRow = tmpPosition.row;
	ide_state.cursorColumn = tmpPosition.column;

	recordEditContext(text.length === 0 ? 'delete' : 'replace', text);
	invalidateLineRange(start.row, tmpPosition.row);
	ide_state.layout.invalidateHighlightsFromRow(start.row);
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
	if (!editorAllowsMutation() || text.length === 0) {
		return;
	}
	const coalesce = text.length === 1;
	prepareUndo('insert-text', coalesce);
	deleteSelectionIfPresent();
	const buffer = ide_state.buffer;
	const startRow = ide_state.cursorRow;
	const offset = buffer.offsetAt(startRow, ide_state.cursorColumn);
	applyUndoableReplace(offset, 0, text);
	const newOffset = offset + text.length;
	buffer.positionAt(newOffset, tmpPosition);
	ide_state.cursorRow = tmpPosition.row;
	ide_state.cursorColumn = tmpPosition.column;
	invalidateLineRange(startRow, tmpPosition.row);
	recordEditContext('insert', text);
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
	if (!editorAllowsMutation()) {
		return;
	}
	prepareUndo('insert-line-break', false);
	deleteSelectionIfPresent();
	const buffer = ide_state.buffer;
	const sourceRow = ide_state.cursorRow;
	const sourceColumn = ide_state.cursorColumn;
	const line = currentLine();
	const before = line.slice(0, sourceColumn);
	const indentation = extractIndentation(before);
	const insertion = `\n${indentation}`;
	const offset = buffer.offsetAt(sourceRow, sourceColumn);
	applyUndoableReplace(offset, 0, insertion);
	const newOffset = offset + insertion.length;
	buffer.positionAt(newOffset, tmpPosition);
	ide_state.cursorRow = tmpPosition.row;
	ide_state.cursorColumn = tmpPosition.column;

	invalidateLineRange(sourceRow, tmpPosition.row);
	ide_state.layout.invalidateHighlightsFromRow(sourceRow);
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
	if (!editorAllowsMutation()) {
		return;
	}
	const buffer = ide_state.buffer;
	const startRow = ide_state.cursorRow;
	const offset = buffer.offsetAt(startRow, ide_state.cursorColumn);
	applyUndoableReplace(offset, 0, text);
	const newOffset = offset + text.length;
	buffer.positionAt(newOffset, tmpPosition);
	ide_state.cursorRow = tmpPosition.row;
	ide_state.cursorColumn = tmpPosition.column;

	invalidateLineRange(startRow, tmpPosition.row);
	ide_state.layout.invalidateHighlightsFromRow(startRow);
	recordEditContext('insert', text);
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
	if (!editorAllowsMutation()) {
		return;
	}
	const buffer = ide_state.buffer;
	const cursorOffset = buffer.offsetAt(ide_state.cursorRow, ide_state.cursorColumn);
	if (!hasSelection() && cursorOffset === 0) {
		return;
	}
	prepareUndo('backspace', true);
	if (deleteSelectionIfPresent()) {
		return;
	}

	const deleteOffset = cursorOffset - 1;
	const removed = buffer.getTextRange(deleteOffset, cursorOffset);
	applyUndoableReplace(deleteOffset, 1, '');
	buffer.positionAt(deleteOffset, tmpPosition);
	ide_state.cursorRow = tmpPosition.row;
	ide_state.cursorColumn = tmpPosition.column;
	invalidateLineRange(tmpPosition.row, tmpPosition.row + 1);
	ide_state.layout.invalidateHighlightsFromRow(tmpPosition.row);
	recordEditContext('delete', removed);
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
	if (!editorAllowsMutation()) {
		return;
	}
	const buffer = ide_state.buffer;
	const cursorOffset = buffer.offsetAt(ide_state.cursorRow, ide_state.cursorColumn);
	if (!hasSelection() && cursorOffset >= buffer.length) {
		return;
	}
	prepareUndo('delete-forward', true);
	if (deleteSelectionIfPresent()) {
		return;
	}

	const removed = buffer.getTextRange(cursorOffset, cursorOffset + 1);
	applyUndoableReplace(cursorOffset, 1, '');
	buffer.positionAt(cursorOffset, tmpPosition);
	ide_state.cursorRow = tmpPosition.row;
	ide_state.cursorColumn = tmpPosition.column;
	invalidateLineRange(tmpPosition.row, tmpPosition.row + 1);
	ide_state.layout.invalidateHighlightsFromRow(tmpPosition.row);
	recordEditContext('delete', removed);
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

/**
 * Deletes from the cursor to the start of the previous word.
 */
export function deleteWordBackward(): void {
	if (!editorAllowsMutation()) {
		return;
	}
	const buffer = ide_state.buffer;
	const cursorOffset = buffer.offsetAt(ide_state.cursorRow, ide_state.cursorColumn);
	if (!hasSelection() && cursorOffset === 0) {
		return;
	}
	prepareUndo('delete-word-backward', false);
	if (deleteSelectionIfPresent()) {
		return;
	}
	const target = findWordLeft(ide_state.cursorRow, ide_state.cursorColumn);
	const targetOffset = buffer.offsetAt(target.row, target.column);
	if (targetOffset === cursorOffset) {
		backspace();
		return;
	}

	const removed = buffer.getTextRange(targetOffset, cursorOffset);
	applyUndoableReplace(targetOffset, cursorOffset - targetOffset, '');
	buffer.positionAt(targetOffset, tmpPosition);
	ide_state.cursorRow = tmpPosition.row;
	ide_state.cursorColumn = tmpPosition.column;
	invalidateLineRange(tmpPosition.row, tmpPosition.row + 1);
	ide_state.layout.invalidateHighlightsFromRow(tmpPosition.row);
	recordEditContext('delete', removed);
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

/**
 * Deletes from the cursor to the end of the next word.
 */
export function deleteWordForward(): void {
	if (!editorAllowsMutation()) {
		return;
	}
	const buffer = ide_state.buffer;
	const cursorOffset = buffer.offsetAt(ide_state.cursorRow, ide_state.cursorColumn);
	if (!hasSelection() && cursorOffset >= buffer.length) {
		return;
	}
	prepareUndo('delete-word-forward', false);
	if (deleteSelectionIfPresent()) {
		return;
	}
	const destination = findWordRight(ide_state.cursorRow, ide_state.cursorColumn);
	const destinationOffset = buffer.offsetAt(destination.row, destination.column);
	if (destinationOffset === cursorOffset) {
		deleteForward();
		return;
	}

	const removed = buffer.getTextRange(cursorOffset, destinationOffset);
	applyUndoableReplace(cursorOffset, destinationOffset - cursorOffset, '');
	buffer.positionAt(cursorOffset, tmpPosition);
	ide_state.cursorRow = tmpPosition.row;
	ide_state.cursorColumn = tmpPosition.column;
	invalidateLineRange(tmpPosition.row, tmpPosition.row + 1);
	ide_state.layout.invalidateHighlightsFromRow(tmpPosition.row);
	recordEditContext('delete', removed);
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
	if (!editorAllowsMutation()) {
		return;
	}

	const buffer = ide_state.buffer;
	const lineCount = buffer.getLineCount();
	const range = getSelectionRange();

	let deletionStartRow = ide_state.cursorRow;
	let deletionEndRow = ide_state.cursorRow;
	let recordText = '\n';
	if (range) {
		deletionStartRow = range.start.row;
		deletionEndRow = range.end.row;
		if (range.end.column === 0 && range.end.row > range.start.row) {
			deletionEndRow -= 1;
		}
		const deletedLines: string[] = [];
		for (let row = deletionStartRow; row <= deletionEndRow; row += 1) {
			deletedLines.push(buffer.getLineContent(row));
		}
		recordText = deletedLines.join('\n');
	}

	let startOffset = 0;
	let endOffset = 0;
	if (deletionStartRow === 0) {
		startOffset = 0;
		if (deletionEndRow + 1 < lineCount) {
			endOffset = buffer.getLineStartOffset(deletionEndRow + 1);
		} else {
			endOffset = buffer.length;
		}
	} else if (deletionEndRow + 1 < lineCount) {
		startOffset = buffer.getLineStartOffset(deletionStartRow);
		endOffset = buffer.getLineStartOffset(deletionEndRow + 1);
	} else {
		startOffset = buffer.getLineEndOffset(deletionStartRow - 1);
		endOffset = buffer.length;
	}

	const deleteLength = endOffset - startOffset;
	if (deleteLength === 0) {
		return;
	}

	prepareUndo('delete-active-lines', false);
	applyUndoableReplace(startOffset, deleteLength, '');
	const nextLineCount = buffer.getLineCount();
	ide_state.cursorRow = clamp(deletionStartRow, 0, nextLineCount - 1);
	ide_state.cursorColumn = 0;
	ide_state.selectionAnchor = null;
	ide_state.layout.invalidateLine(ide_state.cursorRow);
	ide_state.layout.invalidateHighlightsFromRow(deletionStartRow);
	recordEditContext('delete', recordText);
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
	if (!editorAllowsMutation()) {
		return;
	}
	if (delta === 0) {
		return;
	}
	const buffer = ide_state.buffer;
	const lineCount = buffer.getLineCount();
	const range = getLineRangeForMovement();
	if (delta < 0 && range.startRow === 0) {
		return;
	}
	if (delta > 0 && range.endRow >= lineCount - 1) {
		return;
	}

	const regionStartRow = delta < 0 ? range.startRow - 1 : range.startRow;
	const regionEndRow = delta < 0 ? range.endRow : range.endRow + 1;
	const regionStartOffset = buffer.getLineStartOffset(regionStartRow);
	const regionEndOffset = regionEndRow < lineCount - 1
		? buffer.getLineStartOffset(regionEndRow + 1)
		: buffer.length;
	const endsWithNewline = regionEndRow < lineCount - 1;
	const regionLines: string[] = [];
	for (let row = regionStartRow; row <= regionEndRow; row += 1) {
		regionLines.push(buffer.getLineContent(row));
	}
	const replacementLines: string[] = [];
	if (delta < 0) {
		for (let index = 1; index < regionLines.length; index += 1) {
			replacementLines.push(regionLines[index]);
		}
		replacementLines.push(regionLines[0]);
	} else {
		replacementLines.push(regionLines[regionLines.length - 1]);
		for (let index = 0; index < regionLines.length - 1; index += 1) {
			replacementLines.push(regionLines[index]);
		}
	}
	let replacementText = replacementLines.join('\n');
	if (endsWithNewline) {
		replacementText += '\n';
	}

	prepareUndo('move-lines', false);
	applyUndoableReplace(regionStartOffset, regionEndOffset - regionStartOffset, replacementText);
	invalidateLineRange(regionStartRow, regionEndRow);
	ide_state.layout.invalidateHighlightsFromRow(regionStartRow);
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

/**
 * Copies the current line or selected lines above/below without moving the originals.
 * @param delta Negative to copy upward, positive to copy downward.
 */
export function copySelectionLines(delta: number): void {
	if (!editorAllowsMutation()) {
		return;
	}
	if (delta === 0) {
		return;
	}
	const buffer = ide_state.buffer;
	const lineCount = buffer.getLineCount();
	const lineRange = getLineRangeForMovement();
	const insertionStart = delta < 0 ? lineRange.startRow : lineRange.endRow + 1;
	const rowOffset = insertionStart - lineRange.startRow;
	const blockLines: string[] = [];
	for (let row = lineRange.startRow; row <= lineRange.endRow; row += 1) {
		blockLines.push(buffer.getLineContent(row));
	}
	let insertionText = blockLines.join('\n');
	if (insertionStart === lineCount && buffer.length > 0) {
		insertionText = `\n${insertionText}`;
	}
	if (insertionStart < lineCount) {
		insertionText += '\n';
	}
	const insertionOffset = insertionStart < lineCount ? buffer.getLineStartOffset(insertionStart) : buffer.length;

	prepareUndo('copy-lines', false);
	applyUndoableReplace(insertionOffset, 0, insertionText);
	invalidateLineRange(insertionStart, insertionStart + blockLines.length - 1);
	ide_state.layout.invalidateHighlightsFromRow(insertionStart);

	const anchor = ide_state.selectionAnchor;
	if (anchor && (anchor.row !== ide_state.cursorRow || anchor.column !== ide_state.cursorColumn)) {
		const cursorRow = ide_state.cursorRow + rowOffset;
		anchor.row += rowOffset;
		ide_state.cursorRow = cursorRow;
		ide_state.cursorColumn = clamp(ide_state.cursorColumn, 0, buffer.getLineEndOffset(cursorRow) - buffer.getLineStartOffset(cursorRow));
	} else {
		const targetRow = clamp(ide_state.cursorRow + rowOffset, 0, buffer.getLineCount() - 1);
		ide_state.cursorRow = targetRow;
		ide_state.cursorColumn = clamp(ide_state.cursorColumn, 0, buffer.getLineEndOffset(targetRow) - buffer.getLineStartOffset(targetRow));
		ide_state.selectionAnchor = null;
	}
	recordEditContext('insert', blockLines.join('\n'));
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
	if (!editorAllowsMutation()) {
		return;
	}
	const buffer = ide_state.buffer;
	prepareUndo('indent', false);
	const range = getSelectionRange();
	if (!range) {
		const row = ide_state.cursorRow;
		const offset = buffer.getLineStartOffset(row);
		applyUndoableReplace(offset, 0, '\t');
		ide_state.cursorColumn += 1;
		ide_state.layout.invalidateLine(ide_state.cursorRow);
		recordEditContext('insert', '\t');
		markTextMutated();
		resetBlink();
		updateDesiredColumn();
		revealCursor();
		return;
	}
	for (let row = range.end.row; row >= range.start.row; row -= 1) {
		const offset = buffer.getLineStartOffset(row);
		applyUndoableReplace(offset, 0, '\t');
		ide_state.layout.invalidateLine(row);
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
	if (!editorAllowsMutation()) {
		return;
	}
	const buffer = ide_state.buffer;
	prepareUndo('unindent', false);
	const range = getSelectionRange();
	if (!range) {
		const row = ide_state.cursorRow;
		const line = currentLine();
		if (line.length === 0) {
			return;
		}
		const first = line.charAt(0);
		if (first !== '\t' && first !== ' ') {
			return;
		}
		const offset = buffer.getLineStartOffset(row);
		applyUndoableReplace(offset, 1, '');
		ide_state.cursorColumn = Math.max(0, ide_state.cursorColumn - 1);
		ide_state.layout.invalidateLine(ide_state.cursorRow);
		recordEditContext('delete', first);
		markTextMutated();
		resetBlink();
		updateDesiredColumn();
		revealCursor();
		return;
	}
	for (let row = range.end.row; row >= range.start.row; row -= 1) {
		const line = buffer.getLineContent(row);
		if (line.length === 0) {
			continue;
		}
		const first = line.charAt(0);
		if (first !== '\t' && first !== ' ') {
			continue;
		}
		const offset = buffer.getLineStartOffset(row);
		applyUndoableReplace(offset, 1, '');
		ide_state.layout.invalidateLine(row);
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
	if (!editorAllowsMutation()) {
		await writeClipboard(text, 'Copied selection to clipboard');
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
	const buffer = ide_state.buffer;
	const lineCount = buffer.getLineCount();
	const row = ide_state.cursorRow;
	const currentLineValue = currentLine();
	const isLastLine = row >= lineCount - 1;
	const text = isLastLine ? currentLineValue : `${currentLineValue}\n`;
	prepareUndo('cut-line', false);
	await writeClipboard(text, 'Cut line to clipboard');
	if (!editorAllowsMutation()) {
		return;
	}

	const lineStart = buffer.getLineStartOffset(row);
	const lineEnd = buffer.getLineEndOffset(row);
	let deleteStart = lineStart;
	let deleteEnd = lineEnd;
	if (lineCount > 1) {
		if (!isLastLine) {
			deleteStart = lineStart;
			deleteEnd = buffer.getLineStartOffset(row + 1);
		} else {
			deleteStart = buffer.getLineEndOffset(row - 1);
			deleteEnd = buffer.length;
		}
	}
	const deleteLength = deleteEnd - deleteStart;
	if (deleteLength > 0) {
		applyUndoableReplace(deleteStart, deleteLength, '');
	}

	const nextLineCount = buffer.getLineCount();
	if (ide_state.cursorRow >= nextLineCount) {
		ide_state.cursorRow = nextLineCount - 1;
	}
	const currentLength = buffer.getLineEndOffset(ide_state.cursorRow) - buffer.getLineStartOffset(ide_state.cursorRow);
	if (ide_state.cursorColumn > currentLength) {
		ide_state.cursorColumn = currentLength;
	}

	const removedRow = row;
	ide_state.layout.invalidateHighlightsFromRow(Math.min(removedRow, buffer.getLineCount() - 1));
	ide_state.layout.invalidateLine(ide_state.cursorRow);
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
	if (!editorAllowsMutation()) {
		ide_state.showMessage('Tab is read-only', constants.COLOR_STATUS_WARNING, 1.5);
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

export function applyDocumentFormatting(): void {
	const buffer = ide_state.buffer;
	const originalSource = getTextSnapshot(buffer);
	try {
		const formatted = formatLuaDocument(originalSource);
		if (formatted === originalSource) {
			ide_state.showMessage('Document already formatted', constants.COLOR_STATUS_TEXT, 1.5);
			return;
		}
		const cursorOffset = buffer.offsetAt(ide_state.cursorRow, ide_state.cursorColumn);
		prepareUndo('format-document', false);
		recordEditContext('replace', formatted);
		applyUndoableReplace(0, buffer.length, formatted);
		const restoredOffset = clamp(cursorOffset, 0, buffer.length);
		buffer.positionAt(restoredOffset, tmpPosition);
		ide_state.cursorRow = tmpPosition.row;
		ide_state.cursorColumn = tmpPosition.column;
		ide_state.selectionAnchor = null;
		updateDesiredColumn();
		resetBlink();
		revealCursor();
		markDiagnosticsDirty(getActiveCodeTabContext().id);
		markTextMutated();
		ide_state.showMessage('Document formatted', constants.COLOR_STATUS_SUCCESS, 1.6);
	} catch (error) {
		const message = extractErrorMessage(error);
		ide_state.showMessage(`Formatting failed: ${message}`, constants.COLOR_STATUS_ERROR, 3.2);
	}
}
export function handlePostEditMutation(): void {
	const editContext = ide_state.pendingEditContext;
	ide_state.pendingEditContext = null;
	ide_state.completion.updateAfterEdit(editContext);
}
export function computeEditContextFromSources(previous: string, next: string): EditContext {
	if (previous === next) {
		return null;
	}
	let start = 0;
	while (start < previous.length && start < next.length && previous.charAt(start) === next.charAt(start)) {
		start += 1;
	}
	let endPrev = previous.length;
	let endNext = next.length;
	while (endPrev > start && endNext > start && previous.charAt(endPrev - 1) === next.charAt(endNext - 1)) {
		endPrev -= 1;
		endNext -= 1;
	}
	if (next.length >= previous.length) {
		const inserted = next.slice(start, endNext);
		return inserted.length > 0 ? { kind: 'insert', text: inserted } : null;
	}
	const deleted = previous.slice(start, endPrev);
	return deleted.length > 0 ? { kind: 'delete', text: deleted } : null;
}
