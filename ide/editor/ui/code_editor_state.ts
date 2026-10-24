import { EditorEditStateType } from '../model/edit_state';
import type { CodeEditorViewSnapshot, Position } from '../../common/models';
import { clamp } from '../../../machine/ts/common/clamp';
import type { EditorTextModel } from '../model/text_model';
import { inputFocus } from '../../input/focus';
import { clearSingleCursorSelection, setSingleCursorSelectionAnchor } from '../editing/cursor/state';

export const codeEditorEditState = new EditorEditStateType<CodeEditorViewSnapshot>();

type CursorMovedListener = () => void;

/** Ephemeral presentation intent for the attached source widget, never an Undo/view snapshot. */
export type InlineEditState = {
	readonly version: number;
	readonly active: boolean;
	readonly row: number;
	readonly startColumn: number;
	readonly endColumn: number;
	readonly text: string;
	readonly preserveCase: boolean;
};

export type VisualCursor = {
	readonly row: number;
	readonly column: number;
	readonly visualIndex: number;
};

export type CodeEditorViewState = {
	cursorRow: number;
	cursorColumn: number;
	selectionAnchor: Position;
	selectionAnchorScratch: Position;
	desiredColumn: number;
	desiredDisplayOffset: number;
	/** Continuous viewport position, projected to a visual row at layout/render boundaries. */
	scrollRow: number;
	scrollColumn: number;
};

export type CodeEditorContext = {
	readonly model: EditorTextModel;
	readonly view: CodeEditorViewState;
};

export function createCodeEditorViewState(): CodeEditorViewState {
	return {
		cursorRow: 0,
		cursorColumn: 0,
		selectionAnchor: null,
		selectionAnchorScratch: { row: 0, column: 0 },
		desiredColumn: 0,
		desiredDisplayOffset: 0,
		scrollRow: 0,
		scrollColumn: 0,
	};
}

/** Applies model-associated state to a retained view, without touching the active widget. */
export function applyCodeEditorViewSnapshot(view: CodeEditorViewState, snapshot: CodeEditorViewSnapshot): void {
	view.cursorRow = snapshot.cursorRow;
	view.cursorColumn = snapshot.cursorColumn;
	view.scrollRow = snapshot.scrollRow;
	view.scrollColumn = snapshot.scrollColumn;
	const anchor = snapshot.selectionAnchor;
	if (anchor === null) clearSingleCursorSelection(view);
	else setSingleCursorSelectionAnchor(view, anchor.row, anchor.column);
}

/** The single code-editor widget and the model/view currently attached to it. */
export class ActiveCodeEditorState {
	public readonly focusTarget = inputFocus.createTarget();
	public readonly nativeCaret = { x: 0, y: 0, width: 0, height: 0 };
	private readonly inlineEditValue = { version: 0, active: false, row: 0, startColumn: 0, endColumn: 0, text: '', preserveCase: false };
	public get inlineEdit(): InlineEditState { return this.inlineEditValue; }
	private readonly visualCursorValue = { row: 0, column: 0, visualIndex: 0 };
	private visualCursorOverride: VisualCursor | null = null;
	public get visualCursor(): VisualCursor | null {
		const value = this.visualCursorOverride;
		return value !== null && value.row === this.view.cursorRow && value.column === this.view.cursorColumn ? value : null;
	}
	public model: EditorTextModel | null = null;
	public view: CodeEditorViewState | null = null;
	private readonly cursorMovedListeners = new Set<CursorMovedListener>();

	public setInlineEdit(row: number, startColumn: number, endColumn: number, text: string, preserveCase = false): boolean {
		const value = this.inlineEditValue;
		if (value.active && value.row === row && value.startColumn === startColumn && value.endColumn === endColumn
			&& value.text === text && value.preserveCase === preserveCase) return false;
		this.clearVisualCursor();
		value.row = row; value.startColumn = startColumn; value.endColumn = endColumn;
		value.text = text; value.preserveCase = preserveCase; value.active = true;
		value.version++;
		return true;
	}

	public clearInlineEdit(): void {
		const value = this.inlineEditValue;
		if (!value.active) return;
		value.active = false;
		value.version++;
	}

	public clearVisualCursor(): void {
		this.visualCursorOverride = null;
	}

	public captureVisualCursor(row: number, column: number, visualIndex: number): void {
		const value = this.visualCursorValue;
		value.row = row; value.column = column; value.visualIndex = visualIndex;
		this.visualCursorOverride = value;
	}

	public attach(model: EditorTextModel, view: CodeEditorViewState): void {
		this.clearInlineEdit();
		this.clearVisualCursor();
		const buffer = model.buffer;
		const lastRow = buffer.getLineCount() - 1;
		view.cursorRow = clamp(view.cursorRow, 0, lastRow);
		const lineLength = buffer.getLineEndOffset(view.cursorRow) - buffer.getLineStartOffset(view.cursorRow);
		view.cursorColumn = clamp(view.cursorColumn, 0, lineLength);
		view.scrollRow = clamp(view.scrollRow, 0, lastRow);
		const anchor = view.selectionAnchor;
		if (anchor !== null) {
			anchor.row = clamp(anchor.row, 0, lastRow);
			const anchorLineLength = buffer.getLineEndOffset(anchor.row) - buffer.getLineStartOffset(anchor.row);
			anchor.column = clamp(anchor.column, 0, anchorLineLength);
		}
		this.model = model;
		this.view = view;
	}

	public detach(): void {
		this.clearInlineEdit();
		this.clearVisualCursor();
		this.model = null;
		this.view = null;
	}

	public onDidMoveCursor(listener: CursorMovedListener): () => void {
		this.cursorMovedListeners.add(listener);
		return () => this.cursorMovedListeners.delete(listener);
	}

	public emitCursorMoved(): void {
		this.clearInlineEdit();
		for (const listener of this.cursorMovedListeners) {
			listener();
		}
	}
}

export const activeCodeEditor = new ActiveCodeEditorState();
