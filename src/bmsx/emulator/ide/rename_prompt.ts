import { ide_state } from './ide_state';
import { extractHoverExpression } from './intellisense';
import { closeSearch } from './editor_search';
import { getActiveCodeTabContext, isEditableCodeTab } from './editor_tabs';
import { closeResourceSearch } from './resource_search';
import { closeLineJump } from './line_jump';
import { notifyReadOnlyEdit } from './editor_view';
import { resetBlink } from './render/render_caret';
import { revealCursor } from './caret';
import { closeSymbolSearch } from './symbol_search_shared';

export function openRenamePrompt(): void {
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return;
	}
	closeSearch(false, true);
	closeLineJump(false);
	closeResourceSearch(false);
	closeSymbolSearch(false);
	ide_state.createResourceActive = false;
	const context = getActiveCodeTabContext();
	if (context.mode !== 'lua') {
		return;
	}
	const started = ide_state.renameController.begin({
		buffer: ide_state.buffer,
		textVersion: ide_state.textVersion,
		cursorRow: ide_state.cursorRow,
		cursorColumn: ide_state.cursorColumn,
		extractExpression: (row, column) => extractHoverExpression(row, column),
		path: context.descriptor.path,
	});
	if (started) {
		ide_state.cursorVisible = true;
		resetBlink();
	}
}

export function focusEditorFromRename(): void {
	ide_state.cursorRevealSuspended = false;
	resetBlink();
	revealCursor();
	ide_state.cursorVisible = true;
}
