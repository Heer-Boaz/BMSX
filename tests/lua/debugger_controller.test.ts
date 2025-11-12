import { register } from 'node:module';
register('./glsl-loader.mjs', import.meta.url);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLuaInterpreter, type ExecutionSignal } from '../../src/bmsx/lua/runtime.ts';
import { LuaDebuggerController } from '../../src/bmsx/lua/debugger.ts';

function expectPause(result: ExecutionSignal | LuaDebuggerPauseSignal): LuaDebuggerPauseSignal {
	assert.equal(result.kind, 'pause');
	return result as LuaDebuggerPauseSignal;
}

type LuaDebuggerPauseSignal = Extract<ExecutionSignal, { kind: 'pause' }>;

function createPauseSignal(reason: LuaDebuggerPauseSignal['reason']): LuaDebuggerPauseSignal {
	return {
		kind: 'pause',
		reason,
		location: { chunk: 'main.lua', line: 1, column: 1 },
		callStack: [{ functionName: 'entry', source: 'main.lua', line: 1, column: 1 }],
		resume: () => ({ kind: 'normal' }),
	};
}

test('breakpoint pause resumes execution to completion', () => {
	const interpreter = createLuaInterpreter();
	const controller = new LuaDebuggerController();
	interpreter.attachDebugger(controller);
	const chunkName = 'break_test.lua';
	controller.setBreakpoints(new Map([[chunkName, new Set([2])]]));
	const source = `
local value = 1
value = value + 5
return value
`;
	try {
		interpreter.execute(source, chunkName);
		assert.fail('expected breakpoint pause');
	}
	catch (signal) {
		const pause = expectPause(signal as ExecutionSignal);
		assert.equal(pause.reason, 'breakpoint');
		assert.equal(pause.location.line, 2);
		const resumeResult = pause.resume();
		assert.ok(resumeResult.kind === 'normal' || resumeResult.kind === 'return', `unexpected resume kind ${resumeResult.kind}`);
	}
});

test('step over pauses only after returning to the same depth', () => {
	const interpreter = createLuaInterpreter();
	const controller = new LuaDebuggerController();
	interpreter.attachDebugger(controller);
	controller.requestStepInto();
	const chunkName = 'step_over.lua';
	const source = `
local function inner()
  local v = 10
  return v * 2
end
local total = inner()
total = total + 1
return total
`;
	let firstPause: LuaDebuggerPauseSignal | null = null;
	try {
		interpreter.execute(source, chunkName);
		assert.fail('expected pause from step-into');
	} catch (signal) {
		firstPause = expectPause(signal as ExecutionSignal);
		assert.equal(firstPause.reason, 'step');
	}
	assert(firstPause);
	controller.requestStepOver(firstPause.callStack.length);
	const second = expectPause(firstPause.resume());
	assert.equal(second.reason, 'step');
	assert.ok(second.callStack.length <= firstPause.callStack.length);
	const completion = second.resume();
	assert.ok(completion.kind === 'normal' || completion.kind === 'return');
});

test('async carry requests pause on next invocation with augmented stack', () => {
	const controller = new LuaDebuggerController();
	controller.requestStepOver(0);
	const suspension = createPauseSignal('step');
	controller.handleSilentResumeResult('stepOver', suspension);
	assert.equal(controller.isActive(), true);
	const reason = controller.shouldPause('async.lua', 1, 0);
	assert.equal(reason, 'step');
	const augmented = controller.decorateCallStack([
		{ functionName: 'asyncEntry', source: 'async.lua', line: 1, column: 1 },
	]);
	assert.equal(augmented.length, 3);
	assert.equal(augmented[2].functionName, 'entry');
	assert.equal(augmented[1].functionName, '[async resume:stepOver]');
});

test('ignoreException command toggles skip strategy', () => {
	const controller = new LuaDebuggerController();
	const suspension = createPauseSignal('exception');
	const strategy = controller.prepareResume('ignoreException', suspension);
	assert.equal(strategy, 'skip_statement');
});

test('step commands skip exceptions automatically', () => {
	const controller = new LuaDebuggerController();
	const suspension = createPauseSignal('exception');
	const strategy = controller.prepareResume('stepOver', suspension);
	assert.equal(strategy, 'skip_statement');
});

test('session metrics record pauses and skips', () => {
	const controller = new LuaDebuggerController();
	controller.handlePause(createPauseSignal('breakpoint'));
	controller.handlePause(createPauseSignal('exception'));
	const metrics = controller.getSessionMetrics();
	assert.equal(metrics.pauseCount, 2);
	assert.equal(metrics.exceptionCount, 1);
	const suspension = createPauseSignal('exception');
	controller.prepareResume('ignoreException', suspension);
	const updated = controller.getSessionMetrics();
	assert.equal(updated.skippedExceptionCount, 1);
	assert.ok(updated.lastExceptionLocation);
});

test('active step requests survive until consumed', () => {
	const controller = new LuaDebuggerController();
	controller.requestStepInto();
	assert.equal(controller.hasActiveSteppingRequest(), true);
	assert.equal(controller.shouldPause('main.lua', 1, 0), 'step');
	assert.equal(controller.hasActiveSteppingRequest(), false);

	controller.requestStepOver(3);
	const suspension = createPauseSignal('step');
	controller.handleSilentResumeResult('stepOver', suspension);
	assert.equal(controller.hasActiveSteppingRequest(), true);
	assert.equal(controller.shouldPause('async.lua', 5, 1), 'step');
	assert.equal(controller.hasActiveSteppingRequest(), false);
});
