import type { PieceTreeNode } from './piece_tree_buffer';
import type { CodeEditorViewSnapshot } from '../../common/models';
import type { EditorTextChange } from './text_change';

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

	/** Immutable, forward-oriented changes; never expose mutable undo subtrees to views. */
	public getTextChanges(startIndex = 0, inverse = false): EditorTextChange[] {
		const changes = new Array<EditorTextChange>(this.ops.length - startIndex);
		for (let index = 0; index < changes.length; index += 1) {
			const op = this.ops[inverse ? this.ops.length - 1 - index : startIndex + index];
			changes[index] = {
				offset: op.offset,
				deletedLength: inverse ? op.insertedLen : op.deletedLen,
				insertedLength: inverse ? op.deletedLen : op.insertedLen,
			};
		}
		return changes;
	}
}
