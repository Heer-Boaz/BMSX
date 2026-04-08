import { ide_state } from '../../core/ide_state';
import { tryGotoDefinitionAt } from '../../contrib/intellisense/intellisense';
import type { EditorCommandId } from './editor_commands';
import { executeEditorCallHierarchyAt } from '../../contrib/call_hierarchy/call_hierarchy';

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
			executeEditorGoToDefinitionAt(ide_state.cursorRow, ide_state.cursorColumn);
			return;
		case 'callHierarchy':
			executeEditorCallHierarchyAt(ide_state.cursorRow, ide_state.cursorColumn);
			return;
	}
}

export function executeEditorGoToDefinitionAt(row: number, column: number): boolean {
	return tryGotoDefinitionAt(row, column);
}
