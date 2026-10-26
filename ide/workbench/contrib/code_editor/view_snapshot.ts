import { clearSingleCursorSelection, getSingleCursorSelectionRange, setSingleCursorSelectionAnchor } from '../../../editor/editing/cursor/state';
import { mapTextOffset, type EditorTextChange } from '../../../editor/text/text_change';
import type { CodeEditorInput } from './editor_input';
import { clamp } from '../../../../machine/ts/common/clamp';

/** UTF-16 source locations plus code-view coordinates; no widget or subscription. */
export type CodeEditorLocation = {
	cursor: number;
	anchor: number | null;
	readonly scrollRow: number;
	readonly scrollLeft: number;
};

export function captureCodeEditorView(input: CodeEditorInput): CodeEditorLocation {
	const { model, view } = input.context;
	return {
		cursor: model.buffer.offsetAt(view.cursorRow, view.cursorColumn),
		anchor: getSingleCursorSelectionRange(view) === null ? null : model.buffer.offsetAt(view.selectionAnchor.row, view.selectionAnchor.column),
		scrollRow: view.scrollRow, scrollLeft: view.scrollLeft,
	};
}

export function mapCodeEditorView(snapshot: CodeEditorLocation, changes: readonly EditorTextChange[]): void {
	snapshot.cursor = mapTextOffset(snapshot.cursor, changes, 1);
	if (snapshot.anchor !== null) snapshot.anchor = mapTextOffset(snapshot.anchor, changes, 1);
}

export function restoreCodeEditorView(input: CodeEditorInput, snapshot: CodeEditorLocation): void {
	const { model, view } = input.context;
	const position = { row: 0, column: 0 };
	// A closed view's reading position can outlive edits from another view.
	model.buffer.positionAt(clamp(snapshot.cursor, 0, model.buffer.length), position);
	view.cursorRow = position.row; view.cursorColumn = position.column;
	if (snapshot.anchor === null) clearSingleCursorSelection(view);
	else {
		model.buffer.positionAt(clamp(snapshot.anchor, 0, model.buffer.length), position);
		setSingleCursorSelectionAnchor(view, position.row, position.column);
	}
	view.scrollRow = snapshot.scrollRow; view.scrollLeft = snapshot.scrollLeft;
}
