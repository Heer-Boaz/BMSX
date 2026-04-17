import { tryGotoDefinitionAt } from '../../contrib/intellisense/engine';
import type { EditorCommandId } from './dispatcher';
import { executeEditorCallHierarchyAt } from '../../contrib/call_hierarchy/command';
import { editorDocumentState } from '../../editing/document_state';

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
