import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { LuaDebuggerPauseSignal } from '../../src/bmsx/lua/value';
import {
	emitDebuggerLifecycleEvent,
	getDebuggerExecutionState,
	subscribeDebuggerLifecycleEvents,
} from '../../src/bmsx/ide/workbench/contrib/debugger/controller';

function pauseSignal(): LuaDebuggerPauseSignal {
	return {
		kind: 'pause',
		reason: 'breakpoint',
		location: { path: 'main.lua', line: 1, column: 1 },
		callStack: [],
		resume: () => ({ kind: 'normal' }),
	};
}

test('debugger lifecycle tracks pause, replay, and continued state', () => {
	emitDebuggerLifecycleEvent({ type: 'continued', mode: 'continue' });
	assert.equal(getDebuggerExecutionState(), 'running');

	const suspension = pauseSignal();
	emitDebuggerLifecycleEvent({
		type: 'paused',
		suspension,
		payload: {
			path: suspension.location.path,
			line: suspension.location.line,
			column: suspension.location.column,
			reason: suspension.reason,
		},
		callStack: suspension.callStack,
		metrics: null,
	});
	assert.equal(getDebuggerExecutionState(), 'paused');

	const events: string[] = [];
	const unsubscribe = subscribeDebuggerLifecycleEvents(event => {
		events.push(event.type);
	});
	try {
		assert.deepEqual(events, ['paused']);
		emitDebuggerLifecycleEvent({ type: 'continued', mode: 'continue' });
		assert.deepEqual(events, ['paused', 'continued']);
		assert.equal(getDebuggerExecutionState(), 'running');
	}
	finally {
		unsubscribe();
	}
});
