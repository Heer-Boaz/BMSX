import { notifyReadOnlyEdit } from '../ui/view/view';
import { prepareUndo, applyUndoableReplace } from './undo_controller';
import { markTextMutated } from '../common/text/runtime';
import { resetBlink } from '../render/caret';
import { revealCursor, updateDesiredColumn } from '../ui/view/caret/caret';
import * as TextEditing from './text_editing_and_selection';
import { activeCodeEditor } from '../ui/code_editor_state';
import { editorViewState } from '../ui/view/state';

export function toggleLineComments(): void {
	if (activeCodeEditor.model.readOnly) {
		notifyReadOnlyEdit();
		return;
	}
	const range = TextEditing.getLineRangeForMovement();
	if (range.startRow < 0 || range.endRow < range.startRow) {
		return;
	}
	let allCommented = true;
	for (let row = range.startRow; row <= range.endRow; row++) {
		const line = activeCodeEditor.model.buffer.getLineContent(row);
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
	if (activeCodeEditor.model.readOnly) {
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
		const originalLine = activeCodeEditor.model.buffer.getLineContent(row);
		const insertIndex = firstNonWhitespaceIndex(originalLine);
		const hasContent = insertIndex < originalLine.length;
		let insertion = '--';
		if (hasContent) {
			const nextChar = originalLine.charAt(insertIndex);
			if (nextChar !== ' ' && nextChar !== '\t') {
				insertion = '-- ';
			}
		}
		applyUndoableReplace(activeCodeEditor.model.buffer.offsetAt(row, insertIndex), 0, insertion);
		editorViewState.layout.invalidateLine(row);
		shiftPositionsForInsertion(row, insertIndex, insertion.length);
		changed = true;
	}
	if (!changed) {
		return;
	}
	activeCodeEditor.view.cursorRow = editorViewState.layout.clampBufferRow(activeCodeEditor.model.buffer, activeCodeEditor.view.cursorRow);
	const cursorLine = activeCodeEditor.model.buffer.getLineContent(activeCodeEditor.view.cursorRow);
	activeCodeEditor.view.cursorColumn = editorViewState.layout.clampLineLength(cursorLine.length, activeCodeEditor.view.cursorColumn);
	activeCodeEditor.view.selectionAnchor = TextEditing.clampSelectionPosition(activeCodeEditor.view.selectionAnchor);
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function removeLineComments(range?: { startRow: number; endRow: number }): void {
	if (activeCodeEditor.model.readOnly) {
		notifyReadOnlyEdit();
		return;
	}
	const target = range ?? TextEditing.getLineRangeForMovement();
	if (target.startRow < 0 || target.endRow < target.startRow) {
		return;
	}
	let changed = false;
	for (let row = target.startRow; row <= target.endRow; row++) {
		const originalLine = activeCodeEditor.model.buffer.getLineContent(row);
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
		if (!changed) {
			prepareUndo('uncomment-lines', false);
			changed = true;
		}
		applyUndoableReplace(activeCodeEditor.model.buffer.offsetAt(row, commentIndex), removal, '');
		editorViewState.layout.invalidateLine(row);
		shiftPositionsForRemoval(row, commentIndex, removal);
	}
	if (!changed) {
		return;
	}
	activeCodeEditor.view.cursorRow = editorViewState.layout.clampBufferRow(activeCodeEditor.model.buffer, activeCodeEditor.view.cursorRow);
	const cursorLine = activeCodeEditor.model.buffer.getLineContent(activeCodeEditor.view.cursorRow);
	activeCodeEditor.view.cursorColumn = editorViewState.layout.clampLineLength(cursorLine.length, activeCodeEditor.view.cursorColumn);
	activeCodeEditor.view.selectionAnchor = TextEditing.clampSelectionPosition(activeCodeEditor.view.selectionAnchor);
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
	if (activeCodeEditor.view.cursorRow === row && activeCodeEditor.view.cursorColumn >= column) {
		activeCodeEditor.view.cursorColumn += length;
	}
	if (activeCodeEditor.view.selectionAnchor && activeCodeEditor.view.selectionAnchor.row === row && activeCodeEditor.view.selectionAnchor.column >= column) {
		activeCodeEditor.view.selectionAnchor.column += length;
	}
}

export function shiftPositionsForRemoval(row: number, column: number, length: number): void {
	if (length <= 0) {
		return;
	}
	if (activeCodeEditor.view.cursorRow === row && activeCodeEditor.view.cursorColumn > column) {
		if (activeCodeEditor.view.cursorColumn <= column + length) {
			activeCodeEditor.view.cursorColumn = column;
		} else {
			activeCodeEditor.view.cursorColumn -= length;
		}
	}
	if (activeCodeEditor.view.selectionAnchor && activeCodeEditor.view.selectionAnchor.row === row && activeCodeEditor.view.selectionAnchor.column > column) {
		if (activeCodeEditor.view.selectionAnchor.column <= column + length) {
			activeCodeEditor.view.selectionAnchor.column = column;
		} else {
			activeCodeEditor.view.selectionAnchor.column -= length;
		}
	}
}
