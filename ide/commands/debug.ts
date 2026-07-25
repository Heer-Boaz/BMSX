import { runtimeWorkbenchState } from '../runtime/workbench_state';
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
			runtimeWorkbenchState.ide.editor.debugger.issueDebuggerCommand('continue');
			return;
		case 'debugStepOver':
			runtimeWorkbenchState.ide.editor.debugger.issueDebuggerCommand('step_over');
			return;
		case 'debugStepInto':
			runtimeWorkbenchState.ide.editor.debugger.issueDebuggerCommand('step_into');
			return;
		case 'debugStepOut':
			runtimeWorkbenchState.ide.editor.debugger.issueDebuggerCommand('step_out');
			return;
	}
}
