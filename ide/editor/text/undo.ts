import type { PieceTreeNode } from './piece_tree_buffer';
import type { CodeEditorViewSnapshot } from '../../common/models';

export type TextUndoKind = 'insert' | 'delete' | 'replace';

export class TextUndoOp {
	public kind: TextUndoKind = 'insert';
	public offset = 0;

	public deletedLen = 0;
	public insertedLen = 0;

	public deletedRoot: PieceTreeNode | null = null;
	public insertedRoot: PieceTreeNode | null = null;

	public setInsert(offset: number, insertedLen: number): void {
		this.kind = 'insert';
		this.offset = offset;
		this.deletedLen = 0;
		this.insertedLen = insertedLen;
		this.deletedRoot = null;
		this.insertedRoot = null;
	}

	public setDelete(offset: number, deletedLen: number, deletedRoot: PieceTreeNode | null): void {
		this.kind = 'delete';
		this.offset = offset;
		this.deletedLen = deletedLen;
		this.insertedLen = 0;
		this.deletedRoot = deletedRoot;
		this.insertedRoot = null;
	}

	public setReplace(offset: number, deletedLen: number, deletedRoot: PieceTreeNode | null, insertedLen: number): void {
		this.kind = 'replace';
		this.offset = offset;
		this.deletedLen = deletedLen;
		this.insertedLen = insertedLen;
		this.deletedRoot = deletedRoot;
		this.insertedRoot = null;
	}
}

export class EditorUndoRecord {
	public readonly ops: TextUndoOp[] = [];
	public beforeViewState: CodeEditorViewSnapshot | null = null;
	public afterViewState: CodeEditorViewSnapshot | null = null;
	public beforeStateId = 0;
	public afterStateId = 0;
}
