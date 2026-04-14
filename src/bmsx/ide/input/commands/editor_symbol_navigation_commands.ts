import { tryGotoDefinitionAt } from '../../contrib/intellisense/intellisense';
import type { EditorCommandId } from './editor_commands';
import { executeEditorCallHierarchyAt } from '../../contrib/call_hierarchy/call_hierarchy';
import { editorDocumentState } from '../../editing/editor_document_state';

export type EditorSymbolNavigationCommandId =
	| 'goToDefinition'
	| 'callHierarchy';

export function isEditorSymbolNavigationCommand(command: EditorCommandId): command is EditorSymbolNavigationCommandId {
	return command === 'goToDefinition'
		|| command === 'callHierarchy';
}

export function executeEditorSymbolNavigationCommand(command: EditorSymbolNavigationCommandId): void {
	switch (command) {
		case 'goToDefinition':
			executeEditorGoToDefinitionAt(editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
			return;
		case 'callHierarchy':
			executeEditorCallHierarchyAt(editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
			return;
	}
}

export function executeEditorGoToDefinitionAt(row: number, column: number): boolean {
	return tryGotoDefinitionAt(row, column);
}
