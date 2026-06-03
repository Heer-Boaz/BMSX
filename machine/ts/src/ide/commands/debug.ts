import type { Runtime } from '../../machine/runtime/runtime';
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

export function executeEditorDebugCommand(runtime: Runtime, command: EditorDebugCommandId): void {
	switch (command) {
		case 'debugContinue':
			runtime.editor.debugger.issueDebuggerCommand('continue');
			return;
		case 'debugStepOver':
			runtime.editor.debugger.issueDebuggerCommand('step_over');
			return;
		case 'debugStepInto':
			runtime.editor.debugger.issueDebuggerCommand('step_into');
			return;
		case 'debugStepOut':
			runtime.editor.debugger.issueDebuggerCommand('step_out');
			return;
	}
}
