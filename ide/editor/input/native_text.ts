import type { TextInputState, TextInputTarget } from '../../../hosts/common/input/text';
import type { CodeEditorControl } from '../ui/code_editor_control';
import { clearSelection, deleteSelection, getSelectionRange, insertText } from '../editing/text_editing_and_selection';
import { setSingleCursorPosition, setSingleCursorSelectionAnchor } from '../editing/cursor/state';
import { resetBlinkState } from '../ui/view/caret/blink';
import { revealCursor, updateDesiredColumn } from '../ui/view/caret/caret';
import { resolveNativeCodeCaret } from '../ui/view/caret/screen_geometry';

/** Native editing borrows the actual source widget; it does not own another document. */
export class CodeEditorTextInput implements TextInputTarget {
	public constructor(private readonly code: CodeEditorControl) {}
	private readonly position = { row: 0, column: 0 };
	public get readOnly(): boolean { return this.code.model.readOnly; }
	public get revision(): number { return this.code.model.version; }
	public caretRect(): CodeEditorControl['nativeCaret'] { return resolveNativeCodeCaret(this.code); }

	public readText(): TextInputState {
		const buffer = this.code.model.buffer, view = this.code.view;
		const selection = getSelectionRange(this.code);
		const startRow = selection === null ? view.cursorRow : selection.start.row;
		const endRow = selection === null ? view.cursorRow : selection.end.row;
		const offset = buffer.getLineStartOffset(startRow), end = buffer.getLineEndOffset(endRow);
		const cursor = buffer.offsetAt(view.cursorRow, view.cursorColumn);
		return { text: buffer.getTextRange(offset, end), offset,
			selectionStart: (selection === null ? cursor : buffer.offsetAt(selection.start.row, selection.start.column)) - offset,
			selectionEnd: (selection === null ? cursor : buffer.offsetAt(selection.end.row, selection.end.column)) - offset };
	}

	public setSelection(from: number, to: number): void {
		const buffer = this.code.model.buffer, view = this.code.view;
		const cursor = buffer.offsetAt(view.cursorRow, view.cursorColumn), anchor = view.selectionAnchor;
		if (cursor === to && (anchor === null ? cursor : buffer.offsetAt(anchor.row, anchor.column)) === from) return;
		this.code.clearVisualCursor();
		clearSelection(this.code);
		buffer.positionAt(to, this.position);
		setSingleCursorPosition(view, this.position.row, this.position.column);
		if (from !== to) {
			buffer.positionAt(from, this.position);
			setSingleCursorSelectionAnchor(view, this.position.row, this.position.column);
		}
		this.code.emitCursorMoved();
		updateDesiredColumn(this.code); resetBlinkState(this.code.caret); revealCursor(this.code);
	}

	public replaceText(from: number, to: number, text: string): boolean {
		if (this.readOnly) return false;
		this.setSelection(from, to);
		if (text.length === 0) deleteSelection(this.code);
		else insertText(this.code, text);
		return true;
	}
}
