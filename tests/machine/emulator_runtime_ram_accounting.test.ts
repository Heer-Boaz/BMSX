import { logicalThreadBytes } from '../helpers/guest_kernel';
import { ValueTag, valueBuiltinFunction, valueInteger, valueNil, valueTable } from '../../machine/ts/machine/cpu/value';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import {
	createTestSystemCpu,
	linkRawTestSystemBlua32,
	linkTestSystemBlua32,
} from '../helpers/blua32';
import { compileLuaSource, materializeCpuCompletionValues, runGuestToHalt } from '../helpers/cpu_test_harness';

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
	runGuestToHalt(cpu, 100000);
	const after = cpu.collectTrackedHeapBytes();
	cpu.setGlobalByKey(cpu.stringPool.find('saved')!, valueNil());
	return { before: cpu.collectTrackedHeapBytes(), after };
}

test('tracked heap bytes include rooted tables', () => {
	const { cpu } = createTestSystemCpu(EMPTY_TEST_IMAGE);
	const key = cpu.stringPool.intern('state');
	cpu.setGlobalByKey(key, valueNil());

	const before = cpu.collectTrackedHeapBytes();

	const table = cpu.createTable(2, 2);
	cpu.gc.tables.setInteger(table, 1, valueInteger(11));
	cpu.gc.tables.setStringKey(table, key, valueInteger(7));
	cpu.setGlobalByKey(key, valueTable(table));

	const afterTable = cpu.collectTrackedHeapBytes();
	assert.ok(afterTable > before, `expected table bytes to increase heap usage (${afterTable} <= ${before})`);

	cpu.setGlobalByKey(key, valueNil());

	const afterCleanup = cpu.collectTrackedHeapBytes();
	assert.ok(afterCleanup < afterTable, `expected cleanup to drop rooted heap usage (${afterCleanup} >= ${afterTable})`);
	assert.ok(afterCleanup >= before, `expected registered name to remain tracked (${afterCleanup} < ${before})`);
});

test('builtin primitives are static VM slots outside Lua heap accounting', () => {
	const { cpu } = createTestSystemCpu(EMPTY_TEST_IMAGE);
	const next = valueBuiltinFunction(BuiltinFunctionId.Next);
	const before = cpu.collectTrackedHeapBytes();

	assert.equal(valueBuiltinFunction(BuiltinFunctionId.Next), next);
	assert.equal(cpu.collectTrackedHeapBytes(), before);
});

test('builtin primitive save-state uses VM id instead of stable global path', () => {
	const { cpu } = createTestSystemCpu(EMPTY_TEST_IMAGE);
	cpu.setGlobalByKey(cpu.stringPool.intern('foo'), valueBuiltinFunction(BuiltinFunctionId.Next));

	const state = cpu.captureRuntimeState();
	const bank = state.globals;
	const words = bank.base + 12 * bank.capacity;
	assert.equal(bank.count, 1);
	assert.equal(cpu.memory.readRamRecordWord(words), BuiltinFunctionId.Next);
	assert.equal(cpu.memory.readRamRecordByte(words + 4 * bank.capacity), ValueTag.BuiltinFunction);

	const restoredCpu = createTestSystemCpu(EMPTY_TEST_IMAGE).cpu;
	restoredCpu.memory.restoreSaveState(cpu.memory.captureSaveState());
	restoredCpu.restoreRuntimeState(state);
	assert.equal(
		restoredCpu.getGlobalByKey(restoredCpu.stringPool.intern('foo')),
		valueBuiltinFunction(BuiltinFunctionId.Next),
	);
});

test('ROM text length does not change decoded constants or global bank allocation', () => {
	const bootBytes = (part: string) => {
		const source = [
			`local local_${part} = "literal ${part}"`,
			`global_${part} = "second ${part}"`,
			`return local_${part}`,
		].join('\n');
		const compiled = compileLuaSource(source, `debug_${part}.lua`);
		return createTestSystemCpu(linkTestSystemBlua32(compiled)).cpu.collectTrackedHeapBytes();
	};
	assert.equal(bootBytes('a'), bootBytes('long_text_'.repeat(48)));
});

test('runtime interning reuses a matching ROM record without allocating RAM', () => {
	const cpu = createCpuWithProgram('return "rom literal"');
	const before = cpu.luaHeap.usedBytes();
	const literal = cpu.stringPool.find('rom literal');
	assert.notEqual(literal, undefined);
	assert.equal(cpu.stringPool.intern('rom literal'), literal);
	assert.equal(cpu.luaHeap.usedBytes(), before);
});

test('unreachable runtime strings are reclaimed by the heap collector', () => {
	const { cpu } = createTestSystemCpu(EMPTY_TEST_IMAGE);
	const before = cpu.collectTrackedHeapBytes();

	// No VM value owns this text. Collection must free the intern entry as
	// well as its RAM debit; stale text must not accumulate in save states.
	cpu.stringPool.intern('transient garbage string');

	assert.equal(cpu.collectTrackedHeapBytes(), before);
	assert.equal(cpu.stringPool.find('transient garbage string'), undefined);
	assert.notEqual(cpu.stringPool.intern('new runtime string'), 0);
});

test('non-capturing const functions materialize as static proto references', () => {
	const cpu = createCpuWithProgram([
		'local f<const> = function()',
		'	return 7',
		'end',
		'return f',
	].join('\n'));
	const before = cpu.collectTrackedHeapBytes();
	const backingBefore = logicalThreadBytes(cpu);

	runGuestToHalt(cpu, 100000);

	assert.equal(cpu.collectTrackedHeapBytes() - before,
		logicalThreadBytes(cpu) - backingBefore);
});

test('restored static closures reuse the static proto cache', () => {
	const cpu = createCpuWithProgram([
		'local f<const> = function()',
		'	return 7',
		'end',
		'return f',
	].join('\n'));
	runGuestToHalt(cpu, 100000);
	const closure = materializeCpuCompletionValues(cpu)[0];
	const before = cpu.collectTrackedHeapBytes();

	cpu.restoreRuntimeState(cpu.captureRuntimeState());

	assert.equal(materializeCpuCompletionValues(cpu)[0], closure);
	assert.equal(cpu.collectTrackedHeapBytes(), before);
});

test('non-const function materialization allocates a runtime closure', () => {
	const heap = collectHeapDeltaAfterRun([
		'local f = function()',
		'	return 7',
		'end',
		'saved = f',
	].join('\n'));

	assert.ok(heap.after > heap.before);
});

test('captured closures allocate tracked closure and upvalue state', () => {
	const heap = collectHeapDeltaAfterRun([
		'local x = 7',
		'local f = function()',
		'	return x',
		'end',
		'saved = f',
	].join('\n'));

	assert.ok(heap.after > heap.before);
});
