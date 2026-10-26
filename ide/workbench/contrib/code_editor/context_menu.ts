import type { EditorContextToken } from '../../../common/models';
import { resolveContextMenuToken } from '../../../editor/contrib/intellisense/engine';
import { revealCursor, setCursorPosition } from '../../../editor/ui/view/caret/caret';
import { setSingleCursorSelectionAnchor } from '../../../editor/editing/cursor/state';
import { resetBlinkState } from '../../../editor/ui/view/caret/blink';
import { resolveTextPositionBounds } from '../../../editor/ui/view/view';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import type { CodeEditorPane } from './editor_pane';

export function codeContextMenuItems(token: EditorContextToken | null) {
	return WORKBENCH_MENUS[token !== null && token.kind === 'identifier' && token.expression !== null
		? 'code.symbol.context' : 'code.context'];
}

/** The popup retains this Source control's action target independently of later focus. */
export function openCodeContextMenu(pane: CodeEditorPane, row: number, column: number, x: number, y: number, keyboard = false): void {
	const code = pane.code, editor = pane.editor, model = code.model;
	const token = resolveContextMenuToken(code, row, column, model.resource.path);
	code.focusTarget.focus();
	editor.contextMenu.show(x, y, codeContextMenuItems(token), {
		isEnabled: (command, target) => editor.commands.isEnabled(command, target),
		isActive: command => editor.commands.isActive(command, code.focusTarget),
		execute: (command, target) => {
			switch (command) {
				case 'goToDefinition': case 'referenceSearch': case 'callHierarchy': case 'rename':
					code.focusTarget.focus();
					setSingleCursorSelectionAnchor(code.view, token!.row, token!.startColumn);
					setCursorPosition(code, token!.row, token!.startColumn);
					resetBlinkState(code.caret);
			}
			editor.commands.execute(command, target);
		},
	}, { selectFirst: keyboard, invocationOrigin: code.focusTarget, commandTarget: code.focusTarget, returnFocus: code.focusTarget,
		onWillShow: lifetime => { lifetime.add({ dispose: model.onDidChangeContent(() => editor.contextMenu.hide()) }); },
	});
}

export function openCodeContextMenuAtCursor(pane: CodeEditorPane): void {
	const code = pane.code;
	revealCursor(code);
	const view = code.view, anchor = code.scratch.contextMenuAnchor;
	resolveTextPositionBounds(code, view.cursorRow, view.cursorColumn, anchor);
	openCodeContextMenu(pane, view.cursorRow, view.cursorColumn, anchor.left, anchor.bottom, true);
}
