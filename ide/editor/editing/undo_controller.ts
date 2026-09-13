import { editorRuntimeState } from '../common/runtime_state';
import { notifyReadOnlyEdit } from '../ui/view/view';
import { updateDesiredColumn } from '../ui/view/caret/caret';
import { resetBlink } from '../render/caret';
import { ensureCursorVisible } from '../ui/view/caret/caret';
import { requestSemanticRefresh } from '../contrib/intellisense/engine';
import type { CodeEditorViewSnapshot, Position } from '../../common/models';
import { editorCaretState } from '../ui/view/caret/state';
import { activeCodeEditor, applyCodeEditorViewSnapshot, codeEditorEditState } from '../ui/code_editor_state';
import { editorViewState } from '../ui/view/state';
import { executeTextHistoryCommand } from './history_commands';

export function prepareUndo(key: string, allowMerge: boolean): void {
	const model = activeCodeEditor.model;
	if (model.readOnly) {
		return;
	}
	model.prepareUndo(key, allowMerge, editorRuntimeState.currentTimeMs, codeEditorEditState.of(captureCodeEditorViewSnapshot()));
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
	if (!executeTextHistoryCommand(model, 'undo')) {
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
	if (!executeTextHistoryCommand(model, 'redo')) {
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

export function captureCodeEditorViewSnapshot(): CodeEditorViewSnapshot {
	let selectionCopy: Position = null;
	const view = activeCodeEditor.view;
	const anchor = view.selectionAnchor;
	if (anchor) {
		selectionCopy = { row: anchor.row, column: anchor.column };
	}
	return {
		cursorRow: view.cursorRow,
		cursorColumn: view.cursorColumn,
		scrollRow: view.scrollRow,
		scrollColumn: view.scrollColumn,
		selectionAnchor: selectionCopy,
	};
}

export type RestoreCodeEditorViewSnapshotOptions = {
	preserveScroll?: boolean;
};

export function restoreCodeEditorViewSnapshot(
	snapshot: CodeEditorViewSnapshot,
	options?: RestoreCodeEditorViewSnapshotOptions,
): void {
	editorViewState.maxLineLengthDirty = true;
	editorViewState.layout.markVisualLinesDirty();
	editorViewState.layout.invalidateHighlightsFromRow(0);
	applyCodeEditorViewSnapshot(activeCodeEditor.view, snapshot);
	updateDesiredColumn();
	resetBlink();
	editorCaretState.cursorRevealSuspended = false;
	if (!options?.preserveScroll) {
		ensureCursorVisible();
	}
	requestSemanticRefresh();
}

function refreshAfterHistoryChange(): void {
	editorCaretState.cursorRevealSuspended = false;
	updateDesiredColumn();
	resetBlink();
	ensureCursorVisible();
}
