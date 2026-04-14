import { $ } from '../../../core/engine_core';
import { EditorUndoRecord, TextUndoOp } from '../text/editor_undo';
import { PieceTreeBuffer } from '../text/piece_tree_buffer';
import * as constants from '../../common/constants';
import { editorRuntimeState } from '../common/editor_runtime_state';
import { capturePreMutationSource, invalidateLuaCommentContextFromRow } from '../../common/text_utils';
import { getActiveCodeTabContext, updateActiveContextDirtyFlag } from '../../workbench/ui/tabs';
import { notifyReadOnlyEdit } from '../ui/editor_view';
import { updateDesiredColumn } from '../ui/caret';
import { resetBlink } from '../render/render_caret';
import { ensureCursorVisible } from '../ui/caret';
import { requestSemanticRefresh } from '../contrib/intellisense/intellisense';
import type { EditorSnapshot, Position } from '../../common/types';
import { editorCaretState } from '../ui/caret_state';
import { editorDocumentState } from './editor_document_state';
import { editorSessionState } from '../ui/editor_session_state';
import { editorViewState } from '../ui/editor_view_state';

export function prepareUndo(key: string, allowMerge: boolean): void {
	if (editorSessionState.activeContextReadOnly) {
		return;
	}
	capturePreMutationSource();
	const now = $.platform.clock.now();
	const shouldMerge = allowMerge
		&& editorDocumentState.lastHistoryKey === key
		&& now - editorDocumentState.lastHistoryTimestamp <= constants.UNDO_COALESCE_INTERVAL_MS;
	if (shouldMerge) {
		editorDocumentState.lastHistoryTimestamp = now;
		return;
	}

	const record = new EditorUndoRecord();
	const anchor = editorDocumentState.selectionAnchor;
	record.setBeforeState(
		editorDocumentState.cursorRow,
		editorDocumentState.cursorColumn,
		editorViewState.scrollRow,
		editorViewState.scrollColumn,
		anchor ? anchor.row : 0,
		anchor ? anchor.column : 0,
		anchor !== null,
	);
	record.setAfterState(
		editorDocumentState.cursorRow,
		editorDocumentState.cursorColumn,
		editorViewState.scrollRow,
		editorViewState.scrollColumn,
		anchor ? anchor.row : 0,
		anchor ? anchor.column : 0,
		anchor !== null,
	);

	const buffer = activePieceBuffer();
	if (editorDocumentState.undoStack.length >= constants.UNDO_HISTORY_LIMIT) {
		const dropped = editorDocumentState.undoStack.shift();
		if (dropped) {
			releaseUndoRecord(buffer, dropped);
		}
	}
	editorDocumentState.undoStack.push(record);

	clearRedoStack(buffer);
	editorDocumentState.lastHistoryTimestamp = now;
	if (allowMerge) {
		editorDocumentState.lastHistoryKey = key;
	} else {
		editorDocumentState.lastHistoryKey = null;
	}
}

function activePieceBuffer(): PieceTreeBuffer {
	return editorDocumentState.buffer as PieceTreeBuffer;
}

function releaseUndoRecord(buffer: PieceTreeBuffer, record: EditorUndoRecord): void {
	const ops = record.ops;
	for (let index = 0; index < ops.length; index += 1) {
		const op = ops[index];
		if (op.deletedRoot) {
			buffer.releaseDetachedSubtree(op.deletedRoot);
			op.deletedRoot = null;
		}
		if (op.insertedRoot) {
			buffer.releaseDetachedSubtree(op.insertedRoot);
			op.insertedRoot = null;
		}
	}
}

function clearRedoStack(buffer: PieceTreeBuffer): void {
	const redoStack = editorDocumentState.redoStack;
	for (let index = 0; index < redoStack.length; index += 1) {
		releaseUndoRecord(buffer, redoStack[index]);
	}
	redoStack.length = 0;
}

const tmpEditStartPosition = { row: 0, column: 0 };

export function applyUndoableReplace(offset: number, deleteLength: number, insertText: string): void {
	if (deleteLength === 0 && insertText.length === 0) {
		return;
	}
	const record = editorDocumentState.undoStack[editorDocumentState.undoStack.length - 1];
	const buffer = activePieceBuffer();
	const op = new TextUndoOp();
	buffer.positionAt(offset, tmpEditStartPosition);
	const startRow = tmpEditStartPosition.row;

	if (deleteLength === 0 && insertText.length > 0) {
		buffer.insert(offset, insertText);
		op.setInsert(offset, insertText.length);
	} else if (deleteLength > 0 && insertText.length === 0) {
		const deletedRoot = buffer.deleteToSubtree(offset, deleteLength);
		op.setDelete(offset, deleteLength, deletedRoot);
	} else {
		const deletedRoot = buffer.replaceToSubtree(offset, deleteLength, insertText);
		op.setReplace(offset, deleteLength, deletedRoot, insertText.length);
	}
	invalidateLuaCommentContextFromRow(buffer, startRow);

	record.ops.push(op);
}

export function undo(): void {
	if (editorSessionState.activeContextReadOnly) {
		notifyReadOnlyEdit();
		return;
	}
	if (editorDocumentState.undoStack.length === 0) {
		return;
	}
	const record = editorDocumentState.undoStack.pop();
	const buffer = activePieceBuffer();
	const ops = record.ops;
	for (let index = ops.length - 1; index >= 0; index -= 1) {
		const op = ops[index];
		switch (op.kind) {
			case 'insert': {
				op.insertedRoot = buffer.deleteToSubtree(op.offset, op.insertedLen);
				break;
			}
			case 'delete': {
				buffer.insertSubtree(op.offset, op.deletedRoot);
				op.deletedRoot = null;
				break;
			}
			case 'replace': {
				op.insertedRoot = buffer.deleteToSubtree(op.offset, op.insertedLen);
				buffer.insertSubtree(op.offset, op.deletedRoot);
				op.deletedRoot = null;
				break;
			}
		}
	}
	invalidateLuaCommentContextFromRow(buffer, 0);

	if (editorDocumentState.redoStack.length >= constants.UNDO_HISTORY_LIMIT) {
		const dropped = editorDocumentState.redoStack.shift();
		if (dropped) {
			releaseUndoRecord(buffer, dropped);
		}
	}
	editorDocumentState.redoStack.push(record);

	editorDocumentState.cursorRow = record.beforeCursorRow;
	editorDocumentState.cursorColumn = record.beforeCursorColumn;
	editorViewState.scrollRow = record.beforeScrollRow;
	editorViewState.scrollColumn = record.beforeScrollColumn;
	editorDocumentState.selectionAnchor = record.beforeHasSelectionAnchor
		? { row: record.beforeSelectionAnchorRow, column: record.beforeSelectionAnchorColumn }
		: null;
	editorDocumentState.textVersion = editorDocumentState.buffer.version;
	editorViewState.maxLineLengthDirty = true;
	editorViewState.layout.markVisualLinesDirty();
	editorViewState.layout.invalidateHighlightsFromRow(0);
	editorCaretState.cursorRevealSuspended = false;
	updateDesiredColumn();
	resetBlink();
	ensureCursorVisible();
	requestSemanticRefresh();

	editorDocumentState.dirty = editorDocumentState.undoStack.length !== editorDocumentState.savePointDepth;
	updateActiveContextDirtyFlag();
	editorDocumentState.saveGeneration = editorDocumentState.saveGeneration + 1;
	const context = getActiveCodeTabContext();
	if (context) {
		context.saveGeneration = editorDocumentState.saveGeneration;
		context.textVersion = editorDocumentState.textVersion;
	}
	breakUndoSequence();
}

export function redo(): void {
	if (editorSessionState.activeContextReadOnly) {
		notifyReadOnlyEdit();
		return;
	}
	if (editorDocumentState.redoStack.length === 0) {
		return;
	}
	const record = editorDocumentState.redoStack.pop();
	const buffer = activePieceBuffer();
	const ops = record.ops;
	for (let index = 0; index < ops.length; index += 1) {
		const op = ops[index];
		switch (op.kind) {
			case 'insert': {
				buffer.insertSubtree(op.offset, op.insertedRoot);
				op.insertedRoot = null;
				break;
			}
			case 'delete': {
				op.deletedRoot = buffer.deleteToSubtree(op.offset, op.deletedLen);
				break;
			}
			case 'replace': {
				op.deletedRoot = buffer.deleteToSubtree(op.offset, op.deletedLen);
				buffer.insertSubtree(op.offset, op.insertedRoot);
				op.insertedRoot = null;
				break;
			}
		}
	}
	invalidateLuaCommentContextFromRow(buffer, 0);

	if (editorDocumentState.undoStack.length >= constants.UNDO_HISTORY_LIMIT) {
		const dropped = editorDocumentState.undoStack.shift();
		if (dropped) {
			releaseUndoRecord(buffer, dropped);
		}
	}
	editorDocumentState.undoStack.push(record);

	editorDocumentState.cursorRow = record.afterCursorRow;
	editorDocumentState.cursorColumn = record.afterCursorColumn;
	editorViewState.scrollRow = record.afterScrollRow;
	editorViewState.scrollColumn = record.afterScrollColumn;
	editorDocumentState.selectionAnchor = record.afterHasSelectionAnchor
		? { row: record.afterSelectionAnchorRow, column: record.afterSelectionAnchorColumn }
		: null;
	editorDocumentState.textVersion = editorDocumentState.buffer.version;
	editorViewState.maxLineLengthDirty = true;
	editorViewState.layout.markVisualLinesDirty();
	editorViewState.layout.invalidateHighlightsFromRow(0);
	editorCaretState.cursorRevealSuspended = false;
	updateDesiredColumn();
	resetBlink();
	ensureCursorVisible();
	requestSemanticRefresh();

	editorDocumentState.dirty = editorDocumentState.undoStack.length !== editorDocumentState.savePointDepth;
	updateActiveContextDirtyFlag();
	editorDocumentState.saveGeneration = editorDocumentState.saveGeneration + 1;
	const context = getActiveCodeTabContext();
	if (context) {
		context.saveGeneration = editorDocumentState.saveGeneration;
		context.textVersion = editorDocumentState.textVersion;
	}
	breakUndoSequence();
}

export function breakUndoSequence(): void {
	editorDocumentState.lastHistoryKey = null;
	editorDocumentState.lastHistoryTimestamp = 0;
}

export function recordEditContext(kind: 'insert' | 'delete' | 'replace', text: string): void {
	editorDocumentState.lastContentEditAtMs = editorRuntimeState.clockNow();
	editorRuntimeState.pendingEditContext = { kind, text };
}

export function applySourceToDocument(source: string): void {
	editorDocumentState.buffer.replace(0, editorDocumentState.buffer.length, source);
	invalidateLuaCommentContextFromRow(editorDocumentState.buffer, 0);
	editorDocumentState.textVersion = editorDocumentState.buffer.version;
	editorViewState.maxLineLengthDirty = true;
	editorViewState.layout.invalidateHighlightsFromRow(0);
	editorViewState.layout.markVisualLinesDirty();
}

export function captureSnapshot(): EditorSnapshot {
	let selectionCopy: Position = null;
	const anchor = editorDocumentState.selectionAnchor;
	if (anchor) {
		selectionCopy = { row: anchor.row, column: anchor.column };
	}
	return {
		cursorRow: editorDocumentState.cursorRow,
		cursorColumn: editorDocumentState.cursorColumn,
		scrollRow: editorViewState.scrollRow,
		scrollColumn: editorViewState.scrollColumn,
		selectionAnchor: selectionCopy,
		textVersion: editorDocumentState.textVersion,
	};
}

export type RestoreSnapshotOptions = {
	preserveScroll?: boolean;
};

export function restoreSnapshot(snapshot: EditorSnapshot, options?: RestoreSnapshotOptions): void {
	editorViewState.maxLineLengthDirty = true;
	editorViewState.layout.markVisualLinesDirty();
	editorViewState.layout.invalidateHighlightsFromRow(0);
	editorDocumentState.cursorRow = snapshot.cursorRow;
	editorDocumentState.cursorColumn = snapshot.cursorColumn;
	editorViewState.scrollRow = snapshot.scrollRow;
	editorViewState.scrollColumn = snapshot.scrollColumn;
	editorDocumentState.selectionAnchor = snapshot.selectionAnchor;
	editorDocumentState.textVersion = editorDocumentState.buffer.version;
	updateDesiredColumn();
	resetBlink();
	editorCaretState.cursorRevealSuspended = false;
	if (options?.preserveScroll !== true) {
		ensureCursorVisible();
	}
	requestSemanticRefresh();
}
