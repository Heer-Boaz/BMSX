import { compileTestSystemWithHeap } from '../helpers/heap_service_system';
import { valuePayload as tableAddressPayload } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { valueBool, valueInteger, valueIsClosure, valueNil, valueTable } from '../../machine/ts/machine/cpu/value';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource, materializeCpuCompletionValues, parseLuaChunk, runGuestToHalt } from '../helpers/cpu_test_harness';


const bootSource = 'getglobal = __bmsx_getglobal; setglobal = __bmsx_setglobal; pcall = __bmsx_pcall';
const boot = { path: 'boot', source: bootSource, chunk: parseLuaChunk(bootSource, 'boot.lua') };

for (const level of [3] as const) test(`named access and compiled GETGL/SETGL share one register at O${level}`, () => {
	const source = `require('boot')
local get<const> = getglobal
local set<const> = setglobal
counter = 7
local first = get('counter')
set('counter', 13)
local second = counter
counter = counter + 1
shared = { hp = 20 }
local object = get('shared')
object.hp = 30
set('alias', object)
set('counter', false)
local fourth = counter
set('counter')
return first, second, get('shared').hp, fourth, counter, get('alias') == shared,
 get('absent')
`;
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileTestSystemWithHeap(
		parseLuaChunk(source, 'global-register-access.lua'), [boot], { entrySource: source, optLevel: level, programDomain: 'system' },
	)));
	runGuestToHalt(cpu, 65_536);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(7), valueInteger(13), valueInteger(30), valueBool(false), valueNil(), valueBool(true), valueNil()]);
	assert.equal(cpu.getGlobalByKey(cpu.stringPool.find('alias')!), cpu.getGlobalByKey(cpu.stringPool.find('shared')!));
});

test('named access cannot alias the system bank and invalid names use guest errors', () => {
	const source = `require('boot')
local get<const> = getglobal
local set<const> = setglobal
function irq(value) return value end
local before = get('irq')
set('irq', 99)
local invalid_read = pcall(get, 3)
local invalid_write = pcall(set, false, 4)
local missing_name = pcall(set)
return before, get('irq'), irq(3), invalid_read, invalid_write, missing_name
`;
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileTestSystemWithHeap(
		parseLuaChunk(source, 'global-banks.lua'), [boot], { entrySource: source, programDomain: 'system' },
	)));
	runGuestToHalt(cpu, 65_536);
	const values = materializeCpuCompletionValues(cpu);
	assert.deepEqual(values.slice(0, 2), [valueNil(), valueInteger(99)]);
	assert.deepEqual(values.slice(3), [valueBool(false), valueBool(false), valueBool(false)]);
	assert.equal(values[2], valueInteger(3));
	assert.ok(valueIsClosure(cpu.getSystemGlobalByKey(cpu.stringPool.find('irq')!)));
});

test('dynamic names and values survive growth, collection and exact checkpoint restore', () => {
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource('return 0', 'global-growth.lua')));
	const count = cpu.globalSlotCount;
	let grewBank = false;
	for (let index = 0; index < 257; index++) {
		const key = cpu.stringPool.intern(`dynamic${index}`);
		const logical = cpu.luaHeap.usedBytes(), physical = cpu.heapAllocator.occupiedBytes();
		const previous = cpu.captureRuntimeState().globals.capacity;
		cpu.setGlobalByKey(key, valueInteger(index));
		assert.equal(cpu.luaHeap.usedBytes(), logical + 9, 'every newly registered name costs nine bytes');
		if (cpu.captureRuntimeState().globals.capacity !== previous) {
			grewBank = true;
			assert.ok(cpu.heapAllocator.occupiedBytes() > physical, 'the physical index reserve grows separately');
		} else assert.equal(cpu.heapAllocator.occupiedBytes(), physical, 'members can grow without growing the reserve');
	}
	assert.ok(grewBank, 'the names cross an actual capacity boundary');
	const objectKey = cpu.stringPool.intern('object');
	const object = cpu.createTable(1);
	cpu.gc.tables.setInteger(object, 1, valueInteger(42));
	cpu.setGlobalByKey(objectKey, valueTable(object));
	const nilKey = cpu.stringPool.intern('nil-name');
	cpu.setGlobalByKey(nilKey, valueNil());
	assert.equal(cpu.globalSlotCount, count + 259);
	cpu.collectTrackedHeapBytes();

	const memory = cpu.memory.captureSaveState();
	const anchor = cpu.captureRuntimeState();
	const usage = cpu.luaHeap.usedBytes();
	for (let index = 0; index < 257; index++) assert.equal(cpu.getGlobalByKey(cpu.stringPool.find(`dynamic${index}`)!), valueInteger(index));
	cpu.setGlobalByKey(objectKey, valueNil());
	cpu.setGlobalByKey(cpu.stringPool.intern('future'), valueInteger(100));
	cpu.collectTrackedHeapBytes();

	cpu.memory.restoreSaveState(memory);
	cpu.restoreRuntimeState(anchor);
	assert.equal(cpu.luaHeap.usedBytes(), usage, 'restore retains the logical count independently of capacity');
	assert.deepEqual(cpu.captureRuntimeState(), anchor);
	assert.equal(cpu.gc.tables.getInteger(tableAddressPayload(cpu.getGlobalByKey(objectKey)), 1), valueInteger(42));
	assert.equal(cpu.stringPool.toString(nilKey), 'nil-name');
	assert.equal(cpu.globalSlotCount, count + 259);
});

test('registered writes allocate no guest heap and missing reads create no registers', () => {
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource('return 0', 'global-reuse.lua')));
	const key = cpu.stringPool.intern('value'), absent = cpu.stringPool.intern('absent');
	cpu.setGlobalByKey(key, valueInteger(0));
	const count = cpu.globalSlotCount, heap = [cpu.luaHeap.usedBytes(), cpu.luaHeap.collectionTarget()];
	for (let index = 0; index < 10000; index++) {
		cpu.setGlobalByKey(key, valueInteger(index));
		assert.equal(cpu.getGlobalByKey(key), valueInteger(index));
		assert.equal(cpu.getGlobalByKey(absent), valueNil());
	}
	assert.equal(cpu.globalSlotCount, count);
	assert.deepEqual([cpu.luaHeap.usedBytes(), cpu.luaHeap.collectionTarget()], heap);
});
