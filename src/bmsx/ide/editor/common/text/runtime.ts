import { startSearchJob } from '../../contrib/find/search';
import { getActiveCodeTabContext, updateActiveContextDirtyFlag } from '../../../workbench/ui/code_tab/contexts';
import { clearForwardNavigationHistory } from '../../navigation/navigation_history';
import { handlePostEditMutation } from '../../editing/text_editing_and_selection';
import { markDiagnosticsDirty } from '../../contrib/diagnostics/analysis';
import { requestSemanticRefresh, clearReferenceHighlights } from '../../contrib/intellisense/engine';
import { getTextSnapshot } from '../../text/source_text';
import { editorDocumentState } from '../../editing/document_state';
import { editorViewState } from '../../ui/view/state';
import { editorRuntimeState } from '../runtime_state';
import { editorSearchState } from '../../contrib/find/widget_state';

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

export function invalidateLineRange(startRow: number, endRow: number): void {
	let from = Math.min(startRow, endRow);
	let to = Math.max(startRow, endRow);
	from = editorViewState.layout.clampBufferRow(editorDocumentState.buffer, from);
	to = editorViewState.layout.clampBufferRow(editorDocumentState.buffer, to);
	for (let row = from; row <= to; row += 1) {
		editorViewState.layout.invalidateLine(row);
	}
}
