import { LuaError, LuaRuntimeError } from '../../lua/errors';
import type { LuaDebuggerPauseSignal } from '../../lua/value';
import type { Runtime } from '../../machine/runtime/runtime';
import { clearRuntimeFault } from './fault_state';

export class DebugPauseCoordinator {
	private suspension: LuaDebuggerPauseSignal = null;
	private pendingException: LuaRuntimeError | LuaError = null;

	public capture(suspension: LuaDebuggerPauseSignal, pendingException: LuaRuntimeError | LuaError): void {
		this.suspension = suspension;
		this.pendingException = pendingException;
	}

	public hasSuspension(): boolean {
		return this.suspension !== null;
	}

	public getSuspension(): LuaDebuggerPauseSignal {
		return this.suspension;
	}

	public getPendingException(): LuaRuntimeError | LuaError {
		return this.pendingException;
	}

	public clearSuspension(): void {
		this.suspension = null;
		this.pendingException = null;
	}
}

export function clearRuntimeDebuggerPause(runtime: Runtime): void {
	runtime.pauseCoordinator.clearSuspension();
	runtime.debuggerSuspendSignal = null;
	runtime.debuggerPaused = false;
	clearRuntimeFault(runtime);
	runtime.debuggerController.clearPauseContext();
}
