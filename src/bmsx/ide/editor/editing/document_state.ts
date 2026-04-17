import type { CodeTabContext, Position } from '../../common/models';
import type { TextBuffer } from '../text/text_buffer';
import { PieceTreeBuffer } from '../text/piece_tree_buffer';
import type { EditorUndoRecord } from '../text/undo';

export type EditorDocumentState = {
	buffer: TextBuffer;
	cursorRow: number;
	cursorColumn: number;
	preMutationSource: string;
	dirty: boolean;
	desiredColumn: number;
	desiredDisplayOffset: number;
	selectionAnchor: Position;
	selectionAnchorScratch: Position;
	undoStack: EditorUndoRecord[];
	redoStack: EditorUndoRecord[];
	lastHistoryKey: string;
	lastHistoryTimestamp: number;
	savePointDepth: number;
	textVersion: number;
	lastContentEditAtMs: number;
	saveGeneration: number;
	appliedGeneration: number;
	lastSavedSource: string;
	customClipboard: string;
};

export const editorDocumentState: EditorDocumentState = {
	buffer: new PieceTreeBuffer(''),
	cursorRow: 0,
	cursorColumn: 0,
	preMutationSource: null,
	dirty: false,
	desiredColumn: 0,
	desiredDisplayOffset: 0,
	selectionAnchor: null,
	selectionAnchorScratch: { row: 0, column: 0 },
	undoStack: [],
	redoStack: [],
	lastHistoryKey: null,
	lastHistoryTimestamp: 0,
	savePointDepth: 0,
	textVersion: 0,
	lastContentEditAtMs: null,
	saveGeneration: 0,
	appliedGeneration: 0,
	lastSavedSource: '',
	customClipboard: null,
};

export function restoreDocumentStateFromContext(context: CodeTabContext): void {
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

export function storeDocumentStateInContext(context: CodeTabContext): void {
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
