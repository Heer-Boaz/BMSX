import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareLuaArguments, prepareLuaLiteral } from '../../ide/runtime/lua_literal';
import { valueString, valueInteger, valueFloat, valueNil, valueBool, valuePayload } from '../../machine/ts/machine/cpu/value';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource } from './cpu_test_harness';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Value } from '../../machine/ts/machine/cpu/value';

test('literal submission parses without guest execution, then materializes real values', () => {
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource('return 0', 'literal.lua')));
	const before = [cpu.luaHeap.usedBytes(), cpu.luaHeap.collectionTarget()];
	const prepare = prepareLuaLiteral('{ flag = false, nested = { 7, -2.5 }, [4] = "event" }');
	assert.deepEqual([cpu.luaHeap.usedBytes(), cpu.luaHeap.collectionTarget()], before);
	const result = valuePayload(prepare(cpu));
	assert.equal(cpu.gc.tables.get(result, valueString(cpu.stringPool.find('flag')!)), valueBool(false));
	const nested = valuePayload(cpu.gc.tables.get(result, valueString(cpu.stringPool.find('nested')!)));
	assert.equal(cpu.gc.tables.getInteger(nested, 1), valueInteger(7));
	assert.equal(cpu.gc.tables.getInteger(nested, 2), valueFloat(-2.5));
	assert.equal(cpu.gc.tables.getInteger(result, 4), valueString(cpu.stringPool.find('event')!));
	assert.deepEqual(prepareLuaArguments('nil, false, 1, -2').map(literal => literal(cpu)), [valueNil(), valueBool(false), valueInteger(1), valueInteger(-2)]);
	for (const text of ['', '1, 2', 'world:spawn("actor")', 'function() end', '1; print(2)', '{ value = actor }', '{ [nil] = 1 }']) {
		assert.throws(() => prepareLuaLiteral(text));
	}
});

test('literal submission keeps exactly the compiler Integer/Float words, including wrapped and negated literals', () => {
	const text = 'nil, false, 16777217, 2.0, -0.0, -2147483648, 0xffffffff, -0xffffffff, 0x1p-149, 1e30';
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource(`return ${text}`, 'numeric-literals.lua')));
	assert.equal(cpu.runUntilDepth(0, 10000), RunResult.Halted);
	const expected: Value[] = []; cpu.readCompletionValues(expected);
	const state = cpu.captureRuntimeState();
	const actual = prepareLuaArguments(text).map(literal => literal(cpu));
	assert.deepEqual(actual, expected);
	assert.deepEqual(cpu.captureRuntimeState(), state, 'numeric preparation does not run or allocate guest work');
	assert.throws(() => prepareLuaLiteral('1e40'), /not finite/);
});
