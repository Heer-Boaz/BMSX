import { gotoDefinitionAt } from '../workbench/ui/code_tab/activation';
import { resolveCallHierarchyViewAt } from '../editor/contrib/call_hierarchy/query';
import { closeSymbolSearch } from '../workbench/contrib/code_editor/symbols/shared';
import { editorDocumentState } from '../editor/editing/document_state';
import { showEditorMessage } from '../common/feedback_state';
import * as constants from '../common/constants';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { EditorCommandId, EditorSymbolNavigationCommandId } from '../common/commands';
import type { CartEditor } from '../cart_editor';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeLuaTooling } from '../runtime/lua_tooling';
import type { RuntimeFaultState } from '../runtime/fault_state';

export function isEditorSymbolNavigationCommand(command: EditorCommandId): command is EditorSymbolNavigationCommandId {
	return command === 'goToDefinition'
		|| command === 'callHierarchy';
}

export function executeEditorSymbolNavigationCommand(
	editor: CartEditor,
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
	fault: RuntimeFaultState,
	runtime: Runtime,
	command: EditorSymbolNavigationCommandId,
): void {
	switch (command) {
		case 'goToDefinition':
			gotoDefinitionAt(
				luaTooling,
				fault,
				editor,
				sources,
				runtime,
				editorDocumentState.cursorRow,
				editorDocumentState.cursorColumn,
			);
			return;
		case 'callHierarchy':
			const result = resolveCallHierarchyViewAt(
				luaTooling,
				editorDocumentState.cursorRow,
				editorDocumentState.cursorColumn,
			);
			switch (result.kind) {
				case 'missing_definition':
					showEditorMessage('Definition not found at cursor', constants.COLOR_STATUS_WARNING, 1.8);
					return;
				case 'no_calls':
					showEditorMessage(`No calls found for ${result.expression}`, constants.COLOR_STATUS_WARNING, 1.8);
					return;
				case 'success':
					closeSymbolSearch(false);
					editor.resourcePanel.showCallHierarchy(result.view);
					showEditorMessage(result.view.title, constants.COLOR_STATUS_SUCCESS, 1.6);
					return;
			}
	}
}
