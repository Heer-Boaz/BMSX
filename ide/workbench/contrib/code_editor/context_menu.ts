import { create_rect_bounds } from '../../../../machine/ts/common/rect';
import type { CartEditor } from '../../../cart_editor';
import type { EditorContextToken } from '../../../common/models';
import { resolveContextMenuToken } from '../../../editor/contrib/intellisense/engine';
import { activeCodeEditor } from '../../../editor/ui/code_editor_state';
import { revealCursor } from '../../../editor/ui/view/caret/view';
import { resolveTextPositionBounds } from '../../../editor/ui/view/view';
import { focusEditorAtPosition } from '../../ui/focus';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';

const anchor = create_rect_bounds();

export function codeContextMenuItems(token: EditorContextToken | null) {
	return WORKBENCH_MENUS[token !== null && token.kind === 'identifier' && token.expression !== null
		? 'code.symbol.context' : 'code.context'];
}

/** The code contribution retains its own source target; the popup only sees commands. */
export function openCodeContextMenu(editor: CartEditor, row: number, column: number, x: number, y: number, keyboard = false): void {
	const model = activeCodeEditor.model;
	const token = resolveContextMenuToken(row, column, model.resource.path);
	activeCodeEditor.focusTarget.focus();
	const lifetime = editor.contextMenu.show(x, y, codeContextMenuItems(token), {
		isEnabled: command => editor.commands.isEnabled(command),
		execute: command => {
			switch (command) {
				case 'goToDefinition': case 'referenceSearch': case 'callHierarchy': case 'rename':
					focusEditorAtPosition(editor, token!.row, token!.startColumn);
			}
			editor.commands.execute(command);
		},
	}, keyboard);
	lifetime.add({ dispose: model.onDidChangeContent(() => editor.contextMenu.hide()) });
}

export function openCodeContextMenuAtCursor(editor: CartEditor): void {
	revealCursor();
	const view = activeCodeEditor.view;
	resolveTextPositionBounds(view.cursorRow, view.cursorColumn, anchor);
	openCodeContextMenu(editor, view.cursorRow, view.cursorColumn, anchor.left, anchor.bottom, true);
}
