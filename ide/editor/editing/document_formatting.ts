import { extractErrorMessage } from '../../common/errors';
import { showEditorMessage } from '../../common/feedback_state';
import { changedTextRange } from '../../common/text';
import { formatAemDocument } from '../../language/aem/editor';
import { createLuaDocumentFormattingEdits } from '../../language/lua/formatter';
import { clearForwardNavigationHistory } from '../../navigation/navigation_history';
import type { EditorTextEdit } from '../model/text_model';
import { getLinesSnapshot, getTextSnapshot } from '../text/source_text';
import { mapTextOffset } from '../text/text_change';
import type { CodeEditorControl } from '../ui/code_editor_control';
import { captureCodeEditorSelectionSnapshot, codeEditorEditState } from '../ui/code_editor_state';
import { resetBlinkState } from '../ui/view/caret/blink';
import { revealCursor, updateDesiredColumn } from '../ui/view/caret/caret';
import { notifyReadOnlyEdit } from '../ui/view/view';
import { setSingleCursorSelectionAnchor } from './cursor/state';

/** Explicit document formatting shares the working copy's history and view-marker owner. */
export function applyDocumentFormatting(code: CodeEditorControl): void {
	const model = code.model;
	if (model.readOnly) { notifyReadOnlyEdit(); return; }
	if (!model.language.documentFormatting) return;
	const buffer = model.buffer, source = getTextSnapshot(buffer), lines = getLinesSnapshot(buffer);
	let edits: EditorTextEdit[];
	try {
		if (model.mode === 'lua') edits = createLuaDocumentFormattingEdits(source, lines);
		else {
			const formatted = formatAemDocument(source, model.resource.path, lines);
			const change = changedTextRange(source, formatted);
			edits = change === undefined ? [] : [{ offset: change.start, deleteLength: change.previousEnd - change.start,
				text: formatted.slice(change.start, change.nextEnd) }];
		}
	} catch (error) {
		showEditorMessage(`Formatting failed: ${extractErrorMessage(error)}`, 'error', 3.2);
		return;
	}
	if (edits.length === 0) {
		showEditorMessage('Document already formatted', 'info', 1.5);
		return;
	}
	const view = code.view, position = code.scratch.editPosition;
	const cursor = buffer.offsetAt(view.cursorRow, view.cursorColumn);
	const anchor = view.selectionAnchor === null ? null : buffer.offsetAt(view.selectionAnchor.row, view.selectionAnchor.column);
	const before = codeEditorEditState.of(captureCodeEditorSelectionSnapshot(view), view.editSource);
	model.recordContentEdit(code.clock.now());
	model.pushEditOperations(edits, before, changes => {
		buffer.positionAt(mapTextOffset(cursor, changes, 1), position);
		view.cursorRow = position.row; view.cursorColumn = position.column;
		if (anchor !== null) {
			buffer.positionAt(mapTextOffset(anchor, changes, 1), position);
			setSingleCursorSelectionAnchor(view, position.row, position.column);
		}
		return codeEditorEditState.of(captureCodeEditorSelectionSnapshot(view), view.editSource);
	});
	clearForwardNavigationHistory();
	code.emitCursorMoved(); updateDesiredColumn(code); resetBlinkState(code.caret); revealCursor(code);
	showEditorMessage('Document formatted', 'success', 1.6);
}
