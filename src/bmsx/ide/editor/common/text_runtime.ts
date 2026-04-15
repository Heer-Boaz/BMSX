import { startSearchJob } from '../contrib/find/editor_search';
import { findCodeTabContext, getActiveCodeTabContext, updateActiveContextDirtyFlag } from '../../workbench/ui/code_tab_contexts';
import { clearForwardNavigationHistory } from '../navigation/navigation_history';
import { handlePostEditMutation, getSelectionRange } from '../editing/text_editing_and_selection';
import { markDiagnosticsDirty } from '../contrib/diagnostics/diagnostics';
import { requestSemanticRefresh, clearReferenceHighlights } from '../contrib/intellisense/intellisense';
import { getTextSnapshot } from '../text/source_text';
import * as runtimeLuaPipeline from '../../../emulator/runtime_lua_pipeline';
import { Runtime } from '../../../emulator/runtime';
import { buildDirtyFilePath } from '../../workbench/common/workspace_io';
import { getWorkspaceCachedSource } from '../../../emulator/workspace_cache';
import { editorDocumentState } from '../editing/editor_document_state';
import { editorViewState } from '../ui/editor_view_state';
import { editorRuntimeState } from './editor_runtime_state';
import { applyCaseOutsideStrings } from '../../common/text_utils';
import { editorSearchState } from '../contrib/find/find_widget_state';

export function normalizeCaseOutsideStrings(text: string): string {
	if (!editorRuntimeState.caseInsensitive || editorRuntimeState.canonicalization === 'none') {
		return text;
	}
	const transform = editorRuntimeState.canonicalization === 'upper'
		? (ch: string) => ch.toUpperCase()
		: (ch: string) => ch.toLowerCase();
	return applyCaseOutsideStrings(text, transform);
}

export function capturePreMutationSource(): void {
	if (!editorRuntimeState.caseInsensitive) {
		return;
	}
	if (editorDocumentState.preMutationSource === null) {
		editorDocumentState.preMutationSource = getTextSnapshot(editorDocumentState.buffer);
	}
}

export function bumpTextVersion(): void {
	editorDocumentState.textVersion = editorDocumentState.buffer.version;
}

export function markTextMutated(): void {
	const record = editorDocumentState.undoStack[editorDocumentState.undoStack.length - 1];
	const anchor = editorDocumentState.selectionAnchor;
	record.setAfterState(
		editorDocumentState.cursorRow,
		editorDocumentState.cursorColumn,
		editorViewState.scrollRow,
		editorViewState.scrollColumn,
		anchor ? anchor.row : 0,
		anchor ? anchor.column : 0,
		anchor !== null,
	);
	editorDocumentState.saveGeneration += 1;
	editorDocumentState.dirty = editorDocumentState.undoStack.length !== editorDocumentState.savePointDepth;
	const context = getActiveCodeTabContext();
	if (context) {
		context.saveGeneration = editorDocumentState.saveGeneration;
	}
	editorViewState.maxLineLengthDirty = true;
	markDiagnosticsDirty(getActiveCodeTabContext().id);
	bumpTextVersion();
	clearReferenceHighlights();
	updateActiveContextDirtyFlag();
	editorViewState.layout.ensureVisualLinesDirty();
	requestSemanticRefresh();
	clearForwardNavigationHistory();
	handlePostEditMutation();
	if (editorSearchState.query.length > 0) startSearchJob();
}

export function getSourceForChunk(path: string): string {
	const asset = runtimeLuaPipeline.resolveLuaSourceRecord(Runtime.instance, path);
	const context = findCodeTabContext(path);
	if (context) {
		if (context.id === getActiveCodeTabContext().id) {
			return getTextSnapshot(editorDocumentState.buffer);
		}
		return getTextSnapshot(context.buffer);
	}
	const dirtyPath = buildDirtyFilePath(asset.source_path);
	const cached = getWorkspaceCachedSource(asset.source_path) ?? getWorkspaceCachedSource(dirtyPath);
	if (cached !== null) {
		return cached;
	}
	return asset.src;
}

export function invalidateLineRange(startRow: number, endRow: number): void {
	let from = Math.min(startRow, endRow);
	let to = Math.max(startRow, endRow);
	from = editorViewState.layout.clampBufferRow(editorDocumentState.buffer, from);
	to = editorViewState.layout.clampBufferRow(editorDocumentState.buffer, to);
	for (let row = from; row <= to; row += 1) {
		editorViewState.layout.invalidateLine(row);
	}
}

export function getLineRangeForMovement(): { startRow: number; endRow: number } {
	const range = getSelectionRange();
	if (!range) {
		return { startRow: editorDocumentState.cursorRow, endRow: editorDocumentState.cursorRow };
	}
	let endRow = range.end.row;
	if (range.end.column === 0 && endRow > range.start.row) {
		endRow -= 1;
	}
	return { startRow: range.start.row, endRow };
}
