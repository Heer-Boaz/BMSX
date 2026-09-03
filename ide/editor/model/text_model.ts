import * as constants from '../../common/constants';
import type { CodeEditorViewSnapshot, EditContext } from '../../common/models';
import type { RuntimeResource } from '../../common/resource';
import { PieceTreeBuffer } from '../text/piece_tree_buffer';
import { getTextSnapshot } from '../text/source_text';
import type { TextBuffer } from '../text/text_buffer';
import { EditorUndoRecord, TextUndoOp } from '../text/undo';

export type EditorDocumentMode = 'lua' | 'aem';
export type EditorRuntimeSyncState = 'synced' | 'runtime_update_pending' | 'diverged';

export type EditorTextEdit = {
	offset: number;
	deleteLength: number;
	text: string;
};

export type EditorTextModelChangeKind = 'edit' | 'undo' | 'redo' | 'restore' | 'revert';

export type EditorTextModelContentChangeEvent = {
	kind: EditorTextModelChangeKind;
	version: number;
	startRow: number;
	editContext: EditContext | null;
};

export type EditorTextModelSnapshot = {
	readonly source: string;
	readonly version: number;
	readonly stateId: number;
};

type ContentChangeListener = (event: EditorTextModelContentChangeEvent) => void;
type WorkingCopyListener = () => void;

const editStartPosition = { row: 0, column: 0 };

/**
 * Resource-owned editable text and working-copy state. Editor inputs attach
 * their own cursor, selection, scroll and contribution state to this model.
 */
export class EditorTextModel {
	private readonly pieceTree: PieceTreeBuffer;
	private readonly undoStack: EditorUndoRecord[] = [];
	private readonly redoStack: EditorUndoRecord[] = [];
	private readonly contentChangeListeners = new Set<ContentChangeListener>();
	private readonly dirtyChangeListeners = new Set<WorkingCopyListener>();
	private readonly saveListeners = new Set<WorkingCopyListener>();
	private readonly revertListeners = new Set<WorkingCopyListener>();
	private versionValue = 1;
	private nextStateId = 1;
	private currentStateId = 0;
	private savedStateId = 0;
	private resourceValue: RuntimeResource;
	private lastSavedSourceValue: string;
	private appliedVersionValue = 1;
	private lastContentEditAtMsValue = -1;
	private runtimeSyncStateValue: EditorRuntimeSyncState = 'synced';
	private runtimeSyncMessageValue: string | null = null;
	private lastHistoryKey: string | null = null;
	private lastHistoryTimestamp = 0;
	private pendingRecord: EditorUndoRecord | null = null;
	private pendingRecordIsNew = false;
	private pendingOpStart = 0;
	private pendingHistoryKey: string | null = null;
	private pendingHistoryTimestamp = 0;
	private pendingHistoryMerge = false;
	private pendingStartRow = 0;

	public readonly mode: EditorDocumentMode;

	public constructor(resource: RuntimeResource, mode: EditorDocumentMode, source: string) {
		this.resourceValue = resource;
		this.mode = mode;
		this.pieceTree = new PieceTreeBuffer(source);
		this.lastSavedSourceValue = source;
	}

	public get resource(): RuntimeResource {
		return this.resourceValue;
	}

	public get buffer(): TextBuffer {
		return this.pieceTree;
	}

	public get version(): number {
		return this.versionValue;
	}

	public get dirty(): boolean {
		return this.currentStateId !== this.savedStateId;
	}

	public get readOnly(): boolean {
		return this.resourceValue.source.generated === true;
	}

	public get lastSavedSource(): string {
		return this.lastSavedSourceValue;
	}

	public get appliedVersion(): number {
		return this.appliedVersionValue;
	}

	public get lastContentEditAtMs(): number {
		return this.lastContentEditAtMsValue;
	}

	public get runtimeSyncState(): EditorRuntimeSyncState {
		return this.runtimeSyncStateValue;
	}

	public get runtimeSyncMessage(): string | null {
		return this.runtimeSyncMessageValue;
	}

	public refreshResource(resource: RuntimeResource): void {
		this.resourceValue = resource;
	}

	public onDidChangeContent(listener: ContentChangeListener): () => void {
		this.contentChangeListeners.add(listener);
		return () => this.contentChangeListeners.delete(listener);
	}

	public onDidChangeDirty(listener: WorkingCopyListener): () => void {
		this.dirtyChangeListeners.add(listener);
		return () => this.dirtyChangeListeners.delete(listener);
	}

	public onDidSave(listener: WorkingCopyListener): () => void {
		this.saveListeners.add(listener);
		return () => this.saveListeners.delete(listener);
	}

	public onDidRevert(listener: WorkingCopyListener): () => void {
		this.revertListeners.add(listener);
		return () => this.revertListeners.delete(listener);
	}

	public prepareUndo(
		key: string,
		allowMerge: boolean,
		timestamp: number,
		beforeViewState: CodeEditorViewSnapshot,
	): void {
		this.clearPreparedEdit();
		const shouldMerge = allowMerge
			&& this.lastHistoryKey === key
			&& timestamp - this.lastHistoryTimestamp <= constants.UNDO_COALESCE_INTERVAL_MS;
		if (shouldMerge) {
			this.pendingRecord = this.undoStack[this.undoStack.length - 1];
			this.pendingRecordIsNew = false;
		} else {
			const record = new EditorUndoRecord();
			record.beforeViewState = beforeViewState;
			record.afterViewState = beforeViewState;
			record.beforeStateId = this.currentStateId;
			this.pendingRecord = record;
			this.pendingRecordIsNew = true;
		}
		this.pendingOpStart = this.pendingRecord.ops.length;
		this.pendingHistoryKey = key;
		this.pendingHistoryTimestamp = timestamp;
		this.pendingHistoryMerge = allowMerge;
		this.pendingStartRow = this.pieceTree.getLineCount() - 1;
	}

	public applyUndoableReplace(offset: number, deleteLength: number, insertText: string): void {
		if (deleteLength === 0 && insertText.length === 0) {
			return;
		}
		const record = this.pendingRecord;
		const op = new TextUndoOp();
		this.pieceTree.positionAt(offset, editStartPosition);
		const startRow = editStartPosition.row;
		if (startRow < this.pendingStartRow) {
			this.pendingStartRow = startRow;
		}

		if (deleteLength === 0) {
			this.pieceTree.insert(offset, insertText);
			op.setInsert(offset, insertText.length);
		} else if (insertText.length === 0) {
			const deletedRoot = this.pieceTree.deleteToSubtree(offset, deleteLength);
			op.setDelete(offset, deleteLength, deletedRoot);
		} else {
			const deletedRoot = this.pieceTree.replaceToSubtree(offset, deleteLength, insertText);
			op.setReplace(offset, deleteLength, deletedRoot, insertText.length);
		}
		record.ops.push(op);
	}

	public commitEdit(afterViewState: CodeEditorViewSnapshot, editContext: EditContext | null): boolean {
		const record = this.pendingRecord;
		if (record.ops.length === this.pendingOpStart) {
			this.clearPreparedEdit();
			return false;
		}
		const wasDirty = this.dirty;
		if (this.pendingRecordIsNew) {
			this.pushUndoRecord(record);
			this.clearRedoStack();
			this.pendingRecordIsNew = false;
		}
		record.afterViewState = afterViewState;
		this.currentStateId = this.nextStateId;
		this.nextStateId += 1;
		record.afterStateId = this.currentStateId;
		this.pendingOpStart = record.ops.length;
		this.lastHistoryTimestamp = this.pendingHistoryTimestamp;
		this.lastHistoryKey = this.pendingHistoryMerge ? this.pendingHistoryKey : null;
		this.versionValue += 1;
		const startRow = this.pendingStartRow;
		this.clearPreparedEdit();
		this.emitContentChange('edit', startRow, editContext);
		this.emitDirtyChange(wasDirty);
		return true;
	}

	/**
	 * Applies non-overlapping edits supplied in ascending offset order as one
	 * document undo element and one content-change event.
	 */
	public pushEditOperations(
		edits: readonly EditorTextEdit[],
		beforeViewState: CodeEditorViewSnapshot | null = null,
		afterViewState: CodeEditorViewSnapshot | null = null,
	): void {
		if (edits.length === 0) {
			return;
		}
		const wasDirty = this.dirty;
		this.breakUndoSequence();
		const record = new EditorUndoRecord();
		record.beforeViewState = beforeViewState;
		record.afterViewState = afterViewState;
		record.beforeStateId = this.currentStateId;
		this.pushUndoRecord(record);
		this.clearRedoStack();
		let startRow = this.pieceTree.getLineCount() - 1;
		for (let index = edits.length - 1; index >= 0; index -= 1) {
			const edit = edits[index];
			this.pieceTree.positionAt(edit.offset, editStartPosition);
			if (editStartPosition.row < startRow) {
				startRow = editStartPosition.row;
			}
			this.applyEditToRecord(record, edit.offset, edit.deleteLength, edit.text);
		}
		this.currentStateId = this.nextStateId;
		this.nextStateId += 1;
		record.afterStateId = this.currentStateId;
		this.versionValue += 1;
		this.emitContentChange('edit', startRow, null);
		this.emitDirtyChange(wasDirty);
	}

	public undo(): EditorUndoRecord | null {
		this.clearPreparedEdit();
		if (this.undoStack.length === 0) {
			return null;
		}
		const wasDirty = this.dirty;
		const record = this.undoStack.pop()!;
		const ops = record.ops;
		for (let index = ops.length - 1; index >= 0; index -= 1) {
			const op = ops[index];
			switch (op.kind) {
				case 'insert':
					op.insertedRoot = this.pieceTree.deleteToSubtree(op.offset, op.insertedLen);
					break;
				case 'delete':
					this.pieceTree.insertSubtree(op.offset, op.deletedRoot);
					op.deletedRoot = null;
					break;
				case 'replace':
					op.insertedRoot = this.pieceTree.deleteToSubtree(op.offset, op.insertedLen);
					this.pieceTree.insertSubtree(op.offset, op.deletedRoot);
					op.deletedRoot = null;
					break;
			}
		}
		this.pushRedoRecord(record);
		this.currentStateId = record.beforeStateId;
		this.versionValue += 1;
		this.breakUndoSequence();
		this.emitContentChange('undo', 0, null);
		this.emitDirtyChange(wasDirty);
		return record;
	}

	public redo(): EditorUndoRecord | null {
		this.clearPreparedEdit();
		if (this.redoStack.length === 0) {
			return null;
		}
		const wasDirty = this.dirty;
		const record = this.redoStack.pop()!;
		const ops = record.ops;
		for (let index = 0; index < ops.length; index += 1) {
			const op = ops[index];
			switch (op.kind) {
				case 'insert':
					this.pieceTree.insertSubtree(op.offset, op.insertedRoot);
					op.insertedRoot = null;
					break;
				case 'delete':
					op.deletedRoot = this.pieceTree.deleteToSubtree(op.offset, op.deletedLen);
					break;
				case 'replace':
					op.deletedRoot = this.pieceTree.deleteToSubtree(op.offset, op.deletedLen);
					this.pieceTree.insertSubtree(op.offset, op.insertedRoot);
					op.insertedRoot = null;
					break;
			}
		}
		this.pushUndoRecord(record);
		this.currentStateId = record.afterStateId;
		this.versionValue += 1;
		this.breakUndoSequence();
		this.emitContentChange('redo', 0, null);
		this.emitDirtyChange(wasDirty);
		return record;
	}

	public breakUndoSequence(): void {
		this.clearPreparedEdit();
		this.lastHistoryKey = null;
		this.lastHistoryTimestamp = 0;
	}

	public createSnapshot(): EditorTextModelSnapshot {
		// Keep the state being written as an undo boundary. Edits made while the
		// asynchronous write is in flight must not coalesce across that state.
		this.breakUndoSequence();
		return {
			source: getTextSnapshot(this.pieceTree),
			version: this.versionValue,
			stateId: this.currentStateId,
		};
	}

	public completeSave(snapshot: EditorTextModelSnapshot): void {
		const wasDirty = this.dirty;
		this.savedStateId = snapshot.stateId;
		this.lastSavedSourceValue = snapshot.source;
		this.emitDirtyChange(wasDirty);
		for (const listener of this.saveListeners) {
			listener();
		}
	}

	public markApplied(version: number): void {
		this.appliedVersionValue = version;
	}

	public setRuntimeSyncState(state: EditorRuntimeSyncState, message: string | null): void {
		this.runtimeSyncStateValue = state;
		this.runtimeSyncMessageValue = message;
	}

	public recordContentEdit(timestamp: number): void {
		this.lastContentEditAtMsValue = timestamp;
	}

	public restoreDirtySource(source: string): void {
		const wasDirty = this.dirty;
		this.replaceContents(source);
		this.currentStateId = this.nextStateId;
		this.nextStateId += 1;
		this.emitContentChange('restore', 0, null);
		this.emitDirtyChange(wasDirty);
	}

	public revert(): void {
		const wasDirty = this.dirty;
		this.replaceContents(this.lastSavedSourceValue);
		this.currentStateId = this.savedStateId;
		this.emitContentChange('revert', 0, null);
		this.emitDirtyChange(wasDirty);
		for (const listener of this.revertListeners) {
			listener();
		}
	}

	public dispose(): void {
		this.clearHistory();
		this.contentChangeListeners.clear();
		this.dirtyChangeListeners.clear();
		this.saveListeners.clear();
		this.revertListeners.clear();
	}

	private applyEditToRecord(record: EditorUndoRecord, offset: number, deleteLength: number, text: string): void {
		const op = new TextUndoOp();
		if (deleteLength === 0) {
			this.pieceTree.insert(offset, text);
			op.setInsert(offset, text.length);
		} else if (text.length === 0) {
			const deletedRoot = this.pieceTree.deleteToSubtree(offset, deleteLength);
			op.setDelete(offset, deleteLength, deletedRoot);
		} else {
			const deletedRoot = this.pieceTree.replaceToSubtree(offset, deleteLength, text);
			op.setReplace(offset, deleteLength, deletedRoot, text.length);
		}
		record.ops.push(op);
	}

	private replaceContents(source: string): void {
		this.clearHistory();
		this.pieceTree.replace(0, this.pieceTree.length, source);
		this.versionValue += 1;
		this.breakUndoSequence();
	}

	private pushUndoRecord(record: EditorUndoRecord): void {
		if (this.undoStack.length >= constants.UNDO_HISTORY_LIMIT) {
			this.releaseUndoRecord(this.undoStack.shift()!);
		}
		this.undoStack.push(record);
	}

	private pushRedoRecord(record: EditorUndoRecord): void {
		if (this.redoStack.length >= constants.UNDO_HISTORY_LIMIT) {
			this.releaseUndoRecord(this.redoStack.shift()!);
		}
		this.redoStack.push(record);
	}

	private clearHistory(): void {
		for (let index = 0; index < this.undoStack.length; index += 1) {
			this.releaseUndoRecord(this.undoStack[index]);
		}
		for (let index = 0; index < this.redoStack.length; index += 1) {
			this.releaseUndoRecord(this.redoStack[index]);
		}
		this.undoStack.length = 0;
		this.redoStack.length = 0;
		this.breakUndoSequence();
	}

	private clearRedoStack(): void {
		for (let index = 0; index < this.redoStack.length; index += 1) {
			this.releaseUndoRecord(this.redoStack[index]);
		}
		this.redoStack.length = 0;
	}

	private releaseUndoRecord(record: EditorUndoRecord): void {
		const ops = record.ops;
		for (let index = 0; index < ops.length; index += 1) {
			const op = ops[index];
			if (op.deletedRoot) {
				this.pieceTree.releaseDetachedSubtree(op.deletedRoot);
				op.deletedRoot = null;
			}
			if (op.insertedRoot) {
				this.pieceTree.releaseDetachedSubtree(op.insertedRoot);
				op.insertedRoot = null;
			}
		}
	}

	private clearPreparedEdit(): void {
		this.pendingRecord = null;
		this.pendingRecordIsNew = false;
		this.pendingOpStart = 0;
		this.pendingHistoryKey = null;
		this.pendingHistoryTimestamp = 0;
		this.pendingHistoryMerge = false;
	}

	private emitContentChange(kind: EditorTextModelChangeKind, startRow: number, editContext: EditContext | null): void {
		const event: EditorTextModelContentChangeEvent = {
			kind,
			version: this.versionValue,
			startRow,
			editContext,
		};
		for (const listener of this.contentChangeListeners) {
			listener(event);
		}
	}

	private emitDirtyChange(wasDirty: boolean): void {
		if (wasDirty === this.dirty) {
			return;
		}
		for (const listener of this.dirtyChangeListeners) {
			listener();
		}
	}
}
