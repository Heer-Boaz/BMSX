import { executeEditorDebugCommand, isEditorDebugCommand } from './editor_debug_commands';
import { executeEditorSearchCommand, isEditorSearchCommand } from './editor_search_commands';
import { executeEditorViewCommand, isEditorViewCommand } from './editor_view_commands';
import { executeEditorWorkspaceCommand, isEditorWorkspaceCommand } from './editor_workspace_commands';

export const MENU_IDS = ['file', 'run', 'view', 'debug'] as const;
export const MENU_COMMANDS = [
	'hot-resume',
	'reboot',
	'save',
	'resources',
	'problems',
	'filter',
	'wrap',
	'debugContinue',
	'debugStepOver',
	'debugStepInto',
	'debugStepOut',
] as const;

export type EditorCommandId =
	| (typeof MENU_COMMANDS)[number]
	| 'theme-toggle'
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

export function executeTopBarCommand(command: (typeof MENU_COMMANDS)[number]): void {
	executeEditorCommand(command);
}

export function executeEditorCommand(command: EditorCommandId): void {
	if (isEditorDebugCommand(command)) {
		executeEditorDebugCommand(command);
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
