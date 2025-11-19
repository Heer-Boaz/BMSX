import { register } from 'node:module';
register('./glsl-loader.mjs', import.meta.url);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LuaDebuggerPauseSignal } from '../../src/bmsx/lua/runtime';
import { createLuaInterpreter, isLuaDebuggerPauseSignal } from '../../src/bmsx/lua/runtime';
import { LuaDebuggerController } from '../../src/bmsx/lua/debugger';
import { LuaRuntimeError } from '../../src/bmsx/lua/errors';
import type { LuaFunctionValue } from '../../src/bmsx/lua/value';
import { emitDebuggerLifecycleEvent } from '../../src/bmsx/console/debugger_lifecycle';
import { getDebuggerCommandExecutor, issueDebuggerCommand } from '../../src/bmsx/console/ide/debugger_controls';
import { setDebuggerRuntimeAccessor } from '../../src/bmsx/console/runtime_accessors';

function resetDebuggerLifecycle(): void {
	emitDebuggerLifecycleEvent({ type: 'continued', mode: 'continue' });
}

function callExpectPause(fn: LuaFunctionValue): LuaDebuggerPauseSignal {
	try {
		fn.call([]);
		assert.fail('expected debugger pause');
	}
	catch (error) {
		assert.ok(isLuaDebuggerPauseSignal(error), 'expected debugger pause signal');
		return error;
	}
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

test('stepping after exception still breaks on next invocation', () => {
	resetDebuggerLifecycle();
	const interpreter = createLuaInterpreter();
	interpreter.attachDebugger(new LuaDebuggerController());
	const fn = interpreter.execute('return function() error(\"boom\") end', 'main.lua')[0] as LuaFunctionValue;
	const first = callExpectPause(fn);
	interpreter.setExceptionResumeStrategy('skip_statement');
	const resumed = first.resume();
	assert.equal(resumed.kind, 'normal');
	const second = callExpectPause(fn);
	assert.equal(second.reason, 'exception');
});

test('step over after exception pauses at next statement', () => {
	resetDebuggerLifecycle();
	const interpreter = createLuaInterpreter();
	const controller = new LuaDebuggerController();
	interpreter.attachDebugger(controller);
	const fn = interpreter.execute(
		`
local counter = 0
return function()
	counter = counter + 1
	error('boom')
	counter = counter + 1
end
`,
		'main.lua',
	)[0] as LuaFunctionValue;
	const suspension = callExpectPause(fn);
	interpreter.setExceptionResumeStrategy('skip_statement');
	controller.requestStepOver(suspension.callStack.length);
	const result = suspension.resume();
	assert.equal(result.kind, 'pause');
	assert.equal(result.reason, 'step');
});

test('debugger commands dispatch only when a suspension is active', () => {
	resetDebuggerLifecycle();
	const calls: string[] = [];
	const runtimeStub = {
		continueLuaDebugger: () => calls.push('continue'),
		stepOverLuaDebugger: () => calls.push('step_over'),
		stepIntoLuaDebugger: () => calls.push('step_into'),
		stepOutLuaDebugger: () => calls.push('step_out'),
		ignoreLuaException: () => calls.push('ignoreException'),
		stepOutLuaException: () => calls.push('step_out_exception'),
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
			metrics: null,
		});
		assert.equal(executor.isSuspended(), true);

		assert.equal(issueDebuggerCommand('step_into'), true);
		assert.equal(issueDebuggerCommand('ignoreException'), true);
		assert.equal(issueDebuggerCommand('step_out_exception'), true);
		assert.deepEqual(calls, ['step_into', 'ignoreException', 'step_out_exception']);

		emitDebuggerLifecycleEvent({ type: 'continued', mode: 'continue' });
		assert.equal(executor.isSuspended(), false);
		assert.equal(issueDebuggerCommand('step_out'), false);
		assert.deepEqual(calls, ['step_into', 'ignoreException', 'step_out_exception']);
	}
	finally {
		setDebuggerRuntimeAccessor(null);
		resetDebuggerLifecycle();
	}
});
