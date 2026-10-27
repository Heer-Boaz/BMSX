import { clearSingleCursorSelection, getSingleCursorSelectionRange, setSingleCursorSelectionAnchor } from '../../../editor/editing/cursor/state';
import { mapTextOffset, type EditorTextChange } from '../../../editor/text/text_change';
import type { CodeEditorInput } from './editor_input';

/** Canonical UTF-16 source offsets, independent of a view's wrapping and viewport. */
export type CodeEditorLocation = {
	cursor: number;
	anchor: number | null;
};

/** Retained view preferences accompany recovery and explicit view copies, not navigation. */
export type CodeEditorViewSnapshot = CodeEditorLocation & {
	readonly scrollRow: number;
	readonly scrollLeft: number;
	readonly wordWrapEnabled: boolean;
};

export function captureCodeEditorLocation(input: CodeEditorInput): CodeEditorLocation {
	const { model, view } = input.context;
	return {
		cursor: model.buffer.offsetAt(view.cursorRow, view.cursorColumn),
		anchor: getSingleCursorSelectionRange(view) === null ? null : model.buffer.offsetAt(view.selectionAnchor.row, view.selectionAnchor.column),
	};
}

export function captureCodeEditorView(input: CodeEditorInput): CodeEditorViewSnapshot {
	const { model, view } = input.context;
	return {
		cursor: model.buffer.offsetAt(view.cursorRow, view.cursorColumn),
		anchor: getSingleCursorSelectionRange(view) === null ? null : model.buffer.offsetAt(view.selectionAnchor.row, view.selectionAnchor.column),
		scrollRow: view.scrollRow, scrollLeft: view.scrollLeft, wordWrapEnabled: view.wordWrapEnabled,
	};
}

export function mapCodeEditorLocation(snapshot: CodeEditorLocation, changes: readonly EditorTextChange[]): void {
	snapshot.cursor = mapTextOffset(snapshot.cursor, changes, 1);
	if (snapshot.anchor !== null) snapshot.anchor = mapTextOffset(snapshot.anchor, changes, 1);
}

export function restoreCodeEditorLocation(input: CodeEditorInput, snapshot: CodeEditorLocation): void {
	const { model, view } = input.context;
	const position = { row: 0, column: 0 };
	// A closed view's reading position can outlive edits from another view.
	model.buffer.positionAt(model.clampOffset(snapshot.cursor), position);
	view.cursorRow = position.row; view.cursorColumn = position.column;
	if (snapshot.anchor === null) clearSingleCursorSelection(view);
	else {
		model.buffer.positionAt(model.clampOffset(snapshot.anchor), position);
		setSingleCursorSelectionAnchor(view, position.row, position.column);
	}
}

export function restoreCodeEditorView(input: CodeEditorInput, snapshot: CodeEditorViewSnapshot): void {
	restoreCodeEditorLocation(input, snapshot);
	const view = input.context.view;
	view.wordWrapEnabled = snapshot.wordWrapEnabled;
	view.scrollRow = snapshot.scrollRow; view.scrollLeft = snapshot.scrollLeft;
}
