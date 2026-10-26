import type { CodeEditorControl } from '../ui/code_editor_control';
import { notifyReadOnlyEdit } from '../ui/view/view';
import { prepareUndo, applyUndoableReplace } from './undo_controller';
import { markTextMutated } from '../common/text/runtime';
import { resetBlinkState } from '../ui/view/caret/blink';
import { revealCursor, updateDesiredColumn } from '../ui/view/caret/caret';
import * as TextEditing from './text_editing_and_selection';

export function toggleLineComments(code: CodeEditorControl): void {
	const prefix = code.model.language.lineComment;
	if (prefix === undefined) return;
	if (code.model.readOnly) {
		notifyReadOnlyEdit();
		return;
	}
	const range = TextEditing.getLineRangeForMovement(code);
	if (range.startRow < 0 || range.endRow < range.startRow) {
		return;
	}
	let allCommented = true;
	for (let row = range.startRow; row <= range.endRow; row++) {
		const line = code.model.buffer.getLineContent(row);
		const commentIndex = firstNonWhitespaceIndex(line);
		if (commentIndex >= line.length) {
			allCommented = false;
			break;
		}
		if (!line.startsWith(prefix, commentIndex)) {
			allCommented = false;
			break;
		}
	}
	if (allCommented) {
		removeLineComments(code, range);
	} else {
		addLineComments(code, range);
	}
}

export function addLineComments(code: CodeEditorControl, range?: { startRow: number; endRow: number }): void {
	const prefix = code.model.language.lineComment;
	if (prefix === undefined) return;
	if (code.model.readOnly) {
		notifyReadOnlyEdit();
		return;
	}
	const target = range ?? TextEditing.getLineRangeForMovement(code);
	if (target.startRow < 0 || target.endRow < target.startRow) {
		return;
	}
	prepareUndo(code, 'comment-lines', false);
	let changed = false;
	for (let row = target.startRow; row <= target.endRow; row++) {
		const originalLine = code.model.buffer.getLineContent(row);
		const insertIndex = firstNonWhitespaceIndex(originalLine);
		const hasContent = insertIndex < originalLine.length;
		let insertion = prefix;
		if (hasContent) {
			const nextChar = originalLine.charAt(insertIndex);
			if (nextChar !== ' ' && nextChar !== '\t') {
				insertion = prefix + ' ';
			}
		}
		applyUndoableReplace(code, code.model.buffer.offsetAt(row, insertIndex), 0, insertion);
		shiftPositionsForInsertion(code, row, insertIndex, insertion.length);
		changed = true;
	}
	if (!changed) {
		return;
	}
	code.view.cursorRow = code.model.clampRow(code.view.cursorRow);
	code.view.cursorColumn = code.model.clampColumn(code.view.cursorRow, code.view.cursorColumn);
	code.view.selectionAnchor = TextEditing.clampSelectionPosition(code, code.view.selectionAnchor);
	markTextMutated(code);
	resetBlinkState(code.caret);
	updateDesiredColumn(code);
	revealCursor(code);
}

export function removeLineComments(code: CodeEditorControl, range?: { startRow: number; endRow: number }): void {
	const prefix = code.model.language.lineComment;
	if (prefix === undefined) return;
	if (code.model.readOnly) {
		notifyReadOnlyEdit();
		return;
	}
	const target = range ?? TextEditing.getLineRangeForMovement(code);
	if (target.startRow < 0 || target.endRow < target.startRow) {
		return;
	}
	let changed = false;
	for (let row = target.startRow; row <= target.endRow; row++) {
		const originalLine = code.model.buffer.getLineContent(row);
		const commentIndex = firstNonWhitespaceIndex(originalLine);
		if (commentIndex >= originalLine.length) {
			continue;
		}
		if (!originalLine.startsWith(prefix, commentIndex)) {
			continue;
		}
		let removal = prefix.length;
		if (commentIndex + prefix.length < originalLine.length) {
			const trailing = originalLine.charAt(commentIndex + prefix.length);
			if (trailing === ' ') {
				removal += 1;
			}
		}
		if (!changed) {
			prepareUndo(code, 'uncomment-lines', false);
			changed = true;
		}
		applyUndoableReplace(code, code.model.buffer.offsetAt(row, commentIndex), removal, '');
		shiftPositionsForRemoval(code, row, commentIndex, removal);
	}
	if (!changed) {
		return;
	}
	code.view.cursorRow = code.model.clampRow(code.view.cursorRow);
	code.view.cursorColumn = code.model.clampColumn(code.view.cursorRow, code.view.cursorColumn);
	code.view.selectionAnchor = TextEditing.clampSelectionPosition(code, code.view.selectionAnchor);
	markTextMutated(code);
	resetBlinkState(code.caret);
	updateDesiredColumn(code);
	revealCursor(code);
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

export function shiftPositionsForInsertion(code: CodeEditorControl, row: number, column: number, length: number): void {
	if (length <= 0) {
		return;
	}
	if (code.view.cursorRow === row && code.view.cursorColumn >= column) {
		code.view.cursorColumn += length;
	}
	if (code.view.selectionAnchor && code.view.selectionAnchor.row === row && code.view.selectionAnchor.column >= column) {
		code.view.selectionAnchor.column += length;
	}
}

export function shiftPositionsForRemoval(code: CodeEditorControl, row: number, column: number, length: number): void {
	if (length <= 0) {
		return;
	}
	if (code.view.cursorRow === row && code.view.cursorColumn > column) {
		if (code.view.cursorColumn <= column + length) {
			code.view.cursorColumn = column;
		} else {
			code.view.cursorColumn -= length;
		}
	}
	if (code.view.selectionAnchor && code.view.selectionAnchor.row === row && code.view.selectionAnchor.column > column) {
		if (code.view.selectionAnchor.column <= column + length) {
			code.view.selectionAnchor.column = column;
		} else {
			code.view.selectionAnchor.column -= length;
		}
	}
}
