import { editorRuntimeState } from '../common/runtime_state';
import { notifyReadOnlyEdit } from '../ui/view/view';
import { updateDesiredColumn } from '../ui/view/caret/caret';
import { resetBlink } from '../render/caret';
import { ensureCursorVisible } from '../ui/view/caret/caret';
import { editorCaretState } from '../ui/view/caret/state';
import { activeCodeEditor, captureCodeEditorSelectionSnapshot, codeEditorEditState } from '../ui/code_editor_state';
import { executeTextHistoryCommand } from './history_commands';

export function prepareUndo(key: string, allowMerge: boolean): void {
	const model = activeCodeEditor.model;
	if (model.readOnly) {
		return;
	}
	model.prepareUndo(key, allowMerge, editorRuntimeState.currentTimeMs, codeEditorEditState.of(captureCodeEditorSelectionSnapshot(activeCodeEditor.view), activeCodeEditor.view.editSource));
}

export function applyUndoableReplace(offset: number, deleteLength: number, insertText: string): void {
	activeCodeEditor.model.applyUndoableReplace(offset, deleteLength, insertText);
}

export function undo(): void {
	const model = activeCodeEditor.model;
	if (model.readOnly) {
		notifyReadOnlyEdit();
		return;
	}
	if (!executeTextHistoryCommand(model, 'undo', activeCodeEditor.view.editSource)) {
		return;
	}
	refreshAfterHistoryChange();
}

export function redo(): void {
	const model = activeCodeEditor.model;
	if (model.readOnly) {
		notifyReadOnlyEdit();
		return;
	}
	if (!executeTextHistoryCommand(model, 'redo', activeCodeEditor.view.editSource)) {
		return;
	}
	refreshAfterHistoryChange();
}

export function breakUndoSequence(): void {
	activeCodeEditor.model.breakUndoSequence();
}

export function recordEditContext(kind: 'insert' | 'delete' | 'replace', text: string): void {
	activeCodeEditor.model.recordContentEdit(editorRuntimeState.currentTimeMs);
	editorRuntimeState.pendingEditContext = { kind, text };
}

function refreshAfterHistoryChange(): void {
	editorCaretState.cursorRevealSuspended = false;
	updateDesiredColumn();
	resetBlink();
	ensureCursorVisible();
}
