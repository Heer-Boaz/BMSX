import type { RuntimeSourceState } from '../../../../runtime/sources';
import type { RenameController } from './controller';
import type { EditorSearchController } from '../find/search';
import { getActiveCodeTabContext, isEditableCodeTab } from '../../../ui/code_tab/contexts';
import { closeLineJump } from '../find/line_jump';
import { notifyReadOnlyEdit } from '../../../../editor/ui/view/view';
import { resetBlink } from '../../../../editor/render/caret';
import { revealCursor } from '../../../../editor/ui/view/caret/caret';
import { editorCaretState } from '../../../../editor/ui/view/caret/state';
import { activeCodeEditor } from '../../../../editor/ui/code_editor_state';
import type { EditorPanes } from '../../../services/editor/editor_panes';
import { getRenameBarBounds } from '../../../common/layout';
import { inputFocus } from '../../../../input/focus';

export function openRenamePrompt(sources: RuntimeSourceState, rename: RenameController, search: EditorSearchController, reviewPanes?: EditorPanes): void {
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return;
	}
	search.closeSearch(false);
	closeLineJump(false);
	const context = getActiveCodeTabContext();
	switch (context.model.mode) {
		case 'lua':
			break;
		case 'yaml':
		case 'aem':
			return;
	}
	const started = rename.begin(sources, {
		buffer: activeCodeEditor.model.buffer,
		cursorRow: activeCodeEditor.view.cursorRow,
		cursorColumn: activeCodeEditor.view.cursorColumn,
		identity: context.model.resource,
	}, reviewPanes);
	if (started) {
		const bounds = getRenameBarBounds();
		if (bounds === null) { rename.cancel(); return; }
		rename.layoutField(bounds);
		rename.getField().focusTarget.focus();
		if (!rename.isActive()) { rename.cancel(); return; }
		editorCaretState.cursorVisible = true;
		resetBlink();
	}
}

export function focusEditorFromRename(): void {
	if (inputFocus.pendingTarget !== activeCodeEditor.focusTarget) return;
	editorCaretState.cursorRevealSuspended = false;
	resetBlink();
	revealCursor();
	editorCaretState.cursorVisible = true;
}
