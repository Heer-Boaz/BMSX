import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BuiltinFunctionId, CPU, RunResult, StringValue, createBuiltinFunction, type CpuRuntimeState } from '../../machine/ts/machine/cpu/cpu';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { compileLuaSource } from './cpu_test_harness';

function createCpuWithProgram(source: string): { cpu: CPU; entryProtoIndex: number } {
	const compiled = compileLuaSource(source, 'ram_accounting.lua');
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	cpu.setProgram(compiled.program, compiled.metadata, compiled.metadata);
	return { cpu, entryProtoIndex: compiled.entryProtoIndex };
}

function collectHeapDeltaAfterRun(source: string): { before: number; after: number } {
	const { cpu, entryProtoIndex } = createCpuWithProgram(source);
	const before = cpu.collectTrackedHeapBytes();
	cpu.start(entryProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	return { before, after: cpu.collectTrackedHeapBytes() };
}

test('tracked heap bytes include rooted tables and native arrays', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	const key = StringValue.get(cpu.stringPool.intern('state'));
	const listKey = StringValue.get(cpu.stringPool.intern('list'));

	const before = cpu.collectTrackedHeapBytes();

	const table = cpu.createTable(2, 2);
	table.set(1, 11);
	table.set(StringValue.get(cpu.stringPool.intern('hp')), 7);
	cpu.globals.set(key, table);

	const afterTable = cpu.collectTrackedHeapBytes();
	assert.ok(afterTable > before, `expected table bytes to increase heap usage (${afterTable} <= ${before})`);

	const raw = [3, 5];
	const nativeArray = cpu.createNativeObject(raw, {
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
		nextEntry: () => null,
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

test('tracked heap bytes include explicit extra roots for native functions and handles', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const cpu = new CPU(memory);

	const nativeFn = cpu.createNativeFunction('external.iterator', () => {});
	const handle = cpu.createNativeObject({}, {
		get: () => null,
		set: () => {
			throw new Error('read-only');
		},
		len: () => 0,
		nextEntry: () => null,
	});

	const before = cpu.collectTrackedHeapBytes();
	const after = cpu.collectTrackedHeapBytes([nativeFn, handle]);

	assert.ok(after > before, `expected explicit extra roots to increase tracked heap usage (${after} <= ${before})`);
});

test('builtin primitives are static VM slots outside Lua heap accounting', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	const next = createBuiltinFunction(BuiltinFunctionId.Next);
	const before = cpu.collectTrackedHeapBytes();

	assert.equal(createBuiltinFunction(BuiltinFunctionId.Next), next);
	assert.equal(cpu.collectTrackedHeapBytes([next]), before);
});

test('builtin primitive save-state uses VM id instead of stable global path', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	cpu.globals.setStringKey(StringValue.get(cpu.stringPool.intern('foo')), createBuiltinFunction(BuiltinFunctionId.Next));

	const state = cpu.captureRuntimeState(new Map());
	assert.deepEqual(state.globals, [
		{ name: 'foo', value: { tag: 'builtin', id: BuiltinFunctionId.Next } },
	]);

	const restoredCpu = new CPU(memory);
	restoredCpu.restoreRuntimeState(state, new Map());
	assert.equal(
		restoredCpu.globals.getStringKey(StringValue.get(restoredCpu.stringPool.intern('foo'))),
		createBuiltinFunction(BuiltinFunctionId.Next),
	);
});

test('CPU save-state leaves host-native bridge values out of CPU roots', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	cpu.globals.setStringKey(StringValue.get(cpu.stringPool.intern('native')), cpu.createNativeFunction('native_bridge', () => {}));

	assert.deepEqual(cpu.captureRuntimeState(new Map()).globals, []);
});

test('tracked heap bytes do not include raw js array capacity without native iteration entries', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const cpu = new CPU(memory);

	const before = cpu.collectTrackedHeapBytes();
	const raw = new Array(1024).fill(7);
	const nativeArray = cpu.createNativeObject(raw, {
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
		nextEntry: () => null,
	});

	const after = cpu.collectTrackedHeapBytes([nativeArray]);
	assert.equal(after - before, 24, `expected native object accounting to ignore raw js array capacity (${after - before} != 24)`);
});

test('program image literals and debug names stay in ROM accounting', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	const before = cpu.collectTrackedHeapBytes();
	const compiled = compileLuaSource([
		'local alpha_beta_gamma = "literal text"',
		'local field_name = "field literal"',
		'program_literal = "global literal"',
		'return alpha_beta_gamma, field_name',
	].join('\n'), 'ram_accounting.lua');

	cpu.setProgram(compiled.program, compiled.metadata, compiled.metadata);

	assert.equal(cpu.collectTrackedHeapBytes(), before);
});

test('runtime string materialization tracks RAM even when the same text exists in ROM', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	cpu.stringPool.intern('rom literal', false);
	const before = cpu.collectTrackedHeapBytes();

	// A materialized runtime string is always held somewhere live (here: a global).
	// It must count as RAM even though the identical text already exists in ROM as
	// an untracked literal.
	const runtimeString = StringValue.get(cpu.stringPool.intern('rom literal'));
	cpu.globals.set(StringValue.get(cpu.stringPool.intern('held', false)), runtimeString);

	assert.ok(cpu.collectTrackedHeapBytes() > before);
});

test('unreachable runtime strings are reclaimed by the heap collector', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	const before = cpu.collectTrackedHeapBytes();

	// Intern a tracked runtime string but never root it. The append-only string
	// pool must not let it count against RAM forever, otherwise churning unique
	// strings (e.g. repeated hot-resume) leaks the tracked heap until OOM.
	cpu.stringPool.intern('transient garbage string');

	assert.equal(cpu.collectTrackedHeapBytes(), before);
});

test('non-capturing const functions materialize as static proto references', () => {
	const { cpu, entryProtoIndex } = createCpuWithProgram([
		'local f<const> = function()',
		'	return 7',
		'end',
		'return f',
	].join('\n'));
	const before = cpu.collectTrackedHeapBytes();

	cpu.start(entryProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);

	assert.equal(cpu.collectTrackedHeapBytes(), before);
});

test('restored static closures reuse the static proto cache', () => {
	const { cpu } = createCpuWithProgram([
		'local f<const> = function()',
		'	return 7',
		'end',
		'return f',
	].join('\n'));
	const staticProtoIndex = cpu.program.protos.findIndex(proto => proto.staticClosure);
	assert.notEqual(staticProtoIndex, -1);
	const state: CpuRuntimeState = {
		globals: [],
		moduleCache: [],
		frames: [],
		lastReturnValues: [{ tag: 'ref', id: 0 }],
		objects: [{ kind: 'closure', protoIndex: staticProtoIndex, upvalues: [] }],
		openUpvalues: [],
		lastPc: 0,
		lastInstruction: 0,
		instructionBudgetRemaining: 0,
		haltedUntilIrq: false,
		memoryWriteBlocked: false,
		memoryWriteBlockedAddress: 0,
		maskableInterruptsEnabled: true,
		maskableInterruptsRestoreEnabled: true,
		nonMaskableInterruptPending: false,
		yieldRequested: false,
	};

	cpu.restoreRuntimeState(state, new Map());

	const restoredClosure = (cpu as unknown as { lastReturnValues: unknown[] }).lastReturnValues[0];
	const cachedClosure = (cpu as unknown as { rootClosure(protoIndex: number): unknown }).rootClosure(staticProtoIndex);
	assert.equal(restoredClosure, cachedClosure);
});

test('non-const function materialization allocates a runtime closure', () => {
	const heap = collectHeapDeltaAfterRun([
		'local f = function()',
		'	return 7',
		'end',
		'return f',
	].join('\n'));

	assert.ok(heap.after > heap.before);
});

test('captured closures allocate tracked closure and upvalue state', () => {
	const heap = collectHeapDeltaAfterRun([
		'local x = 7',
		'local f = function()',
		'	return x',
		'end',
		'return f',
	].join('\n'));

	assert.ok(heap.after > heap.before);
});
