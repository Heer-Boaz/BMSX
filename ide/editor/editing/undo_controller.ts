import type { CodeEditorControl } from '../ui/code_editor_control';
import { notifyReadOnlyEdit } from '../ui/view/view';
import { updateDesiredColumn } from '../ui/view/caret/caret';
import { resetBlinkState } from '../ui/view/caret/blink';
import { ensureCursorVisible } from '../ui/view/caret/caret';
import { captureCodeEditorSelectionSnapshot, codeEditorEditState } from '../ui/code_editor_state';
import { executeTextHistoryCommand } from './history_commands';

export function prepareUndo(code: CodeEditorControl, key: string, allowMerge: boolean): void {
	const model = code.model;
	if (model.readOnly) {
		return;
	}
	model.prepareUndo(key, allowMerge, code.clock.now(), codeEditorEditState.of(captureCodeEditorSelectionSnapshot(code.view), code.view.editSource));
}

export function applyUndoableReplace(code: CodeEditorControl, offset: number, deleteLength: number, insertText: string): void {
	code.model.applyUndoableReplace(offset, deleteLength, insertText);
}

export function undo(code: CodeEditorControl): void {
	const model = code.model;
	if (model.readOnly) {
		notifyReadOnlyEdit();
		return;
	}
	if (!executeTextHistoryCommand(model, 'undo', code.view.editSource)) {
		return;
	}
	refreshAfterHistoryChange(code);
}

export function redo(code: CodeEditorControl): void {
	const model = code.model;
	if (model.readOnly) {
		notifyReadOnlyEdit();
		return;
	}
	if (!executeTextHistoryCommand(model, 'redo', code.view.editSource)) {
		return;
	}
	refreshAfterHistoryChange(code);
}

export function breakUndoSequence(code: CodeEditorControl): void {
	code.model.breakUndoSequence();
}

export function recordEditContext(code: CodeEditorControl, kind: 'insert' | 'delete' | 'replace', text: string): void {
	code.model.recordContentEdit(code.clock.now());
	code.pendingEditContext = { kind, text };
}

function refreshAfterHistoryChange(code: CodeEditorControl): void {
	code.caret.cursorRevealSuspended = false;
	updateDesiredColumn(code);
	resetBlinkState(code.caret);
	ensureCursorVisible(code);
}
