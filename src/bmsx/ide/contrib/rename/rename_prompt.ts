import { ide_state } from '../../core/ide_state';
import { extractHoverExpression } from '../intellisense/intellisense';
import { closeSearch } from '../find/editor_search';
import { getActiveCodeTabContext, isEditableCodeTab } from '../../ui/editor_tabs';
import { closeResourceSearch } from '../resources/resource_search';
import { closeLineJump } from '../find/line_jump';
import { notifyReadOnlyEdit } from '../../ui/editor_view';
import { resetBlink } from '../../render/render_caret';
import { revealCursor } from '../../ui/caret';
import { closeSymbolSearch } from '../symbols/symbol_search_shared';
import { editorCaretState } from '../../ui/caret_state';
import { editorDocumentState } from '../../editing/editor_document_state';

export function openRenamePrompt(): void {
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return;
	}
	closeSearch(false, true);
	closeLineJump(false);
	closeResourceSearch(false);
	closeSymbolSearch(false);
	ide_state.createResource.active = false;
	const context = getActiveCodeTabContext();
	if (context.mode !== 'lua') {
		return;
	}
	const started = ide_state.renameController.begin({
		buffer: editorDocumentState.buffer,
		textVersion: editorDocumentState.textVersion,
		cursorRow: editorDocumentState.cursorRow,
		cursorColumn: editorDocumentState.cursorColumn,
		extractExpression: (row, column) => extractHoverExpression(row, column),
		path: context.descriptor.path,
	});
	if (started) {
		editorCaretState.cursorVisible = true;
		resetBlink();
	}
}

export function focusEditorFromRename(): void {
	editorCaretState.cursorRevealSuspended = false;
	resetBlink();
	revealCursor();
	editorCaretState.cursorVisible = true;
}
