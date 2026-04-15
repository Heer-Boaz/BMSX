import { renameController } from './rename_controller';
import { extractHoverExpression } from '../intellisense/intellisense';
import { closeSearch } from '../find/editor_search';
import { getActiveCodeTabContext, isEditableCodeTab } from '../../../workbench/ui/code_tab_contexts';
import { closeResourceSearch } from '../../../workbench/contrib/resources/resource_search';
import { closeLineJump } from '../find/line_jump';
import { notifyReadOnlyEdit } from '../../ui/editor_view';
import { resetBlink } from '../../render/render_caret';
import { revealCursor } from '../../ui/caret';
import { closeSymbolSearch } from '../symbols/symbol_search_shared';
import { editorCaretState } from '../../ui/caret_state';
import { editorDocumentState } from '../../editing/editor_document_state';
import { createResourceState } from '../../../workbench/contrib/resources/resource_widget_state';

export function openRenamePrompt(): void {
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return;
	}
	closeSearch(false, true);
	closeLineJump(false);
	closeResourceSearch(false);
	closeSymbolSearch(false);
	createResourceState.active = false;
	const context = getActiveCodeTabContext();
	if (context.mode !== 'lua') {
		return;
	}
	const started = renameController.begin({
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
