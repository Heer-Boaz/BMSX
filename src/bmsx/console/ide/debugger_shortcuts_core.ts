export type DebuggerShortcutContext = {
	ctrlDown: boolean;
	altDown: boolean;
	metaDown: boolean;
	shiftDown: boolean;
	isKeyJustPressed: (code: string) => boolean;
	consumeKey: (code: string) => void;
};

export type DebuggerCommand =
	| 'continue'
	| 'step_over'
	| 'step_into'
	| 'step_out'
	| 'ignoreException'
	| 'step_out_exception';

export interface DebuggerCommandExecutor {
	isSuspended(): boolean;
	issueDebuggerCommand(command: DebuggerCommand): boolean;
}

export function evaluateDebuggerShortcuts(
	context: DebuggerShortcutContext,
	executor: DebuggerCommandExecutor,
): boolean {
	if (!executor || !executor.isSuspended()) {
		return false;
	}
	if (context.ctrlDown || context.altDown || context.metaDown) {
		return false;
	}
	if (context.isKeyJustPressed('F5')) {
		context.consumeKey('F5');
		if (context.shiftDown) {
			return executor.issueDebuggerCommand('ignoreException');
		}
		return executor.issueDebuggerCommand('continue');
	}
	if (context.isKeyJustPressed('F10')) {
		context.consumeKey('F10');
		if (context.shiftDown) {
			return executor.issueDebuggerCommand('step_out_exception');
		}
		return executor.issueDebuggerCommand('step_over');
	}
	if (context.isKeyJustPressed('F11')) {
		context.consumeKey('F11');
		if (context.shiftDown) {
			return executor.issueDebuggerCommand('step_out');
		}
		return executor.issueDebuggerCommand('step_into');
	}
	return false;
}
