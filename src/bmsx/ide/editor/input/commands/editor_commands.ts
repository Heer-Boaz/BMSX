import type { TopBarButtonId } from '../../../workbench/ui/top_bar_menu';
import { executeEditorDebugCommand, isEditorDebugCommand } from './editor_debug_commands';
import { executeEditorSearchCommand, isEditorSearchCommand } from './editor_search_commands';
import { executeEditorSymbolNavigationCommand, isEditorSymbolNavigationCommand } from './editor_symbol_navigation_commands';
import { executeEditorViewCommand, isEditorViewCommand } from './editor_view_commands';
import { executeEditorWorkspaceCommand, isEditorWorkspaceCommand } from './editor_workspace_commands';

export type EditorCommandId =
	| TopBarButtonId
	| 'theme-toggle'
	| 'goToDefinition'
	| 'callHierarchy'
	| 'symbolSearch'
	| 'symbolSearchGlobal'
	| 'resourceSearch'
	| 'runtimeErrorFocus'
	| 'createResource'
	| 'findGlobal'
	| 'findLocal'
	| 'lineJump'
	| 'referenceSearch'
	| 'rename';

export function executeTopBarCommand(command: TopBarButtonId): void {
	executeEditorCommand(command);
}

export function executeEditorCommand(command: EditorCommandId): void {
	if (isEditorDebugCommand(command)) {
		executeEditorDebugCommand(command);
		return;
	}
	if (isEditorSymbolNavigationCommand(command)) {
		executeEditorSymbolNavigationCommand(command);
		return;
	}
	if (isEditorSearchCommand(command)) {
		executeEditorSearchCommand(command);
		return;
	}
	if (isEditorViewCommand(command)) {
		executeEditorViewCommand(command);
		return;
	}
	if (isEditorWorkspaceCommand(command)) {
		executeEditorWorkspaceCommand(command);
		return;
	}
	const unreachableCommand: never = command;
	throw new Error(`Unhandled editor command: ${unreachableCommand}`);
}
