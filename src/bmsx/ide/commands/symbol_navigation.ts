import { tryGotoDefinitionAt } from '../editor/contrib/intellisense/engine';
import { executeEditorCallHierarchyAt } from '../editor/contrib/call_hierarchy/command';
import { editorDocumentState } from '../editor/editing/document_state';
import type { Runtime } from '../../machine/runtime/runtime';
import type { EditorCommandId, EditorSymbolNavigationCommandId } from '../common/commands';

export function isEditorSymbolNavigationCommand(command: EditorCommandId): command is EditorSymbolNavigationCommandId {
	return command === 'goToDefinition'
		|| command === 'callHierarchy';
}

export function executeEditorSymbolNavigationCommand(runtime: Runtime, command: EditorSymbolNavigationCommandId): void {
	switch (command) {
		case 'goToDefinition':
			tryGotoDefinitionAt(runtime, editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
			return;
		case 'callHierarchy':
			executeEditorCallHierarchyAt(runtime, editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
			return;
	}
}
