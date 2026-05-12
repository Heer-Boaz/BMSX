// disable cross_layer_import_pattern -- workspace context snapshots own the editor/workbench state handoff for autosave and restore.
import { clamp_safe } from '../../../common/clamp';
import type { CodeTabContext, EditorSnapshot, Position } from '../../common/models';
import { editorDocumentState } from '../../editor/editing/document_state';
import { restoreSnapshot } from '../../editor/editing/undo_controller';
import { editorViewState } from '../../editor/ui/view/state';
import { getTextSnapshot } from '../../editor/text/source_text';
import type { SnapshotMetadata } from './models';
import { getActiveCodeTabContextId, setTabDirty, updateActiveContextDirtyFlag } from '../ui/code_tab/contexts';
import { getActiveTabId } from '../ui/tabs';

type EditHistoryState = {
	undoStack: { length: number };
	redoStack: { length: number };
	lastHistoryKey: unknown;
	lastHistoryTimestamp: number;
	savePointDepth: number;
};

function clearEditHistory(state: EditHistoryState): void {
	state.undoStack.length = 0;
	state.redoStack.length = 0;
	state.lastHistoryKey = null;
	state.lastHistoryTimestamp = 0;
	state.savePointDepth = 0;
}

function isActiveCodeContext(context: CodeTabContext): boolean {
	return getActiveCodeTabContextId() === context.id && getActiveTabId() === context.id;
}

export function applySourceToContext(context: CodeTabContext, source: string, metadata?: SnapshotMetadata): void {
	context.buffer.replace(0, context.buffer.length, source);
	context.textVersion = context.buffer.version;
	clearEditHistory(context);
	if (isActiveCodeContext(context)) {
		clearEditHistory(editorDocumentState);
	}
	const snapshot = buildSnapshotFromBuffer(context, metadata);
	context.cursorRow = snapshot.cursorRow;
	context.cursorColumn = snapshot.cursorColumn;
	context.scrollRow = snapshot.scrollRow;
	context.scrollColumn = snapshot.scrollColumn;
	context.selectionAnchor = snapshot.selectionAnchor;
}

export function buildSnapshotFromBuffer(context: CodeTabContext, metadata?: SnapshotMetadata): EditorSnapshot {
	const buffer = context.buffer;
	const lastRow = buffer.getLineCount() - 1;
	const cursorRow = clamp_safe(metadata?.cursorRow, 0, lastRow);
	const cursorLen = buffer.getLineEndOffset(cursorRow) - buffer.getLineStartOffset(cursorRow);
	const cursorColumn = clamp_safe(metadata?.cursorColumn, 0, cursorLen);
	const anchor = metadata?.selectionAnchor;
	let selectionAnchor: Position = null;
	if (anchor) {
		const anchorRow = clamp_safe(anchor.row ?? 0, 0, lastRow);
		const anchorLen = buffer.getLineEndOffset(anchorRow) - buffer.getLineStartOffset(anchorRow);
		const anchorColumn = clamp_safe(anchor.column ?? 0, 0, anchorLen);
		selectionAnchor = { row: anchorRow, column: anchorColumn };
	}
	return {
		cursorRow,
		cursorColumn,
		scrollRow: clamp_safe(metadata?.scrollRow, 0, lastRow),
		scrollColumn: metadata?.scrollColumn ?? 0,
		selectionAnchor,
		textVersion: metadata?.textVersion ?? buffer.version,
	};
}

export function resetWorkspaceActiveDocumentDirtyBufferState(): void {
	editorDocumentState.saveGeneration = editorDocumentState.appliedGeneration;
	editorDocumentState.dirty = false;
	clearEditHistory(editorDocumentState);
}

export function clearWorkspaceActiveDocumentSessionState(): void {
	clearEditHistory(editorDocumentState);
	editorDocumentState.dirty = false;
}

export function resetWorkspaceContextToCleanSource(context: CodeTabContext, source: string): void {
	applySourceToContext(context, source);
	context.dirty = false;
	context.saveGeneration = editorDocumentState.saveGeneration;
	context.appliedGeneration = editorDocumentState.appliedGeneration;
	context.lastSavedSource = source;
	setTabDirty(context.id, false);
	if (isActiveCodeContext(context)) {
		restoreSnapshot(buildSnapshotFromBuffer(context), { preserveScroll: false });
		updateActiveContextDirtyFlag();
	}
}

export function clearWorkspaceContextSessionState(context: CodeTabContext): void {
	clearEditHistory(context);
	context.dirty = false;
	setTabDirty(context.id, false);
}

export function restoreWorkspaceContextSource(context: CodeTabContext, source: string, metadata: SnapshotMetadata, dirty: boolean): void {
	applySourceToContext(context, source, metadata);
	if (dirty) {
		context.dirty = true;
		context.savePointDepth = -1;
	} else {
		context.lastSavedSource = source;
		context.dirty = false;
		context.savePointDepth = context.undoStack.length;
	}
	setTabDirty(context.id, dirty);
	if (isActiveCodeContext(context)) {
		restoreSnapshot(buildSnapshotFromBuffer(context, metadata), { preserveScroll: true });
		editorDocumentState.savePointDepth = context.savePointDepth;
		editorDocumentState.dirty = dirty;
		updateActiveContextDirtyFlag();
	}
}

export function captureContextText(context: CodeTabContext): string {
	if (context.id === getActiveCodeTabContextId()) {
		return getTextSnapshot(editorDocumentState.buffer);
	}
	return getTextSnapshot(context.buffer);
}

export function captureContextSnapshotMetadata(context: CodeTabContext): SnapshotMetadata {
	if (context.id === getActiveCodeTabContextId()) {
		return {
			cursorRow: editorDocumentState.cursorRow,
			cursorColumn: editorDocumentState.cursorColumn,
			scrollRow: editorViewState.scrollRow,
			scrollColumn: editorViewState.scrollColumn,
			selectionAnchor: editorDocumentState.selectionAnchor ? { row: editorDocumentState.selectionAnchor.row, column: editorDocumentState.selectionAnchor.column } : null,
			textVersion: editorDocumentState.textVersion,
		};
	}
	return {
		cursorRow: context.cursorRow,
		cursorColumn: context.cursorColumn,
		scrollRow: context.scrollRow,
		scrollColumn: context.scrollColumn,
		selectionAnchor: context.selectionAnchor ? { row: context.selectionAnchor.row, column: context.selectionAnchor.column } : null,
		textVersion: context.textVersion,
	};
}
