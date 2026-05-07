import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CPU, Table, createNativeFunction, createNativeObject, valueString } from '../../src/bmsx/machine/cpu/cpu';
import { Memory } from '../../src/bmsx/machine/memory/memory';

test('tracked heap bytes include rooted tables and native arrays', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	const key = valueString(cpu.stringPool.intern('state'));
	const listKey = valueString(cpu.stringPool.intern('list'));

	const before = cpu.collectTrackedHeapBytes();

	const table = new Table(2, 2);
	table.set(1, 11);
	table.set(valueString(cpu.stringPool.intern('hp')), 7);
	cpu.globals.set(key, table);

	const afterTable = cpu.collectTrackedHeapBytes();
	assert.ok(afterTable > before, `expected table bytes to increase heap usage (${afterTable} <= ${before})`);

	const raw = [3, 5];
	const nativeArray = createNativeObject(raw, {
		get: (entryKey) => {
			if (typeof entryKey === 'number' && Number.isInteger(entryKey) && entryKey >= 1) {
				const value = raw[entryKey - 1];
				return value !== undefined ? value : null;
			}
			return null;
		},
		set: (entryKey, value) => {
			if (typeof entryKey !== 'number' || !Number.isInteger(entryKey) || entryKey < 1) {
				throw new Error('array expects integer keys');
			}
			raw[entryKey - 1] = value as number;
		},
		len: () => raw.length,
	});
	cpu.globals.set(listKey, nativeArray);

	const afterArray = cpu.collectTrackedHeapBytes();
	assert.ok(afterArray > afterTable, `expected native array bytes to increase heap usage (${afterArray} <= ${afterTable})`);

	cpu.globals.set(key, null);
	cpu.globals.set(listKey, null);

	const afterCleanup = cpu.collectTrackedHeapBytes();
	assert.ok(afterCleanup < afterArray, `expected cleanup to drop rooted heap usage (${afterCleanup} >= ${afterArray})`);
	assert.ok(afterCleanup >= before, `expected table capacity growth to remain tracked (${afterCleanup} < ${before})`);
});

test('tracked heap bytes include explicit extra roots for native iterators and handles', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);

	const iterator = createNativeFunction('pairs.iterator', () => {});
	const handle = createNativeObject({}, {
		get: () => null,
		set: () => {
			throw new Error('read-only');
		},
	});

	const before = cpu.collectTrackedHeapBytes();
	const after = cpu.collectTrackedHeapBytes([iterator, handle]);

	assert.ok(after > before, `expected explicit extra roots to increase tracked heap usage (${after} <= ${before})`);
});

test('tracked heap bytes do not include raw js array capacity without native iteration entries', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);

	const before = cpu.collectTrackedHeapBytes();
	const raw = new Array(1024).fill(7);
	const nativeArray = createNativeObject(raw, {
		get: (entryKey) => {
			if (typeof entryKey !== 'number' || !Number.isInteger(entryKey) || entryKey < 1 || entryKey > raw.length) {
				return null;
			}
			const value = raw[entryKey - 1];
			return value !== undefined ? value : null;
		},
		set: (entryKey, value) => {
			if (typeof entryKey !== 'number' || !Number.isInteger(entryKey) || entryKey < 1) {
				throw new Error('array expects integer keys');
			}
			raw[entryKey - 1] = value as number;
		},
		len: () => raw.length,
	});

	const after = cpu.collectTrackedHeapBytes([nativeArray]);
	assert.equal(after - before, 24, `expected native object accounting to ignore raw js array capacity (${after - before} != 24)`);
});
