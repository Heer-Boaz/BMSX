import { register } from 'node:module';
register('./glsl-loader.mjs', import.meta.url);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LuaDebuggerPauseSignal } from '../../src/bmsx/lua/runtime';
import { createLuaInterpreter, isLuaDebuggerPauseSignal } from '../../src/bmsx/lua/runtime';
import { LuaDebuggerController } from '../../src/bmsx/lua/debugger';
import { LuaRuntimeError } from '../../src/bmsx/lua/errors';
import type { LuaFunctionValue } from '../../src/bmsx/lua/value';
import { emitDebuggerLifecycleEvent } from '../../src/bmsx/machine/debugger_lifecycle';
import { getDebuggerCommandExecutor, issueDebuggerCommand } from '../../src/bmsx/ide/debugger_controls';
import { setDebuggerRuntimeAccessor } from '../../src/bmsx/machine/runtime_accessors';

function resetDebuggerLifecycle(): void {
	emitDebuggerLifecycleEvent({ type: 'continued', mode: 'continue' });
}

function expectRuntimeError(callback: () => void): LuaRuntimeError {
	let thrown: unknown;
	try {
		callback();
		assert.fail('expected runtime error');
	}
	catch (error) {
		thrown = error;
	}
	assert.ok(thrown instanceof LuaRuntimeError, 'expected LuaRuntimeError');
	assert.equal(isLuaDebuggerPauseSignal(thrown), false);
	return thrown as LuaRuntimeError;
}

test('runtime errors propagate even when debugger is attached', () => {
	resetDebuggerLifecycle();
	const interpreter = createLuaInterpreter();
	interpreter.attachDebugger(new LuaDebuggerController());
	const source = "value = 1\nerror('boom')\nvalue = value + 5\n";
	expectRuntimeError(() => interpreter.execute(source, 'main.lua'));
	assert.equal(interpreter.getGlobal('value'), 1);
	resetDebuggerLifecycle();
});

test('runtime errors inside returned functions do not become pause signals', () => {
	resetDebuggerLifecycle();
	const interpreter = createLuaInterpreter();
	interpreter.attachDebugger(new LuaDebuggerController());
	const fn = interpreter.execute('return function() error("boom") end', 'main.lua')[0] as LuaFunctionValue;
	expectRuntimeError(() => fn.call([]));
	resetDebuggerLifecycle();
});

test('breakpoints still suspend execution', () => {
	resetDebuggerLifecycle();
	const interpreter = createLuaInterpreter();
	const controller = new LuaDebuggerController();
	interpreter.attachDebugger(controller);
	const path = 'main.lua';
	controller.setBreakpoints(new Map([[path, new Set([2])]]));
	const source = "local value = 1\nvalue = value + 1\nreturn value\n";
	let suspension: LuaDebuggerPauseSignal = null;
	try {
		interpreter.execute(source, path);
		assert.fail('expected debugger suspension');
	} catch (signal) {
		assert.ok(isLuaDebuggerPauseSignal(signal), 'expected pause signal');
		suspension = signal as LuaDebuggerPauseSignal;
	}
	assert.ok(suspension, 'missing debugger suspension');
	const resumed = suspension.resume();
	if (resumed.kind === 'return') {
		assert.equal(resumed.values[0], 2);
	} else {
		assert.equal(resumed.kind, 'normal');
	}
	assert.equal(interpreter.getGlobal('value'), 2);
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
			location: { path: 'main.lua', line: 1, column: 1 },
			callStack: [],
			resume: () => ({ kind: 'normal' }),
		};
		emitDebuggerLifecycleEvent({
			type: 'paused',
			suspension,
			payload: {
				path: suspension.location.path,
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
