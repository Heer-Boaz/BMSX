/**
 * Comprehensive text editing and selection module for the runtime cart editor.
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

import { showEditorMessage } from '../../common/feedback_state';
import type { EditContext, Position } from '../../common/models';
import { revealCursor, updateDesiredColumn } from '../ui/view/caret/caret';
import { currentLine } from '../common/text/layout';
import { invalidateLineRange, markTextMutated } from '../common/text/runtime';
import { resetBlink } from '../render/caret';
import * as constants from '../../common/constants';
import { formatLuaDocument } from '../../language/lua/formatter';
import { extractErrorMessage } from '../../language/lua/interpreter/value';
import { getLinesSnapshot, getTextSnapshot } from '../text/source_text';
import type { MutableTextPosition, TextBuffer } from '../text/text_buffer';
import { prepareUndo, applyUndoableReplace, recordEditContext } from './undo_controller';
import { formatAemDocument } from '../../language/aem/editor';
import { activeCodeEditor } from '../ui/code_editor_state';
import { editorViewState } from '../ui/view/state';
import {
	clearSingleCursorSelection,
	collapseSingleCursorSelection,
	comparePositions,
	getSingleCursorSelectionRange,
	setSingleCursorPosition,
	setSingleCursorSelectionAnchor,
} from './cursor/state';
import { findWordBoundsInLine, findWordLeftOffset, findWordRightOffset } from './cursor/words';
import type { Clipboard } from '../../common/clipboard';

const tmpPosition: MutableTextPosition = { row: 0, column: 0 };
const wordPositionScratch: MutableTextPosition = { row: 0, column: 0 };

function bufferCharAtOffset(buffer: TextBuffer, offset: number): string {
	const code = buffer.charCodeAt(offset);
	return Number.isNaN(code) ? '' : String.fromCharCode(code);
}

function editorAllowsMutation(): boolean {
	return !activeCodeEditor.model.readOnly;
}

// ============================================================================
// SELECTION STATE MANAGEMENT
// ============================================================================

/**
 * Clears the current selection by removing the anchor.
 */
export function clearSelection(): void {
	clearSingleCursorSelection(activeCodeEditor.view);
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
	return getSingleCursorSelectionRange(activeCodeEditor.view);
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
	const buffer = activeCodeEditor.model.buffer;
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
	if (!collapseSingleCursorSelection(activeCodeEditor.view, target)) {
		return;
	}
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	activeCodeEditor.emitCursorMoved();
}

/**
 * Selects the word at the specified position.
 * Word boundaries are determined by character type (word chars, whitespace, or symbols).
 * @param row The row containing the word
 * @param column The column within the word
 */
export function selectWordAtPosition(row: number, column: number): void {
	const buffer = activeCodeEditor.model.buffer;
	const lineCount = buffer.getLineCount();
	let targetRow = row;
	if (targetRow < 0) {
		targetRow = 0;
	} else if (targetRow >= lineCount) {
		targetRow = lineCount - 1;
	}
	const line = buffer.getLineContent(targetRow);
	if (line.length === 0) {
		clearSingleCursorSelection(activeCodeEditor.view);
		setSingleCursorPosition(activeCodeEditor.view, targetRow, 0);
		updateDesiredColumn();
		resetBlink();
		revealCursor();
		activeCodeEditor.emitCursorMoved();
		return;
	}
	const bounds = findWordBoundsInLine(line, column);
	setSingleCursorSelectionAnchor(activeCodeEditor.view, targetRow, bounds.start);
	setSingleCursorPosition(activeCodeEditor.view, targetRow, bounds.end);
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	activeCodeEditor.emitCursorMoved();
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
	return editorViewState.layout.clampBufferPosition(activeCodeEditor.model.buffer, position);
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
	const buffer = activeCodeEditor.model.buffer;
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
	const buffer = activeCodeEditor.model.buffer;
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
	const buffer = activeCodeEditor.model.buffer;
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
function deleteSelectionIfPresent(): boolean {
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
	const range = getSelectionRange();
	if (!range) {
		return;
	}

	const buffer = activeCodeEditor.model.buffer;
	const start = range.start;
	const end = range.end;
	const startOffset = buffer.offsetAt(start.row, start.column);
	const endOffset = buffer.offsetAt(end.row, end.column);
	applyUndoableReplace(startOffset, endOffset - startOffset, text);

	const newOffset = startOffset + text.length;
	buffer.positionAt(newOffset, tmpPosition);
	activeCodeEditor.view.cursorRow = tmpPosition.row;
	activeCodeEditor.view.cursorColumn = tmpPosition.column;

	recordEditContext(text.length === 0 ? 'delete' : 'replace', text);
	invalidateLineRange(start.row, tmpPosition.row);
	editorViewState.layout.invalidateHighlightsFromRow(start.row);
	activeCodeEditor.view.selectionAnchor = null;
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
	if (hasSelection()) {
		replaceSelectionWith(text);
		return;
	}
	const buffer = activeCodeEditor.model.buffer;
	const startRow = activeCodeEditor.view.cursorRow;
	const offset = buffer.offsetAt(startRow, activeCodeEditor.view.cursorColumn);
	applyUndoableReplace(offset, 0, text);
	const newOffset = offset + text.length;
	buffer.positionAt(newOffset, tmpPosition);
	activeCodeEditor.view.cursorRow = tmpPosition.row;
	activeCodeEditor.view.cursorColumn = tmpPosition.column;
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
	const buffer = activeCodeEditor.model.buffer;
	const range = getSelectionRange();
	const sourceRow = range === null ? activeCodeEditor.view.cursorRow : range.start.row;
	const sourceColumn = range === null ? activeCodeEditor.view.cursorColumn : range.start.column;
	const line = buffer.getLineContent(sourceRow);
	const before = line.slice(0, sourceColumn);
	const indentation = extractIndentation(before);
	const insertion = `\n${indentation}`;
	prepareUndo('insert-line-break', false);
	if (range !== null) {
		replaceSelectionWith(insertion);
		return;
	}
	const offset = buffer.offsetAt(sourceRow, sourceColumn);
	applyUndoableReplace(offset, 0, insertion);
	const newOffset = offset + insertion.length;
	buffer.positionAt(newOffset, tmpPosition);
	activeCodeEditor.view.cursorRow = tmpPosition.row;
	activeCodeEditor.view.cursorColumn = tmpPosition.column;

	invalidateLineRange(sourceRow, tmpPosition.row);
	editorViewState.layout.invalidateHighlightsFromRow(sourceRow);
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
	const buffer = activeCodeEditor.model.buffer;
	const startRow = activeCodeEditor.view.cursorRow;
	const offset = buffer.offsetAt(startRow, activeCodeEditor.view.cursorColumn);
	applyUndoableReplace(offset, 0, text);
	const newOffset = offset + text.length;
	buffer.positionAt(newOffset, tmpPosition);
	activeCodeEditor.view.cursorRow = tmpPosition.row;
	activeCodeEditor.view.cursorColumn = tmpPosition.column;

	invalidateLineRange(startRow, tmpPosition.row);
	editorViewState.layout.invalidateHighlightsFromRow(startRow);
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
	const buffer = activeCodeEditor.model.buffer;
	const cursorOffset = buffer.offsetAt(activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
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
	activeCodeEditor.view.cursorRow = tmpPosition.row;
	activeCodeEditor.view.cursorColumn = tmpPosition.column;
	invalidateLineRange(tmpPosition.row, tmpPosition.row + 1);
	editorViewState.layout.invalidateHighlightsFromRow(tmpPosition.row);
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
	const buffer = activeCodeEditor.model.buffer;
	const cursorOffset = buffer.offsetAt(activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
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
	activeCodeEditor.view.cursorRow = tmpPosition.row;
	activeCodeEditor.view.cursorColumn = tmpPosition.column;
	invalidateLineRange(tmpPosition.row, tmpPosition.row + 1);
	editorViewState.layout.invalidateHighlightsFromRow(tmpPosition.row);
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
	const buffer = activeCodeEditor.model.buffer;
	const cursorOffset = buffer.offsetAt(activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
	if (!hasSelection() && cursorOffset === 0) {
		return;
	}
	if (hasSelection()) {
		prepareUndo('delete-word-backward', false);
		deleteSelectionIfPresent();
		return;
	}
	const target = findWordLeft(activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
	const targetOffset = buffer.offsetAt(target.row, target.column);
	if (targetOffset === cursorOffset) {
		backspace();
		return;
	}

	prepareUndo('delete-word-backward', false);
	const removed = buffer.getTextRange(targetOffset, cursorOffset);
	applyUndoableReplace(targetOffset, cursorOffset - targetOffset, '');
	buffer.positionAt(targetOffset, tmpPosition);
	activeCodeEditor.view.cursorRow = tmpPosition.row;
	activeCodeEditor.view.cursorColumn = tmpPosition.column;
	invalidateLineRange(tmpPosition.row, tmpPosition.row + 1);
	editorViewState.layout.invalidateHighlightsFromRow(tmpPosition.row);
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
	const buffer = activeCodeEditor.model.buffer;
	const cursorOffset = buffer.offsetAt(activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
	if (!hasSelection() && cursorOffset >= buffer.length) {
		return;
	}
	if (hasSelection()) {
		prepareUndo('delete-word-forward', false);
		deleteSelectionIfPresent();
		return;
	}
	const destination = findWordRight(activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
	const destinationOffset = buffer.offsetAt(destination.row, destination.column);
	if (destinationOffset === cursorOffset) {
		deleteForward();
		return;
	}

	prepareUndo('delete-word-forward', false);
	const removed = buffer.getTextRange(cursorOffset, destinationOffset);
	applyUndoableReplace(cursorOffset, destinationOffset - cursorOffset, '');
	buffer.positionAt(cursorOffset, tmpPosition);
	activeCodeEditor.view.cursorRow = tmpPosition.row;
	activeCodeEditor.view.cursorColumn = tmpPosition.column;
	invalidateLineRange(tmpPosition.row, tmpPosition.row + 1);
	editorViewState.layout.invalidateHighlightsFromRow(tmpPosition.row);
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

	const buffer = activeCodeEditor.model.buffer;
	const lineCount = buffer.getLineCount();
	const range = getSelectionRange();

	let deletionStartRow = activeCodeEditor.view.cursorRow;
	let deletionEndRow = activeCodeEditor.view.cursorRow;
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
	activeCodeEditor.view.cursorRow = editorViewState.layout.clampBufferRow(activeCodeEditor.model.buffer, deletionStartRow);
	activeCodeEditor.view.cursorColumn = 0;
	activeCodeEditor.view.selectionAnchor = null;
	editorViewState.layout.invalidateLine(activeCodeEditor.view.cursorRow);
	editorViewState.layout.invalidateHighlightsFromRow(deletionStartRow);
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
		return { startRow: activeCodeEditor.view.cursorRow, endRow: activeCodeEditor.view.cursorRow };
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
	const buffer = activeCodeEditor.model.buffer;
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
	editorViewState.layout.invalidateHighlightsFromRow(regionStartRow);
	activeCodeEditor.view.cursorRow += delta;
	const anchor = activeCodeEditor.view.selectionAnchor;
	if (anchor) {
		anchor.row += delta;
	}
	const cursorRow = editorViewState.layout.clampBufferRow(activeCodeEditor.model.buffer, activeCodeEditor.view.cursorRow);
	activeCodeEditor.view.cursorRow = cursorRow;
	const cursorLine = activeCodeEditor.model.buffer.getLineContent(cursorRow);
	activeCodeEditor.view.cursorColumn = editorViewState.layout.clampLineLength(cursorLine.length, activeCodeEditor.view.cursorColumn);
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
	const buffer = activeCodeEditor.model.buffer;
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
	editorViewState.layout.invalidateHighlightsFromRow(insertionStart);

	const anchor = activeCodeEditor.view.selectionAnchor;
	if (anchor && (anchor.row !== activeCodeEditor.view.cursorRow || anchor.column !== activeCodeEditor.view.cursorColumn)) {
			const cursorRow = activeCodeEditor.view.cursorRow + rowOffset;
			anchor.row += rowOffset;
			activeCodeEditor.view.cursorRow = cursorRow;
			activeCodeEditor.view.cursorColumn = editorViewState.layout.clampBufferColumn(buffer, cursorRow, activeCodeEditor.view.cursorColumn);
	} else {
		const targetRow = editorViewState.layout.clampBufferRow(buffer, activeCodeEditor.view.cursorRow + rowOffset);
		activeCodeEditor.view.cursorRow = targetRow;
		activeCodeEditor.view.cursorColumn = editorViewState.layout.clampBufferColumn(buffer, targetRow, activeCodeEditor.view.cursorColumn);
		activeCodeEditor.view.selectionAnchor = null;
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
	const buffer = activeCodeEditor.model.buffer;
	prepareUndo('indent', false);
	const range = getSelectionRange();
	if (!range) {
		const row = activeCodeEditor.view.cursorRow;
		const offset = buffer.getLineStartOffset(row);
		applyUndoableReplace(offset, 0, '\t');
		activeCodeEditor.view.cursorColumn += 1;
		editorViewState.layout.invalidateLine(activeCodeEditor.view.cursorRow);
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
		editorViewState.layout.invalidateLine(row);
	}
	const anchor = activeCodeEditor.view.selectionAnchor;
	if (anchor) {
		anchor.column += 1;
	}
	activeCodeEditor.view.cursorColumn += 1;
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
	const buffer = activeCodeEditor.model.buffer;
	const range = getSelectionRange();
	if (!range) {
		const row = activeCodeEditor.view.cursorRow;
		const line = currentLine();
		if (line.length === 0) {
			return;
		}
		const first = line.charAt(0);
		if (first !== '\t' && first !== ' ') {
			return;
		}
		prepareUndo('unindent', false);
		const offset = buffer.getLineStartOffset(row);
		applyUndoableReplace(offset, 1, '');
		activeCodeEditor.view.cursorColumn = Math.max(0, activeCodeEditor.view.cursorColumn - 1);
		editorViewState.layout.invalidateLine(activeCodeEditor.view.cursorRow);
		recordEditContext('delete', first);
		markTextMutated();
		resetBlink();
		updateDesiredColumn();
		revealCursor();
		return;
	}
	let changed = false;
	for (let row = range.end.row; row >= range.start.row; row -= 1) {
		const line = buffer.getLineContent(row);
		if (line.length === 0) {
			continue;
		}
		const first = line.charAt(0);
		if (first !== '\t' && first !== ' ') {
			continue;
		}
		if (!changed) {
			prepareUndo('unindent', false);
			changed = true;
		}
		const offset = buffer.getLineStartOffset(row);
		applyUndoableReplace(offset, 1, '');
		editorViewState.layout.invalidateLine(row);
	}
	if (!changed) {
		return;
	}
	const anchor = activeCodeEditor.view.selectionAnchor;
	if (anchor) {
		anchor.column = Math.max(0, anchor.column - 1);
	}
	activeCodeEditor.view.cursorColumn = Math.max(0, activeCodeEditor.view.cursorColumn - 1);
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
export async function copySelectionToClipboard(clipboard: Clipboard): Promise<void> {
	const text = getSelectionText();
	if (text === null) {
		showEditorMessage('Nothing selected to copy', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	await writeClipboard(clipboard, text, 'Copied selection to clipboard');
}

/**
 * Cuts the current selection to the clipboard (copy + delete).
 * Shows a message if nothing is selected.
 */
export async function cutSelectionToClipboard(clipboard: Clipboard): Promise<void> {
	const text = getSelectionText();
	if (text === null) {
		showEditorMessage('Nothing selected to cut', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	if (!editorAllowsMutation()) {
		await writeClipboard(clipboard, text, 'Copied selection to clipboard');
		return;
	}
	const write = writeClipboard(clipboard, text, 'Cut selection to clipboard');
	prepareUndo('cut', false);
	replaceSelectionWith('');
	await write;
}

/**
 * Cuts the current line to the clipboard.
 * Used when no selection is active.
 */
export async function cutLineToClipboard(clipboard: Clipboard): Promise<void> {
	const buffer = activeCodeEditor.model.buffer;
	const lineCount = buffer.getLineCount();
	const row = activeCodeEditor.view.cursorRow;
	const currentLineValue = currentLine();
	const isLastLine = row >= lineCount - 1;
	const text = isLastLine ? currentLineValue : `${currentLineValue}\n`;
	if (!editorAllowsMutation()) {
		await writeClipboard(clipboard, text, 'Copied line to clipboard');
		return;
	}
	const write = writeClipboard(clipboard, text, 'Cut line to clipboard');

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
	if (deleteLength === 0) {
		await write;
		return;
	}
	prepareUndo('cut-line', false);
	applyUndoableReplace(deleteStart, deleteLength, '');

	activeCodeEditor.view.cursorRow = editorViewState.layout.clampBufferRow(buffer, activeCodeEditor.view.cursorRow);
	activeCodeEditor.view.cursorColumn = editorViewState.layout.clampBufferColumn(buffer, activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);

	editorViewState.layout.invalidateHighlightsFromRow(Math.min(row, buffer.getLineCount() - 1));
	editorViewState.layout.invalidateLine(activeCodeEditor.view.cursorRow);
	activeCodeEditor.view.selectionAnchor = null;
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
	await write;
}

/**
 * Pastes text from the editor's internal clipboard.
 */
export function pasteFromClipboard(): void {
	const text = activeCodeEditor.customClipboard;
	if (text === null || text.length === 0) {
		showEditorMessage('Editor clipboard is empty', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	if (!editorAllowsMutation()) {
		showEditorMessage('Tab is read-only', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	prepareUndo('paste', false);
	if (hasSelection()) {
		replaceSelectionWith(text);
	} else {
		insertClipboardText(text);
	}
	showEditorMessage('Pasted from editor clipboard', constants.COLOR_STATUS_SUCCESS, 1.5);
}

/**
 * Writes text to both the internal clipboard and the system clipboard.
 * @param text The text to write
 * @param successMessage Message to show on success
 */
export async function writeClipboard(
	clipboard: Clipboard,
	text: string,
	successMessage: string,
): Promise<void> {
	activeCodeEditor.customClipboard = text;
	if (!clipboard.isSupported()) {
		const message = successMessage + ' (Editor clipboard only)';
		showEditorMessage(message, constants.COLOR_STATUS_SUCCESS, 1.5);
		return;
	}
	try {
		await clipboard.writeText(text);
		showEditorMessage(successMessage, constants.COLOR_STATUS_SUCCESS, 1.5);
	}
	catch (error) {
		showEditorMessage('System clipboard write failed. Editor clipboard updated.', constants.COLOR_STATUS_WARNING, 3.5);
	}
}

export function applyDocumentFormatting(): void {
	const buffer = activeCodeEditor.model.buffer;
	const originalSource = getTextSnapshot(buffer);
	const originalLines = getLinesSnapshot(buffer);
	try {
		let formatted: string;
		switch (activeCodeEditor.model.mode) {
			case 'lua':
				formatted = formatLuaDocument(originalSource, originalLines);
				break;
			case 'aem':
				formatted = formatAemDocument(
					originalSource,
					activeCodeEditor.model.resource.path,
					originalLines,
				);
				break;
		}
		if (formatted === originalSource) {
			showEditorMessage('Document already formatted', constants.COLOR_STATUS_TEXT, 1.5);
			return;
		}
		const cursorOffset = buffer.offsetAt(activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
		prepareUndo('format-document', false);
		recordEditContext('replace', formatted);
		applyUndoableReplace(0, buffer.length, formatted);
		const restoredOffset = editorViewState.layout.clampBufferOffset(buffer, cursorOffset);
		buffer.positionAt(restoredOffset, tmpPosition);
		activeCodeEditor.view.cursorRow = tmpPosition.row;
		activeCodeEditor.view.cursorColumn = tmpPosition.column;
		activeCodeEditor.view.selectionAnchor = null;
		updateDesiredColumn();
		resetBlink();
		revealCursor();
		markTextMutated();
		showEditorMessage('Document formatted', constants.COLOR_STATUS_SUCCESS, 1.6);
	} catch (error) {
		const message = extractErrorMessage(error);
		showEditorMessage(`Formatting failed: ${message}`, constants.COLOR_STATUS_ERROR, 3.2);
	}
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
