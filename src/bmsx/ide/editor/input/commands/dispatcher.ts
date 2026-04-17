import type { TopBarButtonId } from '../../../workbench/ui/top_bar/menu';
import { executeEditorDebugCommand, isEditorDebugCommand } from './debug';
import { executeEditorSearchCommand, isEditorSearchCommand } from './search';
import { executeEditorSymbolNavigationCommand, isEditorSymbolNavigationCommand } from './symbol_navigation';
import { executeEditorViewCommand, isEditorViewCommand } from './view';
import { executeEditorWorkspaceCommand, isEditorWorkspaceCommand } from './workspace';

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
