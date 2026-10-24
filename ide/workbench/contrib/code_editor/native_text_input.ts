import type { TextInputState, TextInputTarget } from '../../../../hosts/common/input/text';
import { activeCodeEditor } from '../../../editor/ui/code_editor_state';
import { clearSelection, deleteSelection, getSelectionRange, insertText } from '../../../editor/editing/text_editing_and_selection';
import { setSingleCursorPosition, setSingleCursorSelectionAnchor } from '../../../editor/editing/cursor/state';
import { resetBlink } from '../../../editor/render/caret';
import { revealCursor, updateDesiredColumn } from '../../../editor/ui/view/caret/caret';

/** Native editing borrows the actual source widget; it does not own another document. */
export class CodeEditorTextInput implements TextInputTarget {
	private readonly position = { row: 0, column: 0 };
	public get readOnly(): boolean { return activeCodeEditor.model.readOnly; }
	public get revision(): number { return activeCodeEditor.model.version; }
	public caretRect(): typeof activeCodeEditor.nativeCaret { return activeCodeEditor.nativeCaret; }

	public readText(): TextInputState {
		const buffer = activeCodeEditor.model.buffer, view = activeCodeEditor.view;
		const selection = getSelectionRange();
		const startRow = selection === null ? view.cursorRow : selection.start.row;
		const endRow = selection === null ? view.cursorRow : selection.end.row;
		const offset = buffer.getLineStartOffset(startRow), end = buffer.getLineEndOffset(endRow);
		const cursor = buffer.offsetAt(view.cursorRow, view.cursorColumn);
		return { text: buffer.getTextRange(offset, end), offset,
			selectionStart: (selection === null ? cursor : buffer.offsetAt(selection.start.row, selection.start.column)) - offset,
			selectionEnd: (selection === null ? cursor : buffer.offsetAt(selection.end.row, selection.end.column)) - offset };
	}

	public setSelection(from: number, to: number): void {
		const buffer = activeCodeEditor.model.buffer, view = activeCodeEditor.view;
		const cursor = buffer.offsetAt(view.cursorRow, view.cursorColumn), anchor = view.selectionAnchor;
		if (cursor === to && (anchor === null ? cursor : buffer.offsetAt(anchor.row, anchor.column)) === from) return;
		activeCodeEditor.clearVisualCursor();
		clearSelection();
		buffer.positionAt(to, this.position);
		setSingleCursorPosition(view, this.position.row, this.position.column);
		if (from !== to) {
			buffer.positionAt(from, this.position);
			setSingleCursorSelectionAnchor(view, this.position.row, this.position.column);
		}
		activeCodeEditor.emitCursorMoved();
		updateDesiredColumn(); resetBlink(); revealCursor();
	}

	public replaceText(from: number, to: number, text: string): boolean {
		if (this.readOnly) return false;
		this.setSelection(from, to);
		if (text.length === 0) deleteSelection();
		else insertText(text);
		return true;
	}
}
