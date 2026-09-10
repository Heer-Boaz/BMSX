import { DisposableStore } from '../../common/lifecycle';
import type { EditorTextModel } from '../model/text_model';
import { mapTextOffset } from '../text/text_change';
import { applyCodeEditorViewSnapshot, codeEditorEditState, type CodeEditorViewState } from './code_editor_state';
import { clearSingleCursorSelection, getSingleCursorSelectionRange, setSingleCursorSelectionAnchor } from '../editing/cursor/state';

/**
 * A retained code view tracks model edits, even when no code pane is attached.
 * Explicit code edit state wins; external edits map positions like editor markers.
 * Visual scroll rows are layout coordinates, never text-buffer row numbers.
 */
export class CodeEditorViewBinding extends DisposableStore {
	private cursorOffset = 0;
	private anchorOffset: number | null = null;
	private readonly position = { row: 0, column: 0 };

	public constructor(model: EditorTextModel, view: CodeEditorViewState) {
		super();
		this.add({ dispose: model.onWillChangeContent(() => {
			this.cursorOffset = model.buffer.offsetAt(view.cursorRow, view.cursorColumn);
			this.anchorOffset = getSingleCursorSelectionRange(view) === null ? null : model.buffer.offsetAt(view.selectionAnchor.row, view.selectionAnchor.column);
		}) });
		this.add({ dispose: model.onDidChangeContent(event => {
			const state = event.editState;
			if (state !== null && state.is(codeEditorEditState)) {
				applyCodeEditorViewSnapshot(view, state.value);
				return;
			}
			const anchor = this.anchorOffset;
			const forward = anchor !== null && anchor < this.cursorOffset;
			const cursor = mapTextOffset(this.cursorOffset, event.changes, anchor === null || forward ? -1 : 1);
			model.buffer.positionAt(cursor, this.position);
			view.cursorRow = this.position.row;
			view.cursorColumn = this.position.column;
			view.desiredColumn = view.cursorColumn;
			view.desiredDisplayOffset = 0;
			if (anchor === null) clearSingleCursorSelection(view);
			else {
				const mapped = mapTextOffset(anchor, event.changes, forward ? 1 : -1);
				model.buffer.positionAt(forward ? Math.min(mapped, cursor) : Math.max(mapped, cursor), this.position);
				setSingleCursorSelectionAnchor(view, this.position.row, this.position.column);
			}
		}) });
	}
}
