import { getDebuggerRuntimeAccessor } from '../runtime_accessors';
import {
	getLastDebuggerPauseEvent,
	subscribeDebuggerLifecycleEvents,
	type DebuggerLifecycleEvent,
} from '../debugger_lifecycle';
import type { DebuggerCommandExecutor, DebuggerCommand } from './debugger_shortcuts_core';

type RuntimeDebuggerApi = {
	continueLuaDebugger(): void;
	stepOverLuaDebugger(): void;
	stepIntoLuaDebugger(): void;
	stepOutLuaDebugger(): void;
	ignoreLuaException(): void;
	stepOutLuaException(): void;
};

const DEBUGGER_LOG_PREFIX = '[DebuggerCommandExecutor]';

class RuntimeDebuggerCommandExecutor implements DebuggerCommandExecutor {
	private hasActiveSuspension = getLastDebuggerPauseEvent() !== null;

	constructor() {
		subscribeDebuggerLifecycleEvents((event: DebuggerLifecycleEvent) => {
			if (event.type === 'paused' || event.type === 'exception_frame_focus') {
				this.hasActiveSuspension = true;
				return;
			}
			if (event.type === 'continued') {
				this.hasActiveSuspension = false;
			}
		});
	}

	private resolveRuntime(): RuntimeDebuggerApi | null {
		const accessor = getDebuggerRuntimeAccessor();
		if (!accessor) {
			return null;
		}
		const runtime = accessor() as Partial<RuntimeDebuggerApi> | null | undefined;
		if (!runtime) {
			return null;
		}
		const {
			continueLuaDebugger,
			stepIntoLuaDebugger,
			stepOverLuaDebugger,
			stepOutLuaDebugger,
			ignoreLuaException,
			stepOutLuaException,
		} = runtime;
		if (
			typeof continueLuaDebugger !== 'function' ||
			typeof stepIntoLuaDebugger !== 'function' ||
			typeof stepOverLuaDebugger !== 'function' ||
			typeof stepOutLuaDebugger !== 'function' ||
			typeof ignoreLuaException !== 'function' ||
			typeof stepOutLuaException !== 'function'
		) {
			return null;
		}
		return runtime as RuntimeDebuggerApi;
	}

	public isSuspended(): boolean {
		return this.hasActiveSuspension;
	}

	public issueDebuggerCommand(command: DebuggerCommand): boolean {
		if (!this.hasActiveSuspension) {
			this.logCommand(command, false, 'no_suspension');
			return false;
		}
		const runtime = this.resolveRuntime();
		if (!runtime) {
			this.logCommand(command, false, 'runtime_unavailable');
			return false;
		}
		switch (command) {
			case 'continue':
				runtime.continueLuaDebugger();
				this.logCommand(command, true, 'ok');
				return true;
			case 'stepInto':
				runtime.stepIntoLuaDebugger();
				this.logCommand(command, true, 'ok');
				return true;
			case 'stepOver':
				runtime.stepOverLuaDebugger();
				this.logCommand(command, true, 'ok');
				return true;
			case 'stepOut':
				runtime.stepOutLuaDebugger();
				this.logCommand(command, true, 'ok');
				return true;
			case 'ignoreException':
				runtime.ignoreLuaException();
				this.logCommand(command, true, 'ok');
				return true;
			case 'stepOutException':
				runtime.stepOutLuaException();
				this.logCommand(command, true, 'ok');
				return true;
			default:
				this.logCommand(command, false, 'unsupported');
				return false;
		}
	}

	private logCommand(command: DebuggerCommand, handled: boolean, reason: string): void {
		console.log(`${DEBUGGER_LOG_PREFIX} command=${command} handled=${handled} reason=${reason}`);
	}
}

const debuggerCommandExecutor = new RuntimeDebuggerCommandExecutor();

export function getDebuggerCommandExecutor(): DebuggerCommandExecutor {
	return debuggerCommandExecutor;
}

export function issueDebuggerCommand(command: DebuggerCommand): boolean {
	return debuggerCommandExecutor.issueDebuggerCommand(command);
}
