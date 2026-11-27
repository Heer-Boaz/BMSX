import { valuePayload as tableAddressPayload } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { valueBool, valueInteger, valueIsClosure, valueNil, valueTable } from '../../machine/ts/machine/cpu/value';
import { GLOBAL_BANK_OFFSET, GlobalBankField } from '../../machine/ts/spec/blua32/execution_domain';
import { bootManagedTestSystem, linkManagedTestSystem } from '../helpers/managed_system';
import { materializeCpuCompletionValues, runGuestToHalt } from '../helpers/cpu_test_harness';
import { BASE_FIRMWARE_MODULES } from '../helpers/firmware_modules';


const modules = [...BASE_FIRMWARE_MODULES, { path: 'tty/console', source: 'return {}' }];

for (const level of [0, 3] as const) test(`named access and compiled GETGL/SETGL share one register at O${level}`, () => {
	const source = `require('base')
local get<const> = getglobal
local set<const> = setglobal
counter = 7
local first = get('counter')
set('counter', 13)
local second = counter
local returned = select('#', set('counter', 13))
for index = 1, 78 do set('new name ' .. index, index) end
local after_growth = counter
counter = counter + 1
shared = { hp = 20 }
local object = get('shared')
object.hp = 30
set('alias', object)
set('counter', false)
local fourth = counter
set('counter')
return first, second, get('shared').hp, fourth, counter, get('alias') == shared,
 get('absent'), after_growth, returned, get('new name 78')
`;
	const { cpu } = bootManagedTestSystem(linkManagedTestSystem(source, level, modules));
	runGuestToHalt(cpu, 1_048_576);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(7), valueInteger(13), valueInteger(30), valueBool(false), valueNil(), valueBool(true), valueNil(), valueInteger(13), valueInteger(0), valueInteger(78)]);
	assert.equal(cpu.getGlobalByKey(cpu.stringPool.find('alias')!), cpu.getGlobalByKey(cpu.stringPool.find('shared')!));
	assert.ok(cpu.memory.readRamRecordWord(cpu.heapAllocator.managementOffset() + GLOBAL_BANK_OFFSET + GlobalBankField.Capacity) >= 128);
});

test('named access cannot alias the system bank and invalid names use guest errors', () => {
	const source = `local get<const> = __bmsx_getglobal
local set<const> = require('kernel/set_global').set_global
local pcall<const> = __bmsx_pcall
function irq(value) return value end
local before = get('irq')
set('irq', 99)
local invalid_read = pcall(get, 3)
local invalid_write = pcall(set, false, 4)
local missing_name = pcall(set)
return before, get('irq'), irq(3), invalid_read, invalid_write, missing_name
`;
	const { cpu } = bootManagedTestSystem(linkManagedTestSystem(source, 3));
	runGuestToHalt(cpu, 65_536);
	const values = materializeCpuCompletionValues(cpu);
	assert.deepEqual(values.slice(0, 2), [valueNil(), valueInteger(99)]);
	assert.deepEqual(values.slice(3), [valueBool(false), valueBool(false), valueBool(false)]);
	assert.equal(values[2], valueInteger(3));
	assert.ok(valueIsClosure(cpu.getSystemGlobalByKey(cpu.stringPool.find('irq')!)));
});

test('dynamic names and values survive growth, collection and exact checkpoint restore', () => {
	const { cpu } = bootManagedTestSystem(linkManagedTestSystem('return 0', 3));
	const count = cpu.globalSlotCount;
	const capacity = cpu.heapAllocator.managementOffset() + GLOBAL_BANK_OFFSET + GlobalBankField.Capacity;
	let grewBank = false;
	for (let index = 0; index < 257; index++) {
		const key = cpu.stringPool.intern(`dynamic${index}`);
		const logical = cpu.luaHeap.usedBytes(), physical = cpu.heapAllocator.occupiedBytes();
		const previous = cpu.memory.readRamRecordWord(capacity);
		cpu.setGlobalByKey(key, valueInteger(index));
		assert.equal(cpu.luaHeap.usedBytes(), logical + 9, 'every newly registered name costs nine bytes');
		if (cpu.memory.readRamRecordWord(capacity) !== previous) {
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
	const { cpu } = bootManagedTestSystem(linkManagedTestSystem('return 0', 3));
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
