import type { RenameController } from './controller';
import { closeSearch } from '../find/search';
import { getActiveCodeTabContext, isEditableCodeTab } from '../../../ui/code_tab/contexts';
import { closeResourceSearch } from '../../resources/search/index';
import { closeLineJump } from '../find/line_jump';
import { notifyReadOnlyEdit } from '../../../../editor/ui/view/view';
import { resetBlink } from '../../../../editor/render/caret';
import { revealCursor } from '../../../../editor/ui/view/caret/caret';
import { closeSymbolSearch } from '../symbols/shared';
import { editorCaretState } from '../../../../editor/ui/view/caret/state';
import { activeCodeEditor } from '../../../../editor/ui/code_editor_state';
import { createResourceState } from '../../resources/widget_state';
import type { RuntimeLuaTooling } from '../../../../runtime/lua_tooling';

export function openRenamePrompt(bridge: RuntimeLuaTooling, rename: RenameController): void {
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
	switch (context.model.mode) {
		case 'lua':
			break;
		case 'aem':
			return;
	}
	const started = rename.begin(bridge, {
		buffer: activeCodeEditor.model.buffer,
		cursorRow: activeCodeEditor.view.cursorRow,
		cursorColumn: activeCodeEditor.view.cursorColumn,
		identity: context.model.resource,
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
