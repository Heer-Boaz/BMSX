import { clamp_safe } from '../../../common/clamp';
import type { CodeTabContext, EditorSnapshot, Position } from '../../common/types';
import { editorDocumentState } from '../../editor/editing/editor_document_state';
import { editorViewState } from '../../editor/ui/editor_view_state';
import { getTextSnapshot } from '../../editor/text/source_text';
import type { SnapshotMetadata } from './workspace_types';
import { getActiveCodeTabContextId } from '../ui/code_tab_contexts';
import { getActiveTabId } from '../ui/tabs';

export function applySourceToContext(context: CodeTabContext, source: string, metadata?: SnapshotMetadata): void {
	context.buffer.replace(0, context.buffer.length, source);
	context.textVersion = context.buffer.version;
	context.undoStack.length = 0;
	context.redoStack.length = 0;
	context.lastHistoryKey = null;
	context.lastHistoryTimestamp = 0;
	context.savePointDepth = 0;
	if (getActiveCodeTabContextId() === context.id && getActiveTabId() === context.id) {
		editorDocumentState.undoStack.length = 0;
		editorDocumentState.redoStack.length = 0;
		editorDocumentState.lastHistoryKey = null;
		editorDocumentState.lastHistoryTimestamp = 0;
		editorDocumentState.savePointDepth = 0;
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
	const lastRow = Math.max(0, buffer.getLineCount() - 1);
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
		scrollColumn: Math.max(0, metadata?.scrollColumn ?? 0),
		selectionAnchor,
		textVersion: metadata?.textVersion ?? buffer.version,
	};
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
