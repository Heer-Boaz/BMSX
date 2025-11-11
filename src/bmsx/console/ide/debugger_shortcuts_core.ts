export type DebuggerShortcutContext = {
	ctrlDown: boolean;
	altDown: boolean;
	metaDown: boolean;
	shiftDown: boolean;
	isKeyJustPressed: (code: string) => boolean;
	consumeKey: (code: string) => void;
};

export type DebuggerCommand = 'continue' | 'stepOver' | 'stepInto' | 'stepOut';

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
		return executor.issueDebuggerCommand('continue');
	}
	if (context.isKeyJustPressed('F10')) {
		context.consumeKey('F10');
		return executor.issueDebuggerCommand('stepOver');
	}
	if (context.isKeyJustPressed('F11')) {
		context.consumeKey('F11');
		if (context.shiftDown) {
			return executor.issueDebuggerCommand('stepOut');
		}
		return executor.issueDebuggerCommand('stepInto');
	}
	return false;
}
