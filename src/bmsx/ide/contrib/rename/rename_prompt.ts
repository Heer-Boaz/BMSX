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
