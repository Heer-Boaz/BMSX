import { renameController } from './controller';
import { extractHoverExpression } from '../intellisense/engine';
import { closeSearch } from '../find/search';
import { getActiveCodeTabContext, isEditableCodeTab } from '../../../workbench/ui/code_tab/contexts';
import { closeResourceSearch } from '../../../workbench/contrib/resources/search';
import { closeLineJump } from '../find/line_jump';
import { notifyReadOnlyEdit } from '../../ui/view';
import { resetBlink } from '../../render/caret';
import { revealCursor } from '../../ui/caret';
import { closeSymbolSearch } from '../symbols/shared';
import { editorCaretState } from '../../ui/caret_state';
import { editorDocumentState } from '../../editing/document_state';
import { createResourceState } from '../../../workbench/contrib/resources/widget_state';

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
