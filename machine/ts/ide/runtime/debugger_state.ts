import { DebugPauseCoordinator } from '../../lua/debug_pause';
import { LuaDebuggerController, type LuaDebuggerSessionMetrics } from '../../lua/debugger';
import type { LuaDebuggerPauseSignal } from '../../lua/value';

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
