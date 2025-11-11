import { register } from 'node:module';
register('./glsl-loader.mjs', import.meta.url);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LuaDebuggerPauseSignal } from '../../src/bmsx/lua/runtime.ts';
import { createLuaInterpreter, isLuaDebuggerPauseSignal } from '../../src/bmsx/lua/runtime.ts';
import { LuaDebuggerController } from '../../src/bmsx/lua/debugger.ts';
import { LuaRuntimeError } from '../../src/bmsx/lua/errors.ts';
import { emitDebuggerLifecycleEvent } from '../../src/bmsx/console/debugger_lifecycle';
import { getDebuggerCommandExecutor, issueDebuggerCommand } from '../../src/bmsx/console/ide/debugger_controls';
import { setDebuggerRuntimeAccessor } from '../../src/bmsx/console/runtime_accessors';

function resetDebuggerLifecycle(): void {
	emitDebuggerLifecycleEvent({ type: 'continued', mode: 'continue' });
}

test('lua interpreter skip strategy resumes past exception line', () => {
	resetDebuggerLifecycle();
	const interpreter = createLuaInterpreter();
	const controller = new LuaDebuggerController();
	interpreter.attachDebugger(controller);
	const source = `
value = 1
error('boom')
value = value + 5
`;
	let suspension: LuaDebuggerPauseSignal | null = null;
	try {
		interpreter.execute(source, 'main.lua');
		assert.fail('Expected debugger suspension');
	} catch (error) {
		assert.ok(isLuaDebuggerPauseSignal(error), 'Expected pause signal');
		suspension = error as LuaDebuggerPauseSignal;
	}
	assert.ok(suspension, 'Missing debugger suspension');
	interpreter.setExceptionResumeStrategy('skip_statement');
	const result = suspension.resume();
	assert.equal(result.kind, 'normal');
	const globals = interpreter.getGlobalEnvironment();
	assert.equal(globals.get('value'), 6);
	resetDebuggerLifecycle();
});

test('lua interpreter propagate strategy rethrows exception when continuing', () => {
	resetDebuggerLifecycle();
	const interpreter = createLuaInterpreter();
	const controller = new LuaDebuggerController();
	interpreter.attachDebugger(controller);
	let suspension: LuaDebuggerPauseSignal | null = null;
	try {
		interpreter.execute('error(\"boom\")', 'main.lua');
		assert.fail('Expected debugger suspension');
	} catch (error) {
		assert.ok(isLuaDebuggerPauseSignal(error), 'Expected pause signal');
		suspension = error as LuaDebuggerPauseSignal;
	}
	assert.ok(suspension, 'Missing debugger suspension');
	interpreter.setExceptionResumeStrategy('propagate');
	assert.throws(() => suspension.resume(), LuaRuntimeError);
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
