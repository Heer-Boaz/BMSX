import type { Position } from '../../../common/models';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';

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
export class TextField<T = unknown> {
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
	private readonly undoStack: TextFieldRevision<T>[] = [];
	private readonly redoStack: TextFieldRevision<T>[] = [];
	private readonly changeListeners = new Set<() => void>();

	public constructor(parent: InputFocusTarget | null = null) {
		this.focusTarget = inputFocus.createTarget(parent);
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
