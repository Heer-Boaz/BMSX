import { register } from 'node:module';
register('./glsl-loader.mjs', import.meta.url);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LuaDebuggerPauseSignal } from '../../src/bmsx/lua/runtime.ts';
import { emitDebuggerLifecycleEvent } from '../../src/bmsx/console/debugger_lifecycle';
import {
	DebuggerSession,
	type DebuggerExceptionFrame,
	type DebuggerExceptionStepResolution,
} from '../../src/bmsx/console/debugger_session';
import { getDebuggerCommandExecutor, issueDebuggerCommand } from '../../src/bmsx/console/ide/debugger_controls';
import { setDebuggerRuntimeAccessor } from '../../src/bmsx/console/runtime_accessors';

function resetDebuggerLifecycle(): void {
	emitDebuggerLifecycleEvent({ type: 'continued', mode: 'continue' });
}

function createExceptionSession(): { session: DebuggerSession; suspension: LuaDebuggerPauseSignal } {
	const suspension: LuaDebuggerPauseSignal = {
		kind: 'pause',
		reason: 'exception',
		location: { chunk: 'main.lua', line: 3, column: 1 },
		callStack: [],
		resume: () => ({ kind: 'normal' }),
	};
	const frames: DebuggerExceptionFrame[] = [
		{ chunk: 'main.lua', line: 3, column: 1, hint: null },
		{ chunk: 'helper.lua', line: 10, column: 1, hint: null },
	];
	const session = new DebuggerSession();
	session.captureExceptionPause(suspension, frames);
	return { session, suspension };
}

test('exception stepping advances frames and stays paused until explicitly continued', () => {
	resetDebuggerLifecycle();
	const { session } = createExceptionSession();
	const first = session.resolveExceptionStep('stepInto');
	assertResolution(first, 'focus');
	assert.equal(first.payload.line, 10);

	const boundary = session.resolveExceptionStep('stepOut');
	assertResolution(boundary, 'focus');
	assert.equal(boundary.payload.line, 3);

	const resume = session.resolveExceptionStep('continue');
	assertResolution(resume, 'resume');
	const none = session.resolveExceptionStep('stepInto');
	assertResolution(none, 'none');
	resetDebuggerLifecycle();
});

test('debugger commands dispatch only when a suspension is active', () => {
	resetDebuggerLifecycle();
	const calls: string[] = [];
	const runtimeStub = {
		continueLuaDebugger: () => calls.push('continue'),
		stepOverLuaDebugger: () => calls.push('stepOver'),
		stepIntoLuaDebugger: () => calls.push('stepInto'),
		stepOutLuaDebugger: () => calls.push('stepOut'),
	};
	setDebuggerRuntimeAccessor(() => runtimeStub);
	try {
		const executor = getDebuggerCommandExecutor();
		assert.equal(executor.isSuspended(), false);
		assert.equal(executor.issueDebuggerCommand('continue'), false);
		assert.deepEqual(calls, []);

		const suspension: LuaDebuggerPauseSignal = {
			kind: 'pause',
			reason: 'breakpoint',
			location: { chunk: 'main.lua', line: 1, column: 1 },
			callStack: [],
			resume: () => ({ kind: 'normal' }),
		};
		emitDebuggerLifecycleEvent({
			type: 'paused',
			suspension,
			payload: {
				chunk: suspension.location.chunk,
				line: suspension.location.line,
				column: suspension.location.column,
				reason: suspension.reason,
				hint: null,
			},
			callStack: suspension.callStack,
		});
		assert.equal(executor.isSuspended(), true);

		assert.equal(issueDebuggerCommand('stepInto'), true);
		assert.deepEqual(calls, ['stepInto']);

		emitDebuggerLifecycleEvent({ type: 'continued', mode: 'continue' });
		assert.equal(executor.isSuspended(), false);
		assert.equal(issueDebuggerCommand('stepOut'), false);
		assert.deepEqual(calls, ['stepInto']);
	}
	finally {
		setDebuggerRuntimeAccessor(null);
		resetDebuggerLifecycle();
	}
});

function assertResolution(
	result: DebuggerExceptionStepResolution,
	expected: DebuggerExceptionStepResolution['kind'],
): void {
	assert.equal(result.kind, expected);
}
