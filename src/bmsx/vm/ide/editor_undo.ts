import type { PieceTreeNode } from './piece_tree_buffer';

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

	public beforeCursorRow = 0;
	public beforeCursorColumn = 0;
	public beforeScrollRow = 0;
	public beforeScrollColumn = 0;
	public beforeHasSelectionAnchor = false;
	public beforeSelectionAnchorRow = 0;
	public beforeSelectionAnchorColumn = 0;

	public afterCursorRow = 0;
	public afterCursorColumn = 0;
	public afterScrollRow = 0;
	public afterScrollColumn = 0;
	public afterHasSelectionAnchor = false;
	public afterSelectionAnchorRow = 0;
	public afterSelectionAnchorColumn = 0;

	public setBeforeState(
		cursorRow: number,
		cursorColumn: number,
		scrollRow: number,
		scrollColumn: number,
		selectionAnchorRow: number,
		selectionAnchorColumn: number,
		hasSelectionAnchor: boolean,
	): void {
		this.beforeCursorRow = cursorRow;
		this.beforeCursorColumn = cursorColumn;
		this.beforeScrollRow = scrollRow;
		this.beforeScrollColumn = scrollColumn;
		this.beforeHasSelectionAnchor = hasSelectionAnchor;
		this.beforeSelectionAnchorRow = selectionAnchorRow;
		this.beforeSelectionAnchorColumn = selectionAnchorColumn;
	}

	public setAfterState(
		cursorRow: number,
		cursorColumn: number,
		scrollRow: number,
		scrollColumn: number,
		selectionAnchorRow: number,
		selectionAnchorColumn: number,
		hasSelectionAnchor: boolean,
	): void {
		this.afterCursorRow = cursorRow;
		this.afterCursorColumn = cursorColumn;
		this.afterScrollRow = scrollRow;
		this.afterScrollColumn = scrollColumn;
		this.afterHasSelectionAnchor = hasSelectionAnchor;
		this.afterSelectionAnchorRow = selectionAnchorRow;
		this.afterSelectionAnchorColumn = selectionAnchorColumn;
	}
}

