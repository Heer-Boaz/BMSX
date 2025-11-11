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
