import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { valueBuiltinFunction, valueInteger, valueIsTable, valueNil } from '../../machine/ts/machine/cpu/value';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { createTestSystemCpu, disassembleTestBlua32Functions, linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource, materializeCpuCompletionValues } from '../helpers/cpu_test_harness';

test('O3 predicts a fresh local table shape without moving or replacing stores', () => {
	const source = `
local forwarded<const> = {}
local mt<const> = { __newindex = forwarded }
local receiver<const> = setmetatable({}, mt)
receiver.x = 31
receiver["x"] = 32
receiver.z = nil
local plain = {}
plain.alpha = 41
plain["beta"] = 42
plain[1] = 51
plain[2.0] = 52
plain[10] = 60
return receiver.x, forwarded.x, plain.alpha, plain.beta, plain[1], plain[2], plain[10], plain
`;
	for (const optLevel of [0, 3] as const) {
		const image = linkTestSystemBlua32(compileLuaSource(source, 'table_shapes.lua', optLevel));
		const text = disassembleTestBlua32Functions(image, image.symbols.functionAddresses);
		const capacities = Array.from(text.matchAll(/\bNEWT r\d+, (\d+), (\d+)/g), match => match.slice(1).map(Number));
		assert.deepEqual(capacities, optLevel === 3 ? [[0, 0], [0, 1], [0, 1], [2, 2]] : [[0, 0], [0, 1], [0, 0], [0, 0]]);
		const { cpu } = createTestSystemCpu(image);
		cpu.setGlobalByKey(cpu.stringPool.find('setmetatable')!, valueBuiltinFunction(BuiltinFunctionId.SetMetatable));
		assert.equal(cpu.runUntilDepth(0, 1_000), RunResult.Halted);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		const results = materializeCpuCompletionValues(cpu);
		assert.deepEqual(results.slice(0, -1), [valueNil(), ...[32, 41, 42, 51, 52, 60].map(valueInteger)]);
		assert.ok(valueIsTable(results.at(-1)!));
	}
});

test('O3 does not infer a shape through a shadowed constructor, a rebound local, or a nested function', () => {
	const source = `
local function setmetatable(table, ignored)
	return table
end
local replacement<const> = {}
local shadow<const> = setmetatable({}, replacement)
shadow.field = 1
local rebound = {}
local original = rebound
rebound = replacement
rebound.other = 2
local captured<const> = {}
local function add_captured_field()
	captured.field = 3
end
return shadow, original, captured, add_captured_field, replacement
`;
	const image = linkTestSystemBlua32(compileLuaSource(source, 'table_shape_boundaries.lua', 3));
	const text = disassembleTestBlua32Functions(image, image.symbols.functionAddresses);
	const capacities = Array.from(text.matchAll(/\bNEWT r\d+, (\d+), (\d+)/g), match => match.slice(1).map(Number));
	assert.deepEqual(capacities, [[0, 0], [0, 0], [0, 0], [0, 0]]);
});
