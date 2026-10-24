import type { InlineInputOptions, Position } from '../../../common/models';
import type { ClipboardContents, ClipboardImage, ClipboardTarget } from '../../../../hosts/common/clipboard';
import { inputFocus, type InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import { deleteSelection, pasteFieldText, selectedText, getCursorOffset, selectionAnchorOffset,
	setCursorFromOffset, setSelectionAnchorFromOffset, clearSelection } from './text_field';
import { showEditorMessage } from '../../../common/feedback_state';
import type { TextInputTarget, TextInputState } from '../../../../hosts/common/input/text';

export type TextFieldAnnotation<T = unknown> = { from: number; to: number; data: T };

type TextFieldRevision<T> = {
	annotations: readonly TextFieldAnnotation<T>[];
	text: string;
	cursorRow: number;
	cursorColumn: number;
	anchorRow: number;
	anchorColumn: number;
};

/** Small input-control history, independent of resource-owned document history. */
export class TextField<T = unknown> implements ClipboardTarget, TextInputTarget {
	public revision = 0;
	public readonly nativeCaret = { x: 0, y: 0, width: 0, height: 0 };
	public annotations: readonly TextFieldAnnotation<T>[] = [];
	public readOnly = false;
	public text = '';
	/** Exact LF-delimited slices: CR bytes remain part of the field's UTF-16 positions. */
	public lines = [''];
	public cursorRow = 0;
	public cursorColumn = 0;
	public selectionAnchor: Position | null = null;
	public readonly selectionAnchorScratch = { row: 0, column: 0 };
	public desiredColumn = 0;
	public pointerSelecting = false;
	public lastPointerClickTimeMs = 0;
	public lastPointerClickColumn = -1;
	public readonly focusTarget: InputFocusTarget;
	public pasteImages: ((images: readonly ClipboardImage[]) => void) | undefined;
	private readonly undoStack: TextFieldRevision<T>[] = [];
	private readonly redoStack: TextFieldRevision<T>[] = [];
	private readonly changeListeners = new Set<() => void>();

	public constructor(parent: InputFocusTarget | null = null, public readonly options: InlineInputOptions = { allowSpace: true }, scope?: InputFocusScope) {
		this.focusTarget = inputFocus.createTarget(parent, scope);
		this.focusTarget.clipboard = this;
		this.focusTarget.textInput = this;
		this.focusTarget.registerCommand('undo', {
			isEnabled: () => this.canUndo,
			run: () => this.undo(),
		});
		this.focusTarget.registerCommand('redo', {
			isEnabled: () => this.canRedo,
			run: () => this.redo(),
		});
		this.focusTarget.onDidBlur(() => { this.pointerSelecting = false; });
	}

	public readText(): TextInputState {
		const cursor = getCursorOffset(this), anchor = selectionAnchorOffset(this) ?? cursor;
		return { text: this.text, selectionStart: Math.min(cursor, anchor), selectionEnd: Math.max(cursor, anchor), offset: 0 };
	}

	public setSelection(from: number, to: number): void {
		if (getCursorOffset(this) === to && (selectionAnchorOffset(this) ?? to) === from) return;
		clearSelection(this);
		setCursorFromOffset(this, to);
		if (from !== to) setSelectionAnchorFromOffset(this, from);
	}

	public replaceText(from: number, to: number, text: string): boolean {
		if (this.readOnly) return false;
		this.setSelection(from, to);
		if (text.length !== 0) return pasteFieldText(this, text);
		deleteSelection(this);
		return true;
	}

	public caretRect(): typeof this.nativeCaret { return this.nativeCaret; }

	public copy(): string | null { return selectedText(this); }
	public cut(): void { deleteSelection(this); }
	public paste(contents: ClipboardContents): void {
		if (this.readOnly) return;
		if (contents.images.length > 0 && this.pasteImages !== undefined) this.pasteImages(contents.images);
		else if (contents.text.length > 0) pasteFieldText(this, contents.text);
		else if (contents.images.length > 0) showEditorMessage('This field accepts text, not images.', 'warning', 4);
	}

	public get canUndo(): boolean {
		return !this.readOnly && this.undoStack.length > 0;
	}

	public get canRedo(): boolean {
		return !this.readOnly && this.redoStack.length > 0;
	}

	public onDidChangeText(listener: () => void): () => void {
		this.changeListeners.add(listener);
		return () => this.changeListeners.delete(listener);
	}

	public recordEdit(): void {
		this.undoStack.push(this.captureRevision());
		this.redoStack.length = 0;
	}

	public clearHistory(): void {
		this.undoStack.length = 0;
		this.redoStack.length = 0;
	}

	public didChangeText(change?: { from: number; to: number; insertedLength: number }, inserted?: TextFieldAnnotation<T>): void {
		this.revision += 1;
		if (change && this.annotations.length > 0) {
			const shift = change.insertedLength - (change.to - change.from);
			const mapped: TextFieldAnnotation<T>[] = [];
			for (const annotation of this.annotations) {
				if (annotation.to <= change.from) mapped.push(annotation);
				else if (annotation.from >= change.to) mapped.push({ ...annotation, from: annotation.from + shift, to: annotation.to + shift });
				// Editing through an inline reference removes its semantic attachment.
			}
			this.annotations = mapped;
		}
		if (inserted) this.annotations = [...this.annotations, inserted].sort((a, b) => a.from - b.from);
		for (const listener of this.changeListeners) listener();
	}

	public undo(): void {
		if (!this.canUndo) return;
		this.redoStack.push(this.captureRevision());
		this.restoreRevision(this.undoStack.pop()!);
	}

	public redo(): void {
		if (!this.canRedo) return;
		this.undoStack.push(this.captureRevision());
		this.restoreRevision(this.redoStack.pop()!);
	}

	private captureRevision(): TextFieldRevision<T> {
		return {
			annotations: this.annotations,
			text: this.text,
			cursorRow: this.cursorRow,
			cursorColumn: this.cursorColumn,
			anchorRow: this.selectionAnchor === null ? -1 : this.selectionAnchor.row,
			anchorColumn: this.selectionAnchor === null ? -1 : this.selectionAnchor.column,
		};
	}

	private restoreRevision(revision: TextFieldRevision<T>): void {
		this.text = revision.text; this.annotations = revision.annotations;
		this.lines = revision.text.split('\n');
		this.cursorRow = revision.cursorRow;
		this.cursorColumn = revision.cursorColumn;
		this.desiredColumn = revision.cursorColumn;
		this.selectionAnchorScratch.row = revision.anchorRow;
		this.selectionAnchorScratch.column = revision.anchorColumn;
		this.selectionAnchor = revision.anchorRow < 0 ? null : this.selectionAnchorScratch;
		this.pointerSelecting = false;
		this.didChangeText();
	}
}
