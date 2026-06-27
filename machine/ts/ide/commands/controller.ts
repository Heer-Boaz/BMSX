import { machineManager } from '../../core/machine_manager';
import type { Runtime } from '../../machine/runtime/runtime';
import type { EditorCommandId } from '../common/commands';
import { editorDocumentState } from '../editor/editing/document_state';
import { executeEditorDebugCommand, isEditorDebugCommand } from './debug';
import { executeEditorSearchCommand, isEditorSearchCommand } from './search';
import { executeEditorSymbolNavigationCommand, isEditorSymbolNavigationCommand } from './symbol_navigation';
import { executeEditorViewCommand, isEditorViewCommand } from './view';
import { editorViewState } from '../editor/ui/view/state';
import { editorDebuggerState } from '../workbench/contrib/debugger/state';
import { problemsPanel } from '../workbench/contrib/problems/panel/controller';
import { isCodeTabActive } from '../workbench/ui/code_tab/contexts';
import { executeEditorWorkspaceCommand, isEditorWorkspaceCommand } from './workspace';

export class IdeCommandController {
	public constructor(private readonly runtime: Runtime) {
	}

	public execute(command: EditorCommandId): void {
		if (isEditorDebugCommand(command)) {
			executeEditorDebugCommand(command);
			return;
		}
		if (isEditorSymbolNavigationCommand(command)) {
			executeEditorSymbolNavigationCommand(this.runtime, command);
			return;
		}
		if (isEditorSearchCommand(command)) {
			executeEditorSearchCommand(this.runtime, command);
			return;
		}
		if (isEditorViewCommand(command)) {
			executeEditorViewCommand(command);
			return;
		}
		if (isEditorWorkspaceCommand(command)) {
			executeEditorWorkspaceCommand(this.runtime, command);
			return;
		}
		throw new Error(`Unhandled editor command: ${command}`);
	}

	public isEnabled(command: EditorCommandId): boolean {
		switch (command) {
			case 'save':
				return isCodeTabActive() && editorDocumentState.dirty;
			case 'filter':
				return machineManager.ideState.editor.resourcePanel.isVisible()
					&& machineManager.ideState.editor.resourcePanel.getMode() === 'resources';
			case 'debugContinue':
			case 'debugStepOver':
			case 'debugStepInto':
			case 'debugStepOut':
				return editorDebuggerState.controls.executionState === 'paused';
			default:
				return true;
		}
	}

	public isActive(command: EditorCommandId): boolean {
		switch (command) {
			case 'resources':
				return machineManager.ideState.editor.resourcePanel.isVisible();
			case 'problems':
				return problemsPanel.isVisible;
			case 'filter':
				return machineManager.ideState.editor.resourcePanel.getFilterMode() === 'lua_only';
			case 'wrap':
				return editorViewState.wordWrapEnabled;
			default:
				return false;
		}
	}
}
