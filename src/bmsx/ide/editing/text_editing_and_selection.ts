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
import { ide_state } from '../core/ide_state';
import type { EditContext, Position } from '../core/types';
import { getActiveCodeTabContext, recordEditContext } from '../browser/editor_tabs';
import { revealCursor, updateDesiredColumn } from '../browser/caret';
import { markDiagnosticsDirty } from '../contrib/problems/diagnostics';
import { currentLine, invalidateLineRange, markTextMutated } from '../core/text_utils';
import { capturePreMutationSource } from '../core/text_utils';
import { resetBlink } from '../render/render_caret';
import * as constants from '../core/constants';
import { formatLuaDocument } from '../lua/lua_formatter';
import { extractErrorMessage } from '../../lua/luavalue';
import { getTextSnapshot } from '../text/source_text';
import type { MutableTextPosition, TextBuffer } from '../text/text_buffer';
import { prepareUndo, applyUndoableReplace } from './undo_controller';
import { formatAemDocument } from '../language/aem/aem_editor';
import {
	clearSingleCursorSelection,
	collapseSingleCursorSelection,
	comparePositions,
	getSingleCursorSelectionRange,
	setSingleCursorPosition,
	setSingleCursorSelectionAnchor,
} from './cursor_state';
import { findWordBoundsInLine, findWordLeftOffset, findWordRightOffset } from './cursor_words';

const tmpPosition: MutableTextPosition = { row: 0, column: 0 };
const wordPositionScratch: MutableTextPosition = { row: 0, column: 0 };

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
	clearSingleCursorSelection(ide_state);
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
export { comparePositions };

/**
 * Gets the current selection range with normalized start/end positions.
 * @returns The selection range with start <= end, or null if no selection
 */
export function getSelectionRange(): { start: Position; end: Position } {
	return getSingleCursorSelectionRange(ide_state);
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
 * Collapses the selection to either its start or end position.
 * @param target 'start' to move cursor to selection start, 'end' for selection end
 */
export function collapseSelectionTo(target: 'start' | 'end'): void {
	if (!collapseSingleCursorSelection(ide_state, target)) {
		return;
	}
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
		clearSingleCursorSelection(ide_state);
		setSingleCursorPosition(ide_state, targetRow, 0);
		updateDesiredColumn();
		resetBlink();
		revealCursor();
		return;
	}
	const bounds = findWordBoundsInLine(line, column);
	setSingleCursorSelectionAnchor(ide_state, targetRow, bounds.start);
	setSingleCursorPosition(ide_state, targetRow, bounds.end);
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
	return ide_state.layout.clampBufferPosition(ide_state.buffer, position);
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
export function findWordLeft(row: number, column: number, out: MutableTextPosition = wordPositionScratch): Position {
	const buffer = ide_state.buffer;
	const offset = buffer.offsetAt(row, column);
	const targetOffset = findWordLeftOffset(offset, index => buffer.charCodeAt(index));
	buffer.positionAt(targetOffset, out);
	return out;
}

/**
 * Finds the end of the word to the right of the cursor.
 * @param row Current row
 * @param column Current column
 * @returns The position of the word end
 */
export function findWordRight(row: number, column: number, out: MutableTextPosition = wordPositionScratch): Position {
	const buffer = ide_state.buffer;
	const offset = buffer.offsetAt(row, column);
	const targetOffset = findWordRightOffset(buffer.length, offset, index => buffer.charCodeAt(index));
	buffer.positionAt(targetOffset, out);
	return out;
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
	ide_state.cursorRow = ide_state.layout.clampBufferRow(ide_state.buffer, deletionStartRow);
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
	const anchor = ide_state.selectionAnchor;
	if (anchor) {
		anchor.row += delta;
	}
	const cursorRow = ide_state.layout.clampBufferRow(ide_state.buffer, ide_state.cursorRow);
	ide_state.cursorRow = cursorRow;
	const cursorLine = ide_state.buffer.getLineContent(cursorRow);
	ide_state.cursorColumn = ide_state.layout.clampLineLength(cursorLine.length, ide_state.cursorColumn);
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
		ide_state.cursorRow = cursorRow;
		ide_state.cursorColumn = ide_state.layout.clampBufferColumn(buffer, cursorRow, ide_state.cursorColumn);
	} else {
		const targetRow = ide_state.layout.clampBufferRow(buffer, ide_state.cursorRow + rowOffset);
		ide_state.cursorRow = targetRow;
		ide_state.cursorColumn = ide_state.layout.clampBufferColumn(buffer, targetRow, ide_state.cursorColumn);
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
	const anchor = ide_state.selectionAnchor;
	if (anchor) {
		anchor.column += 1;
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
	const anchor = ide_state.selectionAnchor;
	if (anchor) {
		anchor.column = Math.max(0, anchor.column - 1);
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

	ide_state.cursorRow = ide_state.layout.clampBufferRow(buffer, ide_state.cursorRow);
	ide_state.cursorColumn = ide_state.layout.clampBufferColumn(buffer, ide_state.cursorRow, ide_state.cursorColumn);

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
	const context = getActiveCodeTabContext();
	try {
		const formatted = context.mode === 'lua'
			? formatLuaDocument(originalSource)
			: formatAemDocument(originalSource, context.descriptor.path);
		if (formatted === originalSource) {
			ide_state.showMessage('Document already formatted', constants.COLOR_STATUS_TEXT, 1.5);
			return;
		}
		const cursorOffset = buffer.offsetAt(ide_state.cursorRow, ide_state.cursorColumn);
		prepareUndo('format-document', false);
		recordEditContext('replace', formatted);
		applyUndoableReplace(0, buffer.length, formatted);
		const restoredOffset = ide_state.layout.clampBufferOffset(buffer, cursorOffset);
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
