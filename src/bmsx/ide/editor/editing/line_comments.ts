import { isEditableCodeTab } from '../../workbench/ui/code_tab/contexts';
import { notifyReadOnlyEdit } from '../ui/view/view';
import { prepareUndo, applyUndoableReplace } from './undo_controller';
import { markTextMutated } from '../common/text_runtime';
import { resetBlink } from '../render/caret';
import { revealCursor, updateDesiredColumn } from '../ui/view/caret/caret';
import * as TextEditing from './text_editing_and_selection';
import { editorDocumentState } from './document_state';
import { editorViewState } from '../ui/view/state';

export function toggleLineComments(): void {
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return;
	}
	const range = TextEditing.getLineRangeForMovement();
	if (range.startRow < 0 || range.endRow < range.startRow) {
		return;
	}
	let allCommented = true;
	for (let row = range.startRow; row <= range.endRow; row++) {
		const line = editorDocumentState.buffer.getLineContent(row);
		const commentIndex = firstNonWhitespaceIndex(line);
		if (commentIndex >= line.length) {
			allCommented = false;
			break;
		}
		if (!line.startsWith('--', commentIndex)) {
			allCommented = false;
			break;
		}
	}
	if (allCommented) {
		removeLineComments(range);
	} else {
		addLineComments(range);
	}
}

export function addLineComments(range?: { startRow: number; endRow: number }): void {
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return;
	}
	const target = range ?? TextEditing.getLineRangeForMovement();
	if (target.startRow < 0 || target.endRow < target.startRow) {
		return;
	}
	prepareUndo('comment-lines', false);
	let changed = false;
	for (let row = target.startRow; row <= target.endRow; row++) {
		const originalLine = editorDocumentState.buffer.getLineContent(row);
		const insertIndex = firstNonWhitespaceIndex(originalLine);
		const hasContent = insertIndex < originalLine.length;
		let insertion = '--';
		if (hasContent) {
			const nextChar = originalLine.charAt(insertIndex);
			if (nextChar !== ' ' && nextChar !== '\t') {
				insertion = '-- ';
			}
		}
		applyUndoableReplace(editorDocumentState.buffer.offsetAt(row, insertIndex), 0, insertion);
		editorViewState.layout.invalidateLine(row);
		shiftPositionsForInsertion(row, insertIndex, insertion.length);
		changed = true;
	}
	if (!changed) {
		return;
	}
	editorDocumentState.cursorRow = editorViewState.layout.clampBufferRow(editorDocumentState.buffer, editorDocumentState.cursorRow);
	const cursorLine = editorDocumentState.buffer.getLineContent(editorDocumentState.cursorRow);
	editorDocumentState.cursorColumn = editorViewState.layout.clampLineLength(cursorLine.length, editorDocumentState.cursorColumn);
	editorDocumentState.selectionAnchor = TextEditing.clampSelectionPosition(editorDocumentState.selectionAnchor);
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function removeLineComments(range?: { startRow: number; endRow: number }): void {
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return;
	}
	const target = range ?? TextEditing.getLineRangeForMovement();
	if (target.startRow < 0 || target.endRow < target.startRow) {
		return;
	}
	prepareUndo('uncomment-lines', false);
	let changed = false;
	for (let row = target.startRow; row <= target.endRow; row++) {
		const originalLine = editorDocumentState.buffer.getLineContent(row);
		const commentIndex = firstNonWhitespaceIndex(originalLine);
		if (commentIndex >= originalLine.length) {
			continue;
		}
		if (!originalLine.startsWith('--', commentIndex)) {
			continue;
		}
		let removal = 2;
		if (commentIndex + 2 < originalLine.length) {
			const trailing = originalLine.charAt(commentIndex + 2);
			if (trailing === ' ') {
				removal = 3;
			}
		}
		applyUndoableReplace(editorDocumentState.buffer.offsetAt(row, commentIndex), removal, '');
		editorViewState.layout.invalidateLine(row);
		shiftPositionsForRemoval(row, commentIndex, removal);
		changed = true;
	}
	if (!changed) {
		return;
	}
	editorDocumentState.cursorRow = editorViewState.layout.clampBufferRow(editorDocumentState.buffer, editorDocumentState.cursorRow);
	const cursorLine = editorDocumentState.buffer.getLineContent(editorDocumentState.cursorRow);
	editorDocumentState.cursorColumn = editorViewState.layout.clampLineLength(cursorLine.length, editorDocumentState.cursorColumn);
	editorDocumentState.selectionAnchor = TextEditing.clampSelectionPosition(editorDocumentState.selectionAnchor);
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function firstNonWhitespaceIndex(value: string): number {
	for (let index = 0; index < value.length; index++) {
		const ch = value.charAt(index);
		if (ch !== ' ' && ch !== '\t') {
			return index;
		}
	}
	return value.length;
}

export function shiftPositionsForInsertion(row: number, column: number, length: number): void {
	if (length <= 0) {
		return;
	}
	if (editorDocumentState.cursorRow === row && editorDocumentState.cursorColumn >= column) {
		editorDocumentState.cursorColumn += length;
	}
	if (editorDocumentState.selectionAnchor && editorDocumentState.selectionAnchor.row === row && editorDocumentState.selectionAnchor.column >= column) {
		editorDocumentState.selectionAnchor.column += length;
	}
}

export function shiftPositionsForRemoval(row: number, column: number, length: number): void {
	if (length <= 0) {
		return;
	}
	if (editorDocumentState.cursorRow === row && editorDocumentState.cursorColumn > column) {
		if (editorDocumentState.cursorColumn <= column + length) {
			editorDocumentState.cursorColumn = column;
		} else {
			editorDocumentState.cursorColumn -= length;
		}
	}
	if (editorDocumentState.selectionAnchor && editorDocumentState.selectionAnchor.row === row && editorDocumentState.selectionAnchor.column > column) {
		if (editorDocumentState.selectionAnchor.column <= column + length) {
			editorDocumentState.selectionAnchor.column = column;
		} else {
			editorDocumentState.selectionAnchor.column -= length;
		}
	}
}
