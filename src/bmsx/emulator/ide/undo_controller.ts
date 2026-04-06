import { $ } from '../../core/engine_core';
import { EditorUndoRecord, TextUndoOp } from './text/editor_undo';
import { PieceTreeBuffer } from './text/piece_tree_buffer';
import * as constants from './constants';
import { ide_state } from './ide_state';
import { capturePreMutationSource, invalidateLuaCommentContextFromRow } from './text_utils';
import { getActiveCodeTabContext, updateActiveContextDirtyFlag } from './editor_tabs';
import { notifyReadOnlyEdit } from './editor_view';
import { updateDesiredColumn } from './cart_editor';
import { resetBlink } from './render/render_caret';
import { ensureCursorVisible } from './caret';
import { requestSemanticRefresh } from './intellisense';

export function prepareUndo(key: string, allowMerge: boolean): void {
	if (ide_state.activeContextReadOnly) {
		return;
	}
	capturePreMutationSource();
	const now = $.platform.clock.now();
	const shouldMerge = allowMerge
		&& ide_state.lastHistoryKey === key
		&& now - ide_state.lastHistoryTimestamp <= constants.UNDO_COALESCE_INTERVAL_MS;
	if (shouldMerge) {
		ide_state.lastHistoryTimestamp = now;
		return;
	}

	const record = new EditorUndoRecord();
	const anchor = ide_state.selectionAnchor;
	record.setBeforeState(
		ide_state.cursorRow,
		ide_state.cursorColumn,
		ide_state.scrollRow,
		ide_state.scrollColumn,
		anchor ? anchor.row : 0,
		anchor ? anchor.column : 0,
		anchor !== null,
	);
	record.setAfterState(
		ide_state.cursorRow,
		ide_state.cursorColumn,
		ide_state.scrollRow,
		ide_state.scrollColumn,
		anchor ? anchor.row : 0,
		anchor ? anchor.column : 0,
		anchor !== null,
	);

	const buffer = activePieceBuffer();
	if (ide_state.undoStack.length >= constants.UNDO_HISTORY_LIMIT) {
		const dropped = ide_state.undoStack.shift();
		if (dropped) {
			releaseUndoRecord(buffer, dropped);
		}
	}
	ide_state.undoStack.push(record);

	clearRedoStack(buffer);
	ide_state.lastHistoryTimestamp = now;
	if (allowMerge) {
		ide_state.lastHistoryKey = key;
	} else {
		ide_state.lastHistoryKey = null;
	}
}

function activePieceBuffer(): PieceTreeBuffer {
	return ide_state.buffer as PieceTreeBuffer;
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
	const redoStack = ide_state.redoStack;
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
	const record = ide_state.undoStack[ide_state.undoStack.length - 1];
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
	if (ide_state.activeContextReadOnly) {
		notifyReadOnlyEdit();
		return;
	}
	if (ide_state.undoStack.length === 0) {
		return;
	}
	const record = ide_state.undoStack.pop();
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

	if (ide_state.redoStack.length >= constants.UNDO_HISTORY_LIMIT) {
		const dropped = ide_state.redoStack.shift();
		if (dropped) {
			releaseUndoRecord(buffer, dropped);
		}
	}
	ide_state.redoStack.push(record);

	ide_state.cursorRow = record.beforeCursorRow;
	ide_state.cursorColumn = record.beforeCursorColumn;
	ide_state.scrollRow = record.beforeScrollRow;
	ide_state.scrollColumn = record.beforeScrollColumn;
	ide_state.selectionAnchor = record.beforeHasSelectionAnchor
		? { row: record.beforeSelectionAnchorRow, column: record.beforeSelectionAnchorColumn }
		: null;
	ide_state.textVersion = ide_state.buffer.version;
	ide_state.maxLineLengthDirty = true;
	ide_state.layout.markVisualLinesDirty();
	ide_state.layout.invalidateHighlightsFromRow(0);
	ide_state.cursorRevealSuspended = false;
	updateDesiredColumn();
	resetBlink();
	ensureCursorVisible();
	requestSemanticRefresh();

	ide_state.dirty = ide_state.undoStack.length !== ide_state.savePointDepth;
	updateActiveContextDirtyFlag();
	ide_state.saveGeneration = ide_state.saveGeneration + 1;
	const context = getActiveCodeTabContext();
	if (context) {
		context.saveGeneration = ide_state.saveGeneration;
		context.textVersion = ide_state.textVersion;
	}
	breakUndoSequence();
}

export function redo(): void {
	if (ide_state.activeContextReadOnly) {
		notifyReadOnlyEdit();
		return;
	}
	if (ide_state.redoStack.length === 0) {
		return;
	}
	const record = ide_state.redoStack.pop();
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

	if (ide_state.undoStack.length >= constants.UNDO_HISTORY_LIMIT) {
		const dropped = ide_state.undoStack.shift();
		if (dropped) {
			releaseUndoRecord(buffer, dropped);
		}
	}
	ide_state.undoStack.push(record);

	ide_state.cursorRow = record.afterCursorRow;
	ide_state.cursorColumn = record.afterCursorColumn;
	ide_state.scrollRow = record.afterScrollRow;
	ide_state.scrollColumn = record.afterScrollColumn;
	ide_state.selectionAnchor = record.afterHasSelectionAnchor
		? { row: record.afterSelectionAnchorRow, column: record.afterSelectionAnchorColumn }
		: null;
	ide_state.textVersion = ide_state.buffer.version;
	ide_state.maxLineLengthDirty = true;
	ide_state.layout.markVisualLinesDirty();
	ide_state.layout.invalidateHighlightsFromRow(0);
	ide_state.cursorRevealSuspended = false;
	updateDesiredColumn();
	resetBlink();
	ensureCursorVisible();
	requestSemanticRefresh();

	ide_state.dirty = ide_state.undoStack.length !== ide_state.savePointDepth;
	updateActiveContextDirtyFlag();
	ide_state.saveGeneration = ide_state.saveGeneration + 1;
	const context = getActiveCodeTabContext();
	if (context) {
		context.saveGeneration = ide_state.saveGeneration;
		context.textVersion = ide_state.textVersion;
	}
	breakUndoSequence();
}

export function breakUndoSequence(): void {
	ide_state.lastHistoryKey = null;
	ide_state.lastHistoryTimestamp = 0;
}

export function recordEditContext(kind: 'insert' | 'delete' | 'replace', text: string): void {
	ide_state.lastContentEditAtMs = ide_state.clockNow();
	ide_state.pendingEditContext = { kind, text };
}

export function applySourceToDocument(source: string): void {
	ide_state.buffer.replace(0, ide_state.buffer.length, source);
	invalidateLuaCommentContextFromRow(ide_state.buffer, 0);
	ide_state.textVersion = ide_state.buffer.version;
	ide_state.maxLineLengthDirty = true;
	ide_state.layout.invalidateHighlightsFromRow(0);
	ide_state.layout.markVisualLinesDirty();
}
