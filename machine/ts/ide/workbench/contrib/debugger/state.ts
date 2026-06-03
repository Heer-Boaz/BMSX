import type { DebuggerExecutionState } from './controller';
import type { LuaDebuggerSessionMetrics } from '../../../../lua/debugger';

export type DebuggerControlsState = {
	executionState: DebuggerExecutionState;
	sessionMetrics: LuaDebuggerSessionMetrics;
};

export const editorDebuggerState = {
	controls: {
		executionState: 'inactive' as DebuggerExecutionState,
		sessionMetrics: null as LuaDebuggerSessionMetrics,
	},
	breakpoints: new Map<string, Set<number>>(),
};
