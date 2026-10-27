import { EditorEditStateType, type EditorEditSource } from '../model/edit_state';
import type { Position } from '../../common/models';
import type { EditorTextModel } from '../model/text_model';
import { clearSingleCursorSelection, setSingleCursorSelectionAnchor } from '../editing/cursor/state';

export type CodeEditorSelectionSnapshot = {
	readonly cursorRow: number;
	readonly cursorColumn: number;
	readonly selectionAnchor: Position;
};

/** Payload kind is shared; source identities and command receivers belong to individual views. */
export const codeEditorEditState = new EditorEditStateType<CodeEditorSelectionSnapshot>();

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
	/** Retained presentation choice for this Source view, not its shared document. */
	wordWrapEnabled: boolean;
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
		wordWrapEnabled: true,
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
