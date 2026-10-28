import { CallHierarchyInput } from '../workbench/contrib/call_hierarchy/editor_input';
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
			const input = pane.input, scope = pane.inputScope, generation = scope.contextGeneration;
			const source = code.model, version = source.version;
			const row = code.view.cursorRow, column = code.view.cursorColumn;
			pane.group.openProducedEditor(() => {
				const result = resolveCallHierarchyAt(code, pane.sources.catalog, row, column);
				switch (result.kind) {
					case 'missing_definition':
						showEditorMessage('Definition not found at cursor', 'warning', 1.8);
						return undefined;
					case 'success': return new CallHierarchyInput(result.model);
				}
			}, { isCurrent: () => pane.group.panes.activePane === pane && pane.input === input
				&& scope.contextGeneration === generation && source.version === version });
			return;
		}
	}
}
