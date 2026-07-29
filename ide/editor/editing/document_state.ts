import type { EditContext, Position } from '../../common/models';
import type { RuntimeResource } from '../../common/resource';
import type { TextBuffer } from '../text/text_buffer';
import { PieceTreeBuffer } from '../text/piece_tree_buffer';
import type { EditorUndoRecord } from '../text/undo';

type CursorMovedListener = () => void;
type TextMutatedListener = (edit: EditContext) => void;

export type EditorDocumentMode = 'lua' | 'aem';

export type EditorDocumentContext = {
	id: string;
	resource: RuntimeResource;
	mode: EditorDocumentMode;
	buffer: TextBuffer;
	cursorRow: number;
	cursorColumn: number;
	selectionAnchor: Position;
	lastSavedSource: string;
	saveGeneration: number;
	appliedGeneration: number;
	undoStack: EditorUndoRecord[];
	redoStack: EditorUndoRecord[];
	lastHistoryKey: string;
	lastHistoryTimestamp: number;
	savePointDepth: number;
	dirty: boolean;
	textVersion: number;
};

export class EditorDocumentState {
	public contextId: string;
	public resource: RuntimeResource;
	public mode: EditorDocumentMode;
	public readOnly: boolean;
	public buffer: TextBuffer = new PieceTreeBuffer('');
	public cursorRow = 0;
	public cursorColumn = 0;
	public preMutationSource: string = null;
	public dirty = false;
	public desiredColumn = 0;
	public desiredDisplayOffset = 0;
	public selectionAnchor: Position = null;
	public selectionAnchorScratch: Position = { row: 0, column: 0 };
	public undoStack: EditorUndoRecord[] = [];
	public redoStack: EditorUndoRecord[] = [];
	public lastHistoryKey: string = null;
	public lastHistoryTimestamp = 0;
	public savePointDepth = 0;
	public textVersion = 0;
	public lastContentEditAtMs = -1;
	public saveGeneration = 0;
	public appliedGeneration = 0;
	public lastSavedSource = '';
	public customClipboard: string = null;
	private readonly cursorMovedListeners = new Set<CursorMovedListener>();
	private readonly textMutatedListeners = new Set<TextMutatedListener>();

	public onCursorMoved(listener: CursorMovedListener): () => void {
		this.cursorMovedListeners.add(listener);
		return () => this.cursorMovedListeners.delete(listener);
	}

	public emitCursorMoved(): void {
		for (const listener of this.cursorMovedListeners) {
			listener();
		}
	}

	public onTextMutated(listener: TextMutatedListener): () => void {
		this.textMutatedListeners.add(listener);
		return () => this.textMutatedListeners.delete(listener);
	}

	public emitTextMutated(edit: EditContext): void {
		for (const listener of this.textMutatedListeners) {
			listener(edit);
		}
	}
}

export const editorDocumentState = new EditorDocumentState();

export function restoreDocumentStateFromContext(context: EditorDocumentContext): void {
	editorDocumentState.contextId = context.id;
	editorDocumentState.resource = context.resource;
	editorDocumentState.mode = context.mode;
	editorDocumentState.readOnly = !!context.resource.source.generated;
	editorDocumentState.buffer = context.buffer;
	editorDocumentState.cursorRow = context.cursorRow;
	editorDocumentState.cursorColumn = context.cursorColumn;
	editorDocumentState.selectionAnchor = context.selectionAnchor;
	editorDocumentState.textVersion = context.buffer.version;
	context.textVersion = editorDocumentState.textVersion;
	editorDocumentState.saveGeneration = context.saveGeneration;
	editorDocumentState.appliedGeneration = context.appliedGeneration;
	editorDocumentState.lastSavedSource = context.lastSavedSource;
	editorDocumentState.undoStack = context.undoStack;
	editorDocumentState.redoStack = context.redoStack;
	editorDocumentState.lastHistoryKey = context.lastHistoryKey;
	editorDocumentState.lastHistoryTimestamp = context.lastHistoryTimestamp;
	editorDocumentState.savePointDepth = context.savePointDepth;
	editorDocumentState.dirty = editorDocumentState.undoStack.length !== editorDocumentState.savePointDepth;
}

export function storeDocumentStateInContext(context: EditorDocumentContext): void {
	context.buffer = editorDocumentState.buffer;
	context.cursorRow = editorDocumentState.cursorRow;
	context.cursorColumn = editorDocumentState.cursorColumn;
	context.selectionAnchor = editorDocumentState.selectionAnchor;
	context.textVersion = editorDocumentState.textVersion;
	context.saveGeneration = editorDocumentState.saveGeneration;
	context.appliedGeneration = editorDocumentState.appliedGeneration;
	context.undoStack = editorDocumentState.undoStack;
	context.redoStack = editorDocumentState.redoStack;
	context.lastHistoryKey = editorDocumentState.lastHistoryKey;
	context.lastHistoryTimestamp = editorDocumentState.lastHistoryTimestamp;
	context.savePointDepth = editorDocumentState.savePointDepth;
	context.dirty = editorDocumentState.dirty;
}

export function syncDocumentDirtyState(): void {
	editorDocumentState.dirty = editorDocumentState.undoStack.length !== editorDocumentState.savePointDepth;
}

export function resetDocumentHistoryState(): void {
	editorDocumentState.undoStack.length = 0;
	editorDocumentState.redoStack.length = 0;
	editorDocumentState.lastHistoryKey = null;
	editorDocumentState.lastHistoryTimestamp = 0;
	editorDocumentState.savePointDepth = 0;
}
