import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { Table } from '../../machine/ts/machine/cpu/table';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource, materializeCpuCompletionValues, parseLuaChunk } from './cpu_test_harness';

import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';

const bootSource = 'getglobal = __bmsx_getglobal; setglobal = __bmsx_setglobal; pcall = __bmsx_pcall';
const boot = { path: 'boot', source: bootSource, chunk: parseLuaChunk(bootSource, 'boot.lua') };

for (const level of [0, 3] as const) test(`named access and compiled GETGL/SETGL share one register at O${level}`, () => {
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
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaChunkToProgram(
		parseLuaChunk(source, 'global-register-access.lua'), [boot], { entrySource: source, optLevel: level, programDomain: 'system' },
	)));
	cpu.installBootPrimitives();
	assert.equal(cpu.runUntilDepth(0, 10000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [7, 13, 30, false, null, true, null]);
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
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaChunkToProgram(
		parseLuaChunk(source, 'global-banks.lua'), [boot], { entrySource: source, programDomain: 'system' },
	)));
	cpu.installBootPrimitives();
	assert.equal(cpu.runUntilDepth(0, 10000), RunResult.Halted);
	const values = materializeCpuCompletionValues(cpu);
	assert.deepEqual(values.slice(0, 2), [null, 99]);
	assert.deepEqual(values.slice(3), [false, false, false]);
	assert.equal(values[2], 3);
	assert.notEqual(cpu.getSystemGlobalByKey(cpu.stringPool.find('irq')!), 99);
});

test('dynamic names and values survive growth, collection and exact checkpoint restore', () => {
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource('return 0', 'global-growth.lua')));
	const count = cpu.globalSlotCount;
	for (let index = 0; index < 257; index++) {
		const key = cpu.stringPool.intern(`dynamic${index}`);
		cpu.setGlobalByKey(key, ValueTag.Number, index, null);
	}
	const objectKey = cpu.stringPool.intern('object');
	const object = cpu.createTable(1);
	object.set(1, 42);
	cpu.setGlobalByKey(objectKey, ValueTag.Table, NaN, object);
	const nilKey = cpu.stringPool.intern('nil-name');
	cpu.setGlobalByKey(nilKey, ValueTag.Nil, NaN, null);
	assert.equal(cpu.globalSlotCount, count + 259);
	cpu.collectTrackedHeapBytes();
	const names = cpu.stringPool.captureState();
	const anchor = cpu.captureRuntimeState();
	for (let index = 0; index < 257; index++) assert.equal(cpu.getGlobalByKey(cpu.stringPool.find(`dynamic${index}`)!), index);
	cpu.setGlobalByKey(objectKey, ValueTag.Nil, NaN, null);
	cpu.setGlobalByKey(cpu.stringPool.intern('future'), ValueTag.Number, 100, null);
	cpu.collectTrackedHeapBytes();
	cpu.stringPool.restoreState(names);
	cpu.restoreRuntimeState(anchor);
	assert.deepEqual(cpu.captureRuntimeState(), anchor);
	assert.equal((cpu.getGlobalByKey(objectKey) as Table).get(1), 42);
	assert.equal(cpu.stringPool.toString(nilKey), 'nil-name');
	assert.equal(cpu.globalSlotCount, count + 259);
});

test('registered writes allocate no guest heap and missing reads create no registers', () => {
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource('return 0', 'global-reuse.lua')));
	const key = cpu.stringPool.intern('value'), absent = cpu.stringPool.intern('absent');
	cpu.setGlobalByKey(key, ValueTag.Number, 0, null);
	const count = cpu.globalSlotCount, heap = cpu.luaHeap.captureState();
	for (let index = 0; index < 10000; index++) {
		cpu.setGlobalByKey(key, ValueTag.Number, index, null);
		assert.equal(cpu.getGlobalByKey(key), index);
		assert.equal(cpu.getGlobalByKey(absent), null);
	}
	assert.equal(cpu.globalSlotCount, count);
	assert.deepEqual(cpu.luaHeap.captureState(), heap);
});
