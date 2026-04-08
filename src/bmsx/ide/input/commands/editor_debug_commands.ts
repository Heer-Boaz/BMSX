import { RuntimeDebuggerCommandExecutor } from '../../contrib/debugger/ide_debugger';
import type { EditorCommandId } from './editor_commands';

export type EditorDebugCommandId =
	| 'debugContinue'
	| 'debugStepOver'
	| 'debugStepInto'
	| 'debugStepOut';

export function isEditorDebugCommand(command: EditorCommandId): command is EditorDebugCommandId {
	return command === 'debugContinue'
		|| command === 'debugStepOver'
		|| command === 'debugStepInto'
		|| command === 'debugStepOut';
}

export function executeEditorDebugCommand(command: EditorDebugCommandId): void {
	switch (command) {
		case 'debugContinue':
			RuntimeDebuggerCommandExecutor.instance.issueDebuggerCommand('continue');
			return;
		case 'debugStepOver':
			RuntimeDebuggerCommandExecutor.instance.issueDebuggerCommand('step_over');
			return;
		case 'debugStepInto':
			RuntimeDebuggerCommandExecutor.instance.issueDebuggerCommand('step_into');
			return;
		case 'debugStepOut':
			RuntimeDebuggerCommandExecutor.instance.issueDebuggerCommand('step_out');
			return;
	}
}
