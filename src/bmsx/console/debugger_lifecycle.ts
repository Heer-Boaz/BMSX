import type { LuaCallFrame, LuaDebuggerPauseSignal } from '../lua/runtime';
import type { LuaDebuggerSessionMetrics } from '../lua/debugger';

export type DebuggerPauseFrameHint = { asset_id: string | null; path?: string | null } | null;

export type DebuggerPauseDisplayPayload = {
	chunk: string;
	line: number;
	column: number;
	reason: LuaDebuggerPauseSignal['reason'];
	hint: DebuggerPauseFrameHint;
};

export type DebuggerResumeMode = 'continue' | 'step_into' | 'step_over' | 'step_out';

export type DebuggerLifecyclePausedEvent = {
	type: 'paused';
	suspension: LuaDebuggerPauseSignal;
	payload: DebuggerPauseDisplayPayload;
	callStack: ReadonlyArray<LuaCallFrame>;
	metrics: LuaDebuggerSessionMetrics | null;
};

export type DebuggerLifecycleContinuedEvent = {
	type: 'continued';
	mode: DebuggerResumeMode;
};

export type DebuggerLifecycleExceptionFrameEvent = {
	type: 'exception_frame_focus';
	payload: DebuggerPauseDisplayPayload;
};

export type DebuggerLifecycleEvent =
	| DebuggerLifecyclePausedEvent
	| DebuggerLifecycleContinuedEvent
	| DebuggerLifecycleExceptionFrameEvent;

export type DebuggerExecutionState = 'inactive' | 'running' | 'paused';

type DebuggerLifecycleListener = (event: DebuggerLifecycleEvent) => void;

const listeners = new Set<DebuggerLifecycleListener>();
let lastPausedEvent: DebuggerLifecyclePausedEvent | null = null;
let debuggerState: DebuggerExecutionState = 'inactive';

export function emitDebuggerLifecycleEvent(event: DebuggerLifecycleEvent): void {
	if (event.type === 'paused') {
		debuggerState = 'paused';
		lastPausedEvent = event;
	}
	else if (event.type === 'continued') {
		debuggerState = 'running';
		lastPausedEvent = null;
	}
	else if (event.type === 'exception_frame_focus') {
		debuggerState = 'paused';
	}
	for (const listener of listeners) {
		listener(event);
	}
}

export function subscribeDebuggerLifecycleEvents(
	listener: DebuggerLifecycleListener,
	{ replayCurrentPause }: { replayCurrentPause?: boolean } = {},
): () => void {
	listeners.add(listener);
	if (replayCurrentPause !== false && lastPausedEvent) {
		listener(lastPausedEvent);
	}
	return () => {
		listeners.delete(listener);
	};
}

export function getDebuggerExecutionState(): DebuggerExecutionState {
	return debuggerState;
}

export function getLastDebuggerPauseEvent(): DebuggerLifecyclePausedEvent | null {
	return lastPausedEvent;
}
