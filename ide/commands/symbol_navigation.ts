import { resolveCallHierarchyAt } from '../editor/contrib/call_hierarchy/query';
import { openDefinitionSearch } from '../workbench/contrib/code_editor/definitions/quick_access';
import { showEditorMessage } from '../common/feedback_state';
import type { EditorSymbolNavigationCommandId } from '../common/commands';
import type { CodeEditorPane } from '../workbench/contrib/code_editor/editor_pane';

export function executeEditorSymbolNavigationCommand(pane: CodeEditorPane, command: EditorSymbolNavigationCommandId): void {
	const code = pane.code;
	switch (command) {
		case 'goToDefinition':
			openDefinitionSearch(pane, code.view.cursorRow, code.view.cursorColumn);
			return;
		case 'callHierarchy': {
			const result = resolveCallHierarchyAt(code, pane.sources, code.view.cursorRow, code.view.cursorColumn);
			switch (result.kind) {
				case 'missing_definition':
					showEditorMessage('Definition not found at cursor', 'warning', 1.8);
					return;
				case 'success':
					pane.editor.resourcePanel.showCallHierarchy(result.model);
					showEditorMessage(result.model.title, 'success', 1.6);
					return;
			}
		}
	}
}
