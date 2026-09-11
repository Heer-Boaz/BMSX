import { resolveCallHierarchyAt } from '../editor/contrib/call_hierarchy/query';
import { openDefinitionSearch } from '../workbench/contrib/code_editor/definitions/quick_access';
import { activeCodeEditor } from '../editor/ui/code_editor_state';
import { showEditorMessage } from '../common/feedback_state';
import * as constants from '../common/constants';
import type { EditorCommandId, EditorSymbolNavigationCommandId } from '../common/commands';
import type { CartEditor } from '../cart_editor';
import type { RuntimeLuaTooling } from '../runtime/lua_tooling';

export function isEditorSymbolNavigationCommand(command: EditorCommandId): command is EditorSymbolNavigationCommandId {
	return command === 'goToDefinition'
		|| command === 'callHierarchy';
}

export function executeEditorSymbolNavigationCommand(
	editor: CartEditor,
	luaTooling: RuntimeLuaTooling,
	command: EditorSymbolNavigationCommandId,
): void {
	switch (command) {
		case 'goToDefinition':
			openDefinitionSearch(
				luaTooling,
				editor,
				activeCodeEditor.view.cursorRow,
				activeCodeEditor.view.cursorColumn,
			);
			return;
		case 'callHierarchy':
			const result = resolveCallHierarchyAt(
				luaTooling,
				activeCodeEditor.view.cursorRow,
				activeCodeEditor.view.cursorColumn,
			);
			switch (result.kind) {
				case 'missing_definition':
					showEditorMessage('Definition not found at cursor', constants.COLOR_STATUS_WARNING, 1.8);
					return;
				case 'success':
					editor.resourcePanel.showCallHierarchy(result.model);
					showEditorMessage(result.model.title, constants.COLOR_STATUS_SUCCESS, 1.6);
					return;
			}
	}
}
