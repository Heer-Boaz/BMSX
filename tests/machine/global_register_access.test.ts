import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import { setReferenceGlobal } from '../helpers/global_bank_reference';
import { valuePayload as tableAddressPayload } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { valueBool, valueInteger, valueIsClosure, valueNil, valueTable } from '../../machine/ts/machine/cpu/value';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { GLOBAL_BANK_OFFSET, GlobalBankField } from '../../machine/ts/spec/blua32/execution_domain';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';
import { linkManagedTestSystem } from '../helpers/managed_system';
import { materializeCpuCompletionValues, runGuestToHalt } from '../helpers/cpu_test_harness';
import { BASE_FIRMWARE_MODULES } from '../helpers/firmware_modules';


const modules = [...BASE_FIRMWARE_MODULES, { path: 'tty/console', source: 'return {}' }];
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

function run(source: string, level: 0 | 3, linkedModules: typeof modules = []) {
	const rom = writeTestBlua32Rom(linkManagedTestSystem(source, level, linkedModules));
	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu } = runtime.machine;
	runGuestToHalt(cpu, 3_000_000);
	return cpu;
}

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
	const cpu = run(source, level, modules);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(7), valueInteger(13), valueInteger(30), valueBool(false), valueNil(), valueBool(true), valueNil(), valueInteger(13), valueInteger(0), valueInteger(78)]);
	assert.equal(cpu.getGlobalByKey(nativeHeapReference(cpu).stringPool.find('alias')!), cpu.getGlobalByKey(nativeHeapReference(cpu).stringPool.find('shared')!));
	assert.ok(cpu.memory.readRamRecordWord(nativeHeapReference(cpu).heapAllocator.managementOffset() + GLOBAL_BANK_OFFSET + GlobalBankField.Capacity) >= 128);
});

test('named access cannot alias the system bank and invalid names use guest errors', () => {
	const source = `local get<const> = require('kernel/get_global_entry')
local set<const> = require('kernel/set_global_entry')
local startup<const> = require('bmsx/startup')
local pcall<const> = blua32.closure(startup.protected_call)
function irq(value) return value end
local before = get('irq')
set('irq', 99)
local invalid_read = pcall(get, 3)
local invalid_write = pcall(set, false, 4)
local missing_name = pcall(set)
return before, get('irq'), irq(3), invalid_read, invalid_write, missing_name
`;
	const cpu = run(source, 3);
	const values = materializeCpuCompletionValues(cpu);
	assert.deepEqual(values.slice(0, 2), [valueNil(), valueInteger(99)]);
	assert.deepEqual(values.slice(3), [valueBool(false), valueBool(false), valueBool(false)]);
	assert.equal(values[2], valueInteger(3));
	assert.ok(valueIsClosure(cpu.getSystemGlobalByKey(nativeHeapReference(cpu).stringPool.find('irq')!)));
});

test('dynamic names and values survive growth, collection and exact checkpoint restore', () => {
	const cpu = run('return 0', 3);
	const count = cpu.globalSlotCount;
	const capacity = nativeHeapReference(cpu).heapAllocator.managementOffset() + GLOBAL_BANK_OFFSET + GlobalBankField.Capacity;
	let grewBank = false;
	for (let index = 0; index < 257; index++) {
		const key = nativeHeapReference(cpu).stringPool.intern(`dynamic${index}`);
		const logical = nativeHeapReference(cpu).luaHeap.usedBytes(), physical = nativeHeapReference(cpu).heapAllocator.occupiedBytes();
		const previous = cpu.memory.readRamRecordWord(capacity);
		setReferenceGlobal(cpu, key, valueInteger(index));
		assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), logical + 9, 'every newly registered name costs nine bytes');
		if (cpu.memory.readRamRecordWord(capacity) !== previous) {
			grewBank = true;
			assert.ok(nativeHeapReference(cpu).heapAllocator.occupiedBytes() > physical, 'the physical index reserve grows separately');
		} else assert.equal(nativeHeapReference(cpu).heapAllocator.occupiedBytes(), physical, 'members can grow without growing the reserve');
	}
	assert.ok(grewBank, 'the names cross an actual capacity boundary');
	const objectKey = nativeHeapReference(cpu).stringPool.intern('object');
	const object = createReferenceTable(cpu, 1);
	nativeHeapReference(cpu).gc.tables.setInteger(object, 1, valueInteger(42));
	setReferenceGlobal(cpu, objectKey, valueTable(object));
	const nilKey = nativeHeapReference(cpu).stringPool.intern('nil-name');
	setReferenceGlobal(cpu, nilKey, valueNil());
	assert.equal(cpu.globalSlotCount, count + 259);
	nativeHeapReference(cpu).gc.collect();

	const memory = cpu.memory.captureSaveState();
	const anchor = cpu.captureRuntimeState();
	const usage = nativeHeapReference(cpu).luaHeap.usedBytes();
	for (let index = 0; index < 257; index++) assert.equal(cpu.getGlobalByKey(nativeHeapReference(cpu).stringPool.find(`dynamic${index}`)!), valueInteger(index));
	setReferenceGlobal(cpu, objectKey, valueNil());
	setReferenceGlobal(cpu, nativeHeapReference(cpu).stringPool.intern('future'), valueInteger(100));
	nativeHeapReference(cpu).gc.collect();

	cpu.memory.restoreSaveState(memory);
	cpu.restoreRuntimeState(anchor);
	assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), usage, 'restore retains the logical count independently of capacity');
	assert.deepEqual(cpu.captureRuntimeState(), anchor);
	assert.equal(cpu.tables.getInteger(tableAddressPayload(cpu.getGlobalByKey(objectKey)), 1), valueInteger(42));
	assert.equal(cpu.stringPool.toString(nilKey), 'nil-name');
	assert.equal(cpu.globalSlotCount, count + 259);
});

test('registered writes allocate no guest heap and missing reads create no registers', () => {
	const cpu = run('return 0', 3);
	const key = nativeHeapReference(cpu).stringPool.intern('value'), absent = nativeHeapReference(cpu).stringPool.intern('absent');
	setReferenceGlobal(cpu, key, valueInteger(0));
	const count = cpu.globalSlotCount, heap = [nativeHeapReference(cpu).luaHeap.usedBytes(), nativeHeapReference(cpu).luaHeap.collectionTarget()];
	for (let index = 0; index < 10000; index++) {
		setReferenceGlobal(cpu, key, valueInteger(index));
		assert.equal(cpu.getGlobalByKey(key), valueInteger(index));
		assert.equal(cpu.getGlobalByKey(absent), valueNil());
	}
	assert.equal(cpu.globalSlotCount, count);
	assert.deepEqual([nativeHeapReference(cpu).luaHeap.usedBytes(), nativeHeapReference(cpu).luaHeap.collectionTarget()], heap);
});
