import type { CodeEditorControl } from '../ui/code_editor_control';
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
import { changedTextRange } from '../../common/text';
import type { EditContext, Position } from '../../common/models';
import { revealCursor, updateDesiredColumn } from '../ui/view/caret/caret';
import { currentLine } from '../common/text/layout';
import { markTextMutated } from '../common/text/runtime';
import { resetBlinkState } from '../ui/view/caret/blink';
import { formatLuaDocument } from '../../language/lua/formatter';
import { extractErrorMessage } from '../../common/errors';
import { getLinesSnapshot, getTextSnapshot } from '../text/source_text';
import { extractIndentation, countLeadingIndent } from '../text/indentation';
import type { MutableTextPosition } from '../text/text_buffer';
import { prepareUndo, applyUndoableReplace, recordEditContext } from './undo_controller';
import { formatAemDocument } from '../../language/aem/editor';
import {
	clearSingleCursorSelection,
	collapseSingleCursorSelection,
	comparePositions,
	getSingleCursorSelectionRange,
	moveSingleCursor,
	setSingleCursorPosition,
	setSingleCursorSelectionAnchor,
} from './cursor/state';
import { findWordBoundsInLine, findWordLeftOffset, findWordRightOffset } from './cursor/words';


function editorAllowsMutation(code: CodeEditorControl): boolean {
	return !code.model.readOnly;
}

// ============================================================================
// SELECTION STATE MANAGEMENT
// ============================================================================

/**
 * Clears the current selection by removing the anchor.
 */
export function clearSelection(code: CodeEditorControl): void {
	clearSingleCursorSelection(code.view);
}

/**
 * Checks if there is an active selection.
 * @returns true if a selection exists (anchor differs from cursor)
 */
export function hasSelection(code: CodeEditorControl): boolean {
	return getSelectionRange(code) !== null;
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
export function getSelectionRange(code: CodeEditorControl): { start: Position; end: Position } {
	return getSingleCursorSelectionRange(code.view);
}

/**
 * Gets the text content of the current selection.
 * @returns The selected text, or null if no selection
 */
export function getSelectionText(code: CodeEditorControl): string {
	const range = getSelectionRange(code);
	if (!range) {
		return null;
	}
	const buffer = code.model.buffer;
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
export function collapseSelectionTo(code: CodeEditorControl, target: 'start' | 'end'): void {
	if (!collapseSingleCursorSelection(code.view, target)) {
		return;
	}
	code.emitCursorMoved();
	updateDesiredColumn(code);
	resetBlinkState(code.caret);
	revealCursor(code);
}

/**
 * Selects the word at the specified position.
 * Word boundaries are determined by character type (word chars, whitespace, or symbols).
 * @param row The row containing the word
 * @param column The column within the word
 */
export function selectWordAtPosition(code: CodeEditorControl, row: number, column: number): void {
	const buffer = code.model.buffer;
	const lineCount = buffer.getLineCount();
	let targetRow = row;
	if (targetRow < 0) {
		targetRow = 0;
	} else if (targetRow >= lineCount) {
		targetRow = lineCount - 1;
	}
	const line = buffer.getLineContent(targetRow);
	if (line.length === 0) {
		clearSingleCursorSelection(code.view);
		setSingleCursorPosition(code.view, targetRow, 0);
		code.emitCursorMoved();
		updateDesiredColumn(code);
		resetBlinkState(code.caret);
		revealCursor(code);
		return;
	}
	const bounds = findWordBoundsInLine(line, column);
	setSingleCursorSelectionAnchor(code.view, targetRow, bounds.start);
	setSingleCursorPosition(code.view, targetRow, bounds.end);
	code.emitCursorMoved();
	updateDesiredColumn(code);
	resetBlinkState(code.caret);
	revealCursor(code);
}

/**
 * Clamps a position to valid document bounds.
 * @param position The position to clamp, or null
 * @returns The clamped position, or null if input was null
 */
export function clampSelectionPosition(code: CodeEditorControl, position: Position): Position {
	if (!position) {
		return null;
	}
	return code.model.clampPosition(position);
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
export function charAt(code: CodeEditorControl, row: number, column: number): string {
	const buffer = code.model.buffer;
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
	return String.fromCharCode(buffer.charCodeAt(offset));
}

/**
 * Finds the start of the word to the left of the cursor.
 * @param row Current row
 * @param column Current column
 * @returns The position of the word start
 */
export function findWordLeft(code: CodeEditorControl, row: number, column: number, out: MutableTextPosition = code.scratch.wordPosition): Position {
	const buffer = code.model.buffer;
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
export function findWordRight(code: CodeEditorControl, row: number, column: number, out: MutableTextPosition = code.scratch.wordPosition): Position {
	const buffer = code.model.buffer;
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
function deleteSelectionIfPresent(code: CodeEditorControl): boolean {
	if (!hasSelection(code)) {
		return false;
	}
	replaceSelectionWith(code, '');
	return true;
}

/**
 * Deletes the selection with undo support.
 * This is the high-level version that prepares undo.
 */
export function deleteSelection(code: CodeEditorControl): void {
	if (!editorAllowsMutation(code) || !hasSelection(code)) {
		return;
	}
	prepareUndo(code, 'delete-selection', false);
	replaceSelectionWith(code, '');
}

/**
 * Replaces the current selection with the specified text.
 * If no selection exists, this function does nothing.
 * @param text The text to insert in place of the selection
 */
export function replaceSelectionWith(code: CodeEditorControl, text: string): void {
	const range = getSelectionRange(code);
	if (!range) {
		return;
	}
	const buffer = code.model.buffer;
	replaceTextRange(code, buffer.offsetAt(range.start.row, range.start.column), buffer.offsetAt(range.end.row, range.end.column), text);
}

/** Applies a prepared source-range edit and commits its insertion-relative UTF16 caret with the text. */
export function replaceTextRange(code: CodeEditorControl, startOffset: number, endOffset: number, text: string, cursorOffset = text.length): void {
	if (!editorAllowsMutation(code)) {
		return;
	}
	const buffer = code.model.buffer;
	applyUndoableReplace(code, startOffset, endOffset - startOffset, text);
	buffer.positionAt(startOffset + cursorOffset, code.scratch.editPosition);
	moveSingleCursor(code.view, code.scratch.editPosition.row, code.scratch.editPosition.column, false);

	recordEditContext(code, text.length === 0 ? 'delete' : startOffset === endOffset ? 'insert' : 'replace', text);
	markTextMutated(code);
	resetBlinkState(code.caret);
	updateDesiredColumn(code);
	revealCursor(code);
}

// ============================================================================
// TEXT INSERTION OPERATIONS
// ============================================================================

/**
 * Inserts text at the current cursor position.
 * If there's a selection, it will be replaced.
 * @param text The text to insert
 */
export function insertText(code: CodeEditorControl, text: string): void {
	if (!editorAllowsMutation(code) || text.length === 0) {
		return;
	}
	const coalesce = text.length === 1;
	prepareUndo(code, 'insert-text', coalesce);
	if (hasSelection(code)) {
		replaceSelectionWith(code, text);
		return;
	}
	const buffer = code.model.buffer;
	const startRow = code.view.cursorRow;
	const offset = buffer.offsetAt(startRow, code.view.cursorColumn);
	applyUndoableReplace(code, offset, 0, text);
	const newOffset = offset + text.length;
	buffer.positionAt(newOffset, code.scratch.editPosition);
	moveSingleCursor(code.view, code.scratch.editPosition.row, code.scratch.editPosition.column, false);
	recordEditContext(code, 'insert', text);
	markTextMutated(code);
	resetBlinkState(code.caret);
	updateDesiredColumn(code);
	revealCursor(code);
}

/**
 * Inserts a line break at the current cursor position.
 * Auto-indents the new line based on the previous line's indentation.
 */
export function insertLineBreak(code: CodeEditorControl): void {
	if (!editorAllowsMutation(code)) {
		return;
	}
	const buffer = code.model.buffer;
	const range = getSelectionRange(code);
	const sourceRow = range === null ? code.view.cursorRow : range.start.row;
	const sourceColumn = range === null ? code.view.cursorColumn : range.start.column;
	const line = buffer.getLineContent(sourceRow);
	const before = line.slice(0, sourceColumn);
	const indentation = extractIndentation(before);
	const insertion = `\n${indentation}`;
	prepareUndo(code, 'insert-line-break', false);
	if (range !== null) {
		replaceSelectionWith(code, insertion);
		return;
	}
	const offset = buffer.offsetAt(sourceRow, sourceColumn);
	applyUndoableReplace(code, offset, 0, insertion);
	const newOffset = offset + insertion.length;
	buffer.positionAt(newOffset, code.scratch.editPosition);
	moveSingleCursor(code.view, code.scratch.editPosition.row, code.scratch.editPosition.column, false);

	recordEditContext(code, 'insert', '\n');
	markTextMutated(code);
	resetBlinkState(code.caret);
	updateDesiredColumn(code);
	revealCursor(code);
}

/**
 * Inserts text from the clipboard at the current cursor position.
 * Handles multi-line text properly.
 * @param text The clipboard text to insert
 */
export function insertClipboardText(code: CodeEditorControl, text: string): void {
	if (!editorAllowsMutation(code)) {
		return;
	}
	const buffer = code.model.buffer;
	const startRow = code.view.cursorRow;
	const offset = buffer.offsetAt(startRow, code.view.cursorColumn);
	applyUndoableReplace(code, offset, 0, text);
	const newOffset = offset + text.length;
	buffer.positionAt(newOffset, code.scratch.editPosition);
	moveSingleCursor(code.view, code.scratch.editPosition.row, code.scratch.editPosition.column, false);

	recordEditContext(code, 'insert', text);
	markTextMutated(code);
	resetBlinkState(code.caret);
	updateDesiredColumn(code);
	revealCursor(code);
}

// ============================================================================
// TEXT DELETION OPERATIONS
// ============================================================================

/**
 * Deletes the character before the cursor (backspace).
 * If there's a selection, deletes the selection instead.
 */
export function backspace(code: CodeEditorControl): void {
	if (!editorAllowsMutation(code)) {
		return;
	}
	const buffer = code.model.buffer;
	const cursorOffset = buffer.offsetAt(code.view.cursorRow, code.view.cursorColumn);
	if (!hasSelection(code) && cursorOffset === 0) {
		return;
	}
	prepareUndo(code, 'backspace', true);
	if (deleteSelectionIfPresent(code)) {
		return;
	}

	const deleteOffset = cursorOffset - 1;
	const removed = buffer.getTextRange(deleteOffset, cursorOffset);
	applyUndoableReplace(code, deleteOffset, 1, '');
	buffer.positionAt(deleteOffset, code.scratch.editPosition);
	moveSingleCursor(code.view, code.scratch.editPosition.row, code.scratch.editPosition.column, false);
	recordEditContext(code, 'delete', removed);
	markTextMutated(code);
	resetBlinkState(code.caret);
	updateDesiredColumn(code);
	revealCursor(code);
}

/**
 * Deletes the character after the cursor (delete key).
 * If there's a selection, deletes the selection instead.
 */
export function deleteForward(code: CodeEditorControl): void {
	if (!editorAllowsMutation(code)) {
		return;
	}
	const buffer = code.model.buffer;
	const cursorOffset = buffer.offsetAt(code.view.cursorRow, code.view.cursorColumn);
	if (!hasSelection(code) && cursorOffset >= buffer.length) {
		return;
	}
	prepareUndo(code, 'delete-forward', true);
	if (deleteSelectionIfPresent(code)) {
		return;
	}

	const removed = buffer.getTextRange(cursorOffset, cursorOffset + 1);
	applyUndoableReplace(code, cursorOffset, 1, '');
	buffer.positionAt(cursorOffset, code.scratch.editPosition);
	moveSingleCursor(code.view, code.scratch.editPosition.row, code.scratch.editPosition.column, false);
	recordEditContext(code, 'delete', removed);
	markTextMutated(code);
	resetBlinkState(code.caret);
	updateDesiredColumn(code);
	revealCursor(code);
}

/**
 * Deletes from the cursor to the start of the previous word.
 */
export function deleteWordBackward(code: CodeEditorControl): void {
	if (!editorAllowsMutation(code)) {
		return;
	}
	const buffer = code.model.buffer;
	const cursorOffset = buffer.offsetAt(code.view.cursorRow, code.view.cursorColumn);
	if (!hasSelection(code) && cursorOffset === 0) {
		return;
	}
	if (hasSelection(code)) {
		prepareUndo(code, 'delete-word-backward', false);
		deleteSelectionIfPresent(code);
		return;
	}
	const target = findWordLeft(code, code.view.cursorRow, code.view.cursorColumn);
	const targetOffset = buffer.offsetAt(target.row, target.column);
	if (targetOffset === cursorOffset) {
		backspace(code);
		return;
	}

	prepareUndo(code, 'delete-word-backward', false);
	const removed = buffer.getTextRange(targetOffset, cursorOffset);
	applyUndoableReplace(code, targetOffset, cursorOffset - targetOffset, '');
	buffer.positionAt(targetOffset, code.scratch.editPosition);
	moveSingleCursor(code.view, code.scratch.editPosition.row, code.scratch.editPosition.column, false);
	recordEditContext(code, 'delete', removed);
	markTextMutated(code);
	resetBlinkState(code.caret);
	updateDesiredColumn(code);
	revealCursor(code);
}

/**
 * Deletes from the cursor to the end of the next word.
 */
export function deleteWordForward(code: CodeEditorControl): void {
	if (!editorAllowsMutation(code)) {
		return;
	}
	const buffer = code.model.buffer;
	const cursorOffset = buffer.offsetAt(code.view.cursorRow, code.view.cursorColumn);
	if (!hasSelection(code) && cursorOffset >= buffer.length) {
		return;
	}
	if (hasSelection(code)) {
		prepareUndo(code, 'delete-word-forward', false);
		deleteSelectionIfPresent(code);
		return;
	}
	const destination = findWordRight(code, code.view.cursorRow, code.view.cursorColumn);
	const destinationOffset = buffer.offsetAt(destination.row, destination.column);
	if (destinationOffset === cursorOffset) {
		deleteForward(code);
		return;
	}

	prepareUndo(code, 'delete-word-forward', false);
	const removed = buffer.getTextRange(cursorOffset, destinationOffset);
	applyUndoableReplace(code, cursorOffset, destinationOffset - cursorOffset, '');
	buffer.positionAt(cursorOffset, code.scratch.editPosition);
	moveSingleCursor(code.view, code.scratch.editPosition.row, code.scratch.editPosition.column, false);
	recordEditContext(code, 'delete', removed);
	markTextMutated(code);
	resetBlinkState(code.caret);
	updateDesiredColumn(code);
	revealCursor(code);
}

// ============================================================================
// LINE OPERATIONS
// ============================================================================

/**
 * Deletes the currently active line(s).
 * If there's a selection spanning multiple lines, deletes all selected lines.
 */
export function deleteActiveLines(code: CodeEditorControl): void {
	if (!editorAllowsMutation(code)) {
		return;
	}

	const buffer = code.model.buffer;
	const lineCount = buffer.getLineCount();
	const range = getSelectionRange(code);

	let deletionStartRow = code.view.cursorRow;
	let deletionEndRow = code.view.cursorRow;
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

	prepareUndo(code, 'delete-active-lines', false);
	applyUndoableReplace(code, startOffset, deleteLength, '');
	code.view.cursorRow = code.model.clampRow(deletionStartRow);
	code.view.cursorColumn = 0;
	code.view.selectionAnchor = null;
	recordEditContext(code, 'delete', recordText);
	markTextMutated(code);
	resetBlinkState(code.caret);
	updateDesiredColumn(code);
	revealCursor(code);
}

/**
 * Gets the line range affected by line operations (move, delete, etc.).
 * If there's a selection, returns the full line range of the selection.
 * Otherwise, returns just the current line.
 */
export function getLineRangeForMovement(code: CodeEditorControl): { startRow: number; endRow: number } {
	const range = getSelectionRange(code);
	if (!range) {
		return { startRow: code.view.cursorRow, endRow: code.view.cursorRow };
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
export function moveSelectionLines(code: CodeEditorControl, delta: number): void {
	if (!editorAllowsMutation(code)) {
		return;
	}
	if (delta === 0) {
		return;
	}
	const buffer = code.model.buffer;
	const lineCount = buffer.getLineCount();
	const range = getLineRangeForMovement(code);
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

	prepareUndo(code, 'move-lines', false);
	applyUndoableReplace(code, regionStartOffset, regionEndOffset - regionStartOffset, replacementText);
	code.view.cursorRow += delta;
	const anchor = code.view.selectionAnchor;
	if (anchor) {
		anchor.row += delta;
	}
	const cursorRow = code.model.clampRow(code.view.cursorRow);
	code.view.cursorRow = cursorRow;
	code.view.cursorColumn = code.model.clampColumn(cursorRow, code.view.cursorColumn);
	markTextMutated(code);
	resetBlinkState(code.caret);
	updateDesiredColumn(code);
	revealCursor(code);
}

/**
 * Copies the current line or selected lines above/below without moving the originals.
 * @param delta Negative to copy upward, positive to copy downward.
 */
export function copySelectionLines(code: CodeEditorControl, delta: number): void {
	if (!editorAllowsMutation(code)) {
		return;
	}
	if (delta === 0) {
		return;
	}
	const buffer = code.model.buffer;
	const lineCount = buffer.getLineCount();
	const lineRange = getLineRangeForMovement(code);
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

	prepareUndo(code, 'copy-lines', false);
	applyUndoableReplace(code, insertionOffset, 0, insertionText);

	const anchor = code.view.selectionAnchor;
	if (anchor && (anchor.row !== code.view.cursorRow || anchor.column !== code.view.cursorColumn)) {
			const cursorRow = code.view.cursorRow + rowOffset;
			anchor.row += rowOffset;
			code.view.cursorRow = cursorRow;
			code.view.cursorColumn = code.model.clampColumn(cursorRow, code.view.cursorColumn);
	} else {
		const targetRow = code.model.clampRow(code.view.cursorRow + rowOffset);
		code.view.cursorRow = targetRow;
		code.view.cursorColumn = code.model.clampColumn(targetRow, code.view.cursorColumn);
		code.view.selectionAnchor = null;
	}
	recordEditContext(code, 'insert', blockLines.join('\n'));
	markTextMutated(code);
	resetBlinkState(code.caret);
	updateDesiredColumn(code);
	revealCursor(code);
}

// ============================================================================
// INDENTATION OPERATIONS
// ============================================================================

/**
 * Indents the current line or selected lines by adding one document indentation unit.
 */
export function indentSelectionOrLine(code: CodeEditorControl): void {
	if (!editorAllowsMutation(code)) {
		return;
	}
	const buffer = code.model.buffer;
	const unit = code.model.language.indentationUnit;
	prepareUndo(code, 'indent', false);
	const range = getSelectionRange(code);
	if (!range) {
		const row = code.view.cursorRow;
		const offset = buffer.getLineStartOffset(row);
		applyUndoableReplace(code, offset, 0, unit);
		moveSingleCursor(code.view, row, code.view.cursorColumn + unit.length, false);
		recordEditContext(code, 'insert', unit);
		markTextMutated(code);
		resetBlinkState(code.caret);
		updateDesiredColumn(code);
		revealCursor(code);
		return;
	}
	for (let row = range.end.row; row >= range.start.row; row -= 1) {
		const offset = buffer.getLineStartOffset(row);
		applyUndoableReplace(code, offset, 0, unit);
	}
	const anchor = code.view.selectionAnchor;
	if (anchor) {
		anchor.column += unit.length;
	}
	code.view.cursorColumn += unit.length;
	recordEditContext(code, 'insert', unit);
	markTextMutated(code);
	resetBlinkState(code.caret);
	updateDesiredColumn(code);
	revealCursor(code);
}

/**
 * Unindents the current line or selected lines by removing up to one document indentation unit.
 */
export function unindentSelectionOrLine(code: CodeEditorControl): void {
	if (!editorAllowsMutation(code)) {
		return;
	}
	const buffer = code.model.buffer;
	const unitLength = code.model.language.indentationUnit.length;
	const range = getSelectionRange(code);
	if (!range) {
		const row = code.view.cursorRow;
		const line = currentLine(code);
		if (line.length === 0) {
			return;
		}
		const length = Math.min(unitLength, countLeadingIndent(line));
		if (length === 0) {
			return;
		}
		prepareUndo(code, 'unindent', false);
		const offset = buffer.getLineStartOffset(row);
		applyUndoableReplace(code, offset, length, '');
		moveSingleCursor(code.view, row, Math.max(0, code.view.cursorColumn - length), false);
		recordEditContext(code, 'delete', line.slice(0, length));
		markTextMutated(code);
		resetBlinkState(code.caret);
		updateDesiredColumn(code);
		revealCursor(code);
		return;
	}
	const anchor = code.view.selectionAnchor;
	let changed = false;
	for (let row = range.end.row; row >= range.start.row; row -= 1) {
		const line = buffer.getLineContent(row);
		if (line.length === 0) {
			continue;
		}
		const length = Math.min(unitLength, countLeadingIndent(line));
		if (length === 0) {
			continue;
		}
		if (!changed) {
			prepareUndo(code, 'unindent', false);
			changed = true;
		}
		const offset = buffer.getLineStartOffset(row);
		applyUndoableReplace(code, offset, length, '');
		if (anchor?.row === row) anchor.column = Math.max(0, anchor.column - length);
		if (code.view.cursorRow === row) {
			code.view.cursorColumn = Math.max(0, code.view.cursorColumn - length);
		}
	}
	if (!changed) {
		return;
	}
	recordEditContext(code, 'delete', code.model.language.indentationUnit);
	markTextMutated(code);
	resetBlinkState(code.caret);
	updateDesiredColumn(code);
	revealCursor(code);
}

// ============================================================================
// CLIPBOARD OPERATIONS
// ============================================================================

/** Source editors copy/cut the current line when no text is selected. */
export function getClipboardText(code: CodeEditorControl): string {
	const selected = getSelectionText(code);
	if (selected !== null) return selected;
	const line = currentLine(code);
	return code.view.cursorRow < code.model.buffer.getLineCount() - 1 ? `${line}\n` : line;
}

/** Called only after the platform admitted a synchronous Cut. */
export function cutClipboardText(code: CodeEditorControl): void {
	if (hasSelection(code)) deleteSelection(code);
	else deleteActiveLines(code);
}

/**
 * Pastes admitted clipboard text through the ordinary editor and Undo owner.
 */
export function pasteText(code: CodeEditorControl, text: string): void {
	if (text.length === 0) {
		showEditorMessage('Editor clipboard is empty', 'warning', 1.5);
		return;
	}
	if (!editorAllowsMutation(code)) {
		showEditorMessage('Tab is read-only', 'warning', 1.5);
		return;
	}
	prepareUndo(code, 'paste', false);
	if (hasSelection(code)) {
		replaceSelectionWith(code, text);
	} else {
		insertClipboardText(code, text);
	}
	showEditorMessage('Pasted text', 'success', 1.5);
}

export function applyDocumentFormatting(code: CodeEditorControl): void {
	const buffer = code.model.buffer;
	const originalSource = getTextSnapshot(buffer);
	const originalLines = getLinesSnapshot(buffer);
	try {
		let formatted: string;
		switch (code.model.mode) {
			case 'yaml':
				showEditorMessage('YAML formatting is not available', 'info', 2.0);
				return;
			case 'lua':
				formatted = formatLuaDocument(originalSource, originalLines);
				break;
			case 'aem':
				formatted = formatAemDocument(
					originalSource,
					code.model.resource.path,
					originalLines,
				);
				break;
		}
		if (formatted === originalSource) {
			showEditorMessage('Document already formatted', 'info', 1.5);
			return;
		}
		const cursorOffset = buffer.offsetAt(code.view.cursorRow, code.view.cursorColumn);
		prepareUndo(code, 'format-document', false);
		recordEditContext(code, 'replace', formatted);
		applyUndoableReplace(code, 0, buffer.length, formatted);
		const restoredOffset = code.model.clampOffset(cursorOffset);
		buffer.positionAt(restoredOffset, code.scratch.editPosition);
		code.view.cursorRow = code.scratch.editPosition.row;
		code.view.cursorColumn = code.scratch.editPosition.column;
		code.view.selectionAnchor = null;
		updateDesiredColumn(code);
		resetBlinkState(code.caret);
		revealCursor(code);
		markTextMutated(code);
		showEditorMessage('Document formatted', 'success', 1.6);
	} catch (error) {
		const message = extractErrorMessage(error);
		showEditorMessage(`Formatting failed: ${message}`, 'error', 3.2);
	}
}
export function computeEditContextFromSources(previous: string, next: string): EditContext {
	const change = changedTextRange(previous, next);
	if (change === undefined) return null;
	if (next.length >= previous.length) {
		const inserted = next.slice(change.start, change.nextEnd);
		return inserted.length > 0 ? { kind: 'insert', text: inserted } : null;
	}
	const deleted = previous.slice(change.start, change.previousEnd);
	return deleted.length > 0 ? { kind: 'delete', text: deleted } : null;
}
