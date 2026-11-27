import { compileHeapServiceSystem, residentFunctionAddress } from '../helpers/heap_service_system';
import { tableConstructorHints } from '../helpers/table_constructor';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { valueInteger, valueIsTable, valueNil, valuePayload, valueResidentFunction } from '../../machine/ts/machine/cpu/value';
import { createTestSystemCpu, disassembleTestBlua32Functions, linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource, materializeCpuCompletionValues, runGuestToHalt } from '../helpers/cpu_test_harness';

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
		const compiled = compileHeapServiceSystem(source, optLevel, [], 'table_shapes.lua');
		const image = linkTestSystemBlua32(compiled);
		const capacities = tableConstructorHints(compiled, compiled.entryProtoIndex);
		assert.deepEqual(capacities, optLevel === 3 ? [[0, 0], [0, 1], [0, 1], [2, 2]] : [[0, 0], [0, 1], [0, 0], [0, 0]]);
		const { cpu } = createTestSystemCpu(image);
		cpu.setGlobalByKey(cpu.stringPool.find('setmetatable')!, valueResidentFunction(residentFunctionAddress(image, 'kernel/gc_barrier', 'set_metatable')));
		runGuestToHalt(cpu, 100_000);
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
	const compiled = compileLuaSource(source, 'table_shape_boundaries.lua', 3);
	const capacities = tableConstructorHints(compiled, compiled.entryProtoIndex);
	assert.deepEqual(capacities, [[0, 0], [0, 0], [0, 0], [0, 0]]);
});

test('O3 puts a distinct suffix field request on the writes of a dynamically returned table', () => {
	const source = `
local factory<const> = {}
factory.make = function() return { original = 3 } end
local function build()
	local instance<const>, aux<const> = factory.make()
	instance.one = 11
	instance["two"] = 12
	instance.one = 13
	instance.three = 14
	instance.skip = nil
	instance.four = 15
	return instance, aux
end
local function alternate() return { original = 7 }, 20 end
factory.make = alternate
local result<const>, status<const> = build()
return result.original, result.one, result.two, result.three, result.four, status, result
`;
	for (const level of [0, 3] as const) {
		const image = linkTestSystemBlua32(compileHeapServiceSystem(source, level, [], 'table_growth_request.lua'));
		const fieldRuns = image.symbols.functionAddresses.map(address => Array.from(
			disassembleTestBlua32Functions(image, [address]).matchAll(/; \+(\d+) hash slots/g), match => Number(match[1]),
		)).filter(run => run.length > 0);
		assert.equal(fieldRuns.length > 0, level === 3);
		for (const run of fieldRuns) assert.deepEqual(run, [2, 2, 1]);
		const { cpu } = createTestSystemCpu(image);
		runGuestToHalt(cpu, 100_000);
		const results = materializeCpuCompletionValues(cpu);
		assert.deepEqual(results.slice(0, -1), [7, 13, 12, 14, 15, 20].map(valueInteger));
		assert.equal(cpu.gc.tables.hashSize(valuePayload(results[6])), 8);
	}
});

test('O3 does not request growth across receiver, scope, rebinding, or return boundaries', () => {
	const source = `
local function build(factory, other)
	local instance<const> = factory()
	instance.first = 1
	other.field = 2
	instance.last = 3
	do
		local instance<const> = other
		instance.x = 4
		instance.y = 5
	end
	return instance
end
local function rebound(factory, other)
	local instance = factory()
	instance.x = 1
	instance = other
	instance.y = 2
	instance.z = 3
	return instance
end
local function different_result(factory)
	local instance<const> = factory()
	instance.a = 1
	instance.b = 2
	return instance.a
end
local function explicit_effect(factory, effect)
	local instance<const> = factory()
	instance.a = 1
	instance.b = effect(instance)
	instance.c = 3
	return instance
end
return build, rebound, different_result, explicit_effect
`;
	const image = linkTestSystemBlua32(compileLuaSource(source, 'table_growth_boundaries.lua', 3));
	const text = disassembleTestBlua32Functions(image, image.symbols.functionAddresses);
	assert.doesNotMatch(text, /hash slots/);
});
