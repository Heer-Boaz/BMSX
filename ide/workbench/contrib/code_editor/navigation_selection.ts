import { ensureVisualLines } from '../../../editor/common/text/layout';
import { EditorPaneSelection } from '../../services/editor/editor_selection';
import type { CodeEditorInput } from './editor_input';
import { mapTextOffset } from '../../../editor/text/text_change';
import { clearSingleCursorSelection, getSingleCursorSelectionRange, setSingleCursorSelectionAnchor } from '../../../editor/editing/cursor/state';
import { clearEditorPointerSelectionState } from '../../../input/pointer/state';
import { updateDesiredColumn } from '../../../editor/ui/view/caret/caret';
import { resetBlink } from '../../../editor/render/caret';
import { activeCodeEditor } from '../../../editor/ui/code_editor_state';

/** A live text location, not an undo snapshot or a reference to a mutable view. */
export class CodeEditorNavigationSelection extends EditorPaneSelection {
	public cursor: number;
	public anchor: number | null;
	public readonly scrollRow: number;
	public readonly scrollColumn: number;

	public constructor(input: CodeEditorInput) {
		super();
		const { model, view } = input.context;
		this.cursor = model.buffer.offsetAt(view.cursorRow, view.cursorColumn);
		this.anchor = getSingleCursorSelectionRange(view) === null ? null : model.buffer.offsetAt(view.selectionAnchor.row, view.selectionAnchor.column);
		this.scrollRow = view.scrollRow;
		this.scrollColumn = view.scrollColumn;
		this.add({ dispose: model.onDidChangeContent(event => {
			this.cursor = mapTextOffset(this.cursor, event.changes, 1);
			if (this.anchor !== null) this.anchor = mapTextOffset(this.anchor, event.changes, 1);
		}) });
	}

	public matches(other: CodeEditorNavigationSelection): boolean {
		return this.cursor === other.cursor && this.anchor === other.anchor;
	}

	public restore(input: CodeEditorInput): void {
		const { model, view } = input.context;
		const position = { row: 0, column: 0 };
		model.buffer.positionAt(this.cursor, position);
		view.cursorRow = position.row;
		view.cursorColumn = position.column;
		if (this.anchor === null) clearSingleCursorSelection(view);
		else {
			model.buffer.positionAt(this.anchor, position);
			setSingleCursorSelectionAnchor(view, position.row, position.column);
		}
		view.scrollRow = this.scrollRow;
		view.scrollColumn = this.scrollColumn;
		ensureVisualLines();
		clearEditorPointerSelectionState();
		updateDesiredColumn();
		resetBlink();
		activeCodeEditor.emitCursorMoved();
	}
}
