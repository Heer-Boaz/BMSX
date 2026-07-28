import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import {
	StringValue,
	createBuiltinFunction,
} from '../../machine/ts/machine/cpu/value';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import {
	createTestSystemCpu,
	linkRawTestSystemBlua32,
	linkTestSystemBlua32,
} from '../helpers/blua32';
import { compileLuaSource } from './cpu_test_harness';

const emptyCode = new Uint8Array(INSTRUCTION_BYTES);
writeInstruction(emptyCode, 0, OpCode.RET, 0, 0, 0);
const EMPTY_TEST_IMAGE = linkRawTestSystemBlua32({
	text: emptyCode,
	functions: [{ firstWord: 0, wordCount: 1 }],
});

function createCpuWithProgram(source: string): CPU {
	const compiled = compileLuaSource(source, 'ram_accounting.lua');
	const finalized = linkTestSystemBlua32(compiled);
	return createTestSystemCpu(finalized).cpu;
}

function collectHeapDeltaAfterRun(source: string): { before: number; after: number } {
	const cpu = createCpuWithProgram(source);
	const before = cpu.collectTrackedHeapBytes();
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	return { before, after: cpu.collectTrackedHeapBytes() };
}

test('tracked heap bytes include rooted tables', () => {
	const { cpu } = createTestSystemCpu(EMPTY_TEST_IMAGE);
	const key = StringValue.get(cpu.stringPool.intern('state'));

	const before = cpu.collectTrackedHeapBytes();

	const table = cpu.createTable(2, 2);
	table.set(1, 11);
	table.set(StringValue.get(cpu.stringPool.intern('hp')), 7);
	cpu.globals.set(key, table);

	const afterTable = cpu.collectTrackedHeapBytes();
	assert.ok(afterTable > before, `expected table bytes to increase heap usage (${afterTable} <= ${before})`);

	cpu.globals.set(key, null);

	const afterCleanup = cpu.collectTrackedHeapBytes();
	assert.ok(afterCleanup < afterTable, `expected cleanup to drop rooted heap usage (${afterCleanup} >= ${afterTable})`);
	assert.ok(afterCleanup >= before, `expected table capacity growth to remain tracked (${afterCleanup} < ${before})`);
});

test('builtin primitives are static VM slots outside Lua heap accounting', () => {
	const { cpu } = createTestSystemCpu(EMPTY_TEST_IMAGE);
	const next = createBuiltinFunction(BuiltinFunctionId.Next);
	const before = cpu.collectTrackedHeapBytes();

	assert.equal(createBuiltinFunction(BuiltinFunctionId.Next), next);
	assert.equal(cpu.collectTrackedHeapBytes(next), before);
});

test('builtin primitive save-state uses VM id instead of stable global path', () => {
	const { cpu } = createTestSystemCpu(EMPTY_TEST_IMAGE);
	cpu.globals.setStringKey(StringValue.get(cpu.stringPool.intern('foo')), createBuiltinFunction(BuiltinFunctionId.Next));

	const state = cpu.captureRuntimeState();
	assert.deepEqual(state.globals, [
		{ name: 'foo', value: { tag: 'builtin', id: BuiltinFunctionId.Next } },
	]);

	const restoredCpu = createTestSystemCpu(EMPTY_TEST_IMAGE).cpu;
	restoredCpu.restoreRuntimeState(state);
	assert.equal(
		restoredCpu.globals.getStringKey(StringValue.get(restoredCpu.stringPool.intern('foo'))),
		createBuiltinFunction(BuiltinFunctionId.Next),
	);
});

test('BLua32 image literals and debug names stay in ROM accounting', () => {
	const baseline = createTestSystemCpu(EMPTY_TEST_IMAGE).cpu.collectTrackedHeapBytes();
	const compiled = compileLuaSource([
		'local alpha_beta_gamma = "literal text"',
		'local field_name = "field literal"',
		'program_literal = "global literal"',
		'return alpha_beta_gamma, field_name',
	].join('\n'), 'ram_accounting.lua');
	const cpu = createTestSystemCpu(linkTestSystemBlua32(compiled)).cpu;

	assert.equal(cpu.collectTrackedHeapBytes(), baseline);
});

test('runtime string materialization tracks RAM even when the same text exists in ROM', () => {
	const { cpu } = createTestSystemCpu(EMPTY_TEST_IMAGE);
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
	const { cpu } = createTestSystemCpu(EMPTY_TEST_IMAGE);
	const before = cpu.collectTrackedHeapBytes();

	// Intern a tracked runtime string but never root it. The append-only string
	// pool must not let it count against RAM forever, otherwise churning unique
	// strings (e.g. repeated hot-resume) leaks the tracked heap until OOM.
	cpu.stringPool.intern('transient garbage string');

	assert.equal(cpu.collectTrackedHeapBytes(), before);
});

test('non-capturing const functions materialize as static proto references', () => {
	const cpu = createCpuWithProgram([
		'local f<const> = function()',
		'	return 7',
		'end',
		'return f',
	].join('\n'));
	const before = cpu.collectTrackedHeapBytes();

	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);

	assert.equal(cpu.collectTrackedHeapBytes(), before);
});

test('restored static closures reuse the static proto cache', () => {
	const cpu = createCpuWithProgram([
		'local f<const> = function()',
		'	return 7',
		'end',
		'return f',
	].join('\n'));
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	const closure = cpu.completionValues[0];
	const before = cpu.collectTrackedHeapBytes();

	cpu.restoreRuntimeState(cpu.captureRuntimeState());

	assert.equal(cpu.completionValues[0], closure);
	assert.equal(cpu.collectTrackedHeapBytes(), before);
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
