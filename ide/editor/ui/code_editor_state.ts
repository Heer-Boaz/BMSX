import { EditorEditStateType, type EditorEditSource } from '../model/edit_state';
import type { Position } from '../../common/models';
import type { EditorTextModel } from '../model/text_model';
import { inputFocus } from '../../input/focus';
import { clearSingleCursorSelection, setSingleCursorSelectionAnchor } from '../editing/cursor/state';

export type CodeEditorSelectionSnapshot = {
	readonly cursorRow: number;
	readonly cursorColumn: number;
	readonly selectionAnchor: Position;
};

/** Payload kind is shared; source identities and command receivers belong to individual views. */
export const codeEditorEditState = new EditorEditStateType<CodeEditorSelectionSnapshot>();

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
	/** Inert mutation/history-command identity, independent of the resource and widget. */
	readonly editSource: EditorEditSource;
	cursorRow: number;
	cursorColumn: number;
	selectionAnchor: Position;
	selectionAnchorScratch: Position;
	desiredColumn: number;
	desiredDisplayOffset: number;
	/** Continuous position in wrapped visual rows, not source buffer rows. */
	scrollRow: number;
	/** Horizontal viewport origin in pixels, including subpixel scroll intent. */
	scrollLeft: number;
};

export type CodeEditorContext = {
	readonly model: EditorTextModel;
	readonly view: CodeEditorViewState;
};

export function createCodeEditorViewState(): CodeEditorViewState {
	return {
		editSource: Symbol('code-view'),
		cursorRow: 0,
		cursorColumn: 0,
		selectionAnchor: null,
		selectionAnchorScratch: { row: 0, column: 0 },
		desiredColumn: 0,
		desiredDisplayOffset: 0,
		scrollRow: 0,
		scrollLeft: 0,
	};
}

/** Text history stores source selection, never another control's scroll/layout coordinates. */
export function captureCodeEditorSelectionSnapshot(view: CodeEditorViewState): CodeEditorSelectionSnapshot {
	const anchor = view.selectionAnchor;
	return { cursorRow: view.cursorRow, cursorColumn: view.cursorColumn,
		selectionAnchor: anchor === null ? null : { row: anchor.row, column: anchor.column } };
}

export function applyCodeEditorSelectionSnapshot(view: CodeEditorViewState, snapshot: CodeEditorSelectionSnapshot): void {
	view.cursorRow = snapshot.cursorRow;
	view.cursorColumn = snapshot.cursorColumn;
	view.desiredColumn = snapshot.cursorColumn;
	view.desiredDisplayOffset = 0;
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
		view.cursorRow = model.clampRow(view.cursorRow);
		view.cursorColumn = model.clampColumn(view.cursorRow, view.cursorColumn);
		const anchor = view.selectionAnchor;
		if (anchor !== null) {
			anchor.row = model.clampRow(anchor.row);
			anchor.column = model.clampColumn(anchor.row, anchor.column);
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
