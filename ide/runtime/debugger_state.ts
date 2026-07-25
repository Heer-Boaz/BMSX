import { DebugPauseCoordinator } from '../../machine/ts/lua/debug_pause';
import { LuaDebuggerController, type LuaDebuggerSessionMetrics } from '../../machine/ts/lua/debugger';
import type { LuaDebuggerPauseSignal } from '../../machine/ts/lua/value';

export type RuntimeDebuggerState = {
	controller: LuaDebuggerController;
	pauseCoordinator: DebugPauseCoordinator;
	suspendSignal: LuaDebuggerPauseSignal;
	paused: boolean;
	metrics: LuaDebuggerSessionMetrics;
};

export function createRuntimeDebuggerState(): RuntimeDebuggerState {
	return {
		controller: new LuaDebuggerController(),
		pauseCoordinator: new DebugPauseCoordinator(),
		suspendSignal: null,
		paused: false,
		metrics: null,
	};
}
