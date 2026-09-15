import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareLuaArguments, prepareLuaLiteral } from '../../ide/runtime/lua_literal';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { valueString } from '../../machine/ts/machine/cpu/value';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource } from './cpu_test_harness';

test('literal submission parses without guest execution, then materializes real values', () => {
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource('return 0', 'literal.lua')));
	const before = cpu.luaHeap.captureState();
	const prepare = prepareLuaLiteral('{ flag = false, nested = { 7, -2.5 }, [4] = "event" }');
	assert.deepEqual(cpu.luaHeap.captureState(), before);
	const result = prepare(cpu) as Table;
	assert.equal(result.get(valueString(cpu.stringPool.find('flag')!)), false);
	const nested = result.get(valueString(cpu.stringPool.find('nested')!)) as Table;
	assert.equal(nested.getInteger(1), 7);
	assert.equal(nested.getInteger(2), -2.5);
	assert.equal(result.getInteger(4), valueString(cpu.stringPool.find('event')!));
	assert.deepEqual(prepareLuaArguments('nil, false, 1, -2').map(literal => literal(cpu)), [null, false, 1, -2]);
	for (const text of ['', '1, 2', 'world:spawn("actor")', 'function() end', '1; print(2)', '{ value = actor }', '{ [nil] = 1 }']) {
		assert.throws(() => prepareLuaLiteral(text));
	}
});
