import { machineManager } from '../../core/machine_manager';
import type { EditorCommandId, EditorDebugCommandId } from '../common/commands';

export function isEditorDebugCommand(command: EditorCommandId): command is EditorDebugCommandId {
	switch (command) {
		case 'debugContinue':
		case 'debugStepOver':
		case 'debugStepInto':
		case 'debugStepOut':
			return true;
		default:
			return false;
	}
}

export function executeEditorDebugCommand(command: EditorDebugCommandId): void {
	switch (command) {
		case 'debugContinue':
			machineManager.ideState.editor.debugger.issueDebuggerCommand('continue');
			return;
		case 'debugStepOver':
			machineManager.ideState.editor.debugger.issueDebuggerCommand('step_over');
			return;
		case 'debugStepInto':
			machineManager.ideState.editor.debugger.issueDebuggerCommand('step_into');
			return;
		case 'debugStepOut':
			machineManager.ideState.editor.debugger.issueDebuggerCommand('step_out');
			return;
	}
}
