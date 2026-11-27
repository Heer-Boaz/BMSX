import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLuaStackFrames, readRuntimeStackFrames } from '../../ide/runtime/stack_trace';
import { createLiveStudioFixture } from '../helpers/live_studio';

test('Terminal evaluates byte input in guest code and returns to a stopped IRQ', async t => {
	const { ide, runtime, sources, until } = await createLiveStudioFixture(t, { ready: ide => ide.luaEvaluation.canEvaluate });
	const { cpu } = runtime.machine;
	const terminal = ide.luaEvaluation;
	t.mock.method(cpu.stringPool, 'intern', () => assert.fail('Terminal must not intern Strings in the host'));

	const input = terminal.evaluate(`-- ${'x'.repeat(300)}
counter = 40
local text = 'é🧭'
return counter, #text, string.byte(text, 1), string.byte(text, 6), nil, false`, 'session');
	await until(() => input.result !== undefined);
	assert.deepEqual(await input.completion, { status: 'completed', values: ['40', '6', '195', '173', 'nil', 'false'] });

	const invalid = terminal.evaluate('local x = ;', 'cart');
	await until(() => invalid.result !== undefined);
	assert.equal(invalid.result!.status, 'lua-error');
	assert.match(invalid.result!.values[0], new RegExp(`=evaluation:${invalid.id}\\b`));

	const irq = { contextId: sources.currentBlua32Media.cartridgeSlots[0]!.sourceContextId, path: 'cartlib/irq.lua' };
	const line = sources.catalog.resolveLuaSource(irq)!.record.src.split('\n').findIndex(source => source.includes('local pending = flags')) + 1;
	ide.debugger.breakpoints.toggle(irq, line);
	const running = ide.debuggerExecution.resume('continue', 'workbench');
	await until(() => running.result !== undefined);
	await until(() => terminal.canEvaluate);
	const stop = ide.debugger.source.stop!, exceptionDepth = cpu.readExceptionReturnFrameDepth();
	assert.ok(exceptionDepth >= 0, 'the selected IRQ is still in progress');
	const frame = buildLuaStackFrames(readRuntimeStackFrames(cpu, sources)).frames[0];
	const original = Array.from({ length: cpu.getFrameDepth() }, (_, index) => cpu.readFramePc(index));
	const scoped = terminal.evaluate('local original = flags; flags = original + 16; return original, flags, nil, false', terminal.frameContext(frame));
	await until(() => scoped.result !== undefined);
	assert.equal(scoped.result!.status, 'completed');
	const [before, after, ...tail] = scoped.result!.values;
	assert.equal(+after, +before + 16);
	assert.deepEqual(tail, ['nil', 'false']);
	assert.equal(ide.debugger.source.stop, stop);
	assert.equal(cpu.readExceptionReturnFrameDepth(), exceptionDepth);
	assert.deepEqual(Array.from({ length: cpu.getFrameDepth() }, (_, index) => cpu.readFramePc(index)), original);
});
