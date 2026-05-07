import { test } from 'node:test';
import assert from 'node:assert/strict';

import { splitText } from '../../src/bmsx/common/text_lines';
import { LuaLexer } from '../../src/bmsx/lua/syntax/lexer';
import { LuaParser } from '../../src/bmsx/lua/syntax/parser';
import { CPU, RunResult, Table, createNativeFunction, createNativeObject, valueString, type CpuRuntimeState } from '../../src/bmsx/machine/cpu/cpu';
import { Memory } from '../../src/bmsx/machine/memory/memory';
import { compileLuaChunkToProgram } from '../../src/bmsx/machine/program/compiler';

function parseChunk(source: string, path = 'ram_accounting.lua') {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, splitText(source));
	return parser.parseChunk();
}

function compileSource(source: string, path = 'ram_accounting.lua') {
	return compileLuaChunkToProgram(parseChunk(source, path), [], { entrySource: source });
}

function createCpuWithProgram(source: string): { cpu: CPU; entryProtoIndex: number } {
	const compiled = compileSource(source);
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	cpu.setProgram(compiled.program, compiled.metadata);
	return { cpu, entryProtoIndex: compiled.entryProtoIndex };
}

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

test('program image literals and debug names stay in ROM accounting', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	const before = cpu.collectTrackedHeapBytes();
	const compiled = compileSource([
		'local alpha_beta_gamma = "literal text"',
		'local field_name = "field literal"',
		'program_literal = "global literal"',
		'return alpha_beta_gamma, field_name',
	].join('\n'));

	cpu.setProgram(compiled.program, compiled.metadata);

	assert.equal(cpu.collectTrackedHeapBytes(), before);
});

test('runtime string materialization tracks RAM even when the same text exists in ROM', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	cpu.stringPool.internRom('rom literal');
	const before = cpu.collectTrackedHeapBytes();

	cpu.stringPool.intern('rom literal');

	assert.ok(cpu.collectTrackedHeapBytes() > before);
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
	const ioSlotCount = (cpu as unknown as { memory: { getIoSlots(): unknown[] } }).memory.getIoSlots().length;
	const state: CpuRuntimeState = {
		globals: [],
		ioMemory: new Array(ioSlotCount).fill({ tag: 'nil' }),
		moduleCache: [],
		frames: [],
		lastReturnValues: [{ tag: 'ref', id: 0 }],
		objects: [{ kind: 'closure', protoIndex: staticProtoIndex, upvalues: [] }],
		openUpvalues: [],
		lastPc: 0,
		lastInstruction: 0,
		instructionBudgetRemaining: 0,
		haltedUntilIrq: false,
		yieldRequested: false,
	};

	cpu.restoreRuntimeState(state, new Map());

	const restoredClosure = (cpu as unknown as { lastReturnValues: unknown[] }).lastReturnValues[0];
	const cachedClosure = (cpu as unknown as { staticClosure(protoIndex: number): unknown }).staticClosure(staticProtoIndex);
	assert.equal(restoredClosure, cachedClosure);
});

test('non-const function materialization allocates a runtime closure', () => {
	const { cpu, entryProtoIndex } = createCpuWithProgram([
		'local f = function()',
		'	return 7',
		'end',
		'return f',
	].join('\n'));
	const before = cpu.collectTrackedHeapBytes();

	cpu.start(entryProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);

	assert.ok(cpu.collectTrackedHeapBytes() > before);
});

test('captured closures allocate tracked closure and upvalue state', () => {
	const { cpu, entryProtoIndex } = createCpuWithProgram([
		'local x = 7',
		'local f = function()',
		'	return x',
		'end',
		'return f',
	].join('\n'));
	const before = cpu.collectTrackedHeapBytes();

	cpu.start(entryProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);

	assert.ok(cpu.collectTrackedHeapBytes() > before);
});
