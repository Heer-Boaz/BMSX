import { GC_COLOR_OFFSET } from '../../machine/ts/machine/cpu/gc_object';
import * as ClosureRecord from '../../machine/ts/machine/cpu/closure';
import { GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { allocatedObjectRecords } from '../helpers/cpu_execution';
import { CLOSURE_BINDING_FLAGS, CLOSURE_CANONICAL, CLOSURE_PROTOTYPE_ADDRESS } from '../../machine/ts/machine/cpu/closure';
import { valuePayload } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import * as Upvalue from '../../machine/ts/machine/cpu/upvalue';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { asClosure, valueTable, valueIsTable, valueFloat, valueFloatBits, valueInteger, valueBool, valueNil, valueBuiltinFunction, type Value, ValueTag, valueString } from '../../machine/ts/machine/cpu/value';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { SYSTEM_EXECUTION_DOMAIN_ID, SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { blua32TestFunctionAddress, createTestSystemCpu, linkRawTestSystemBlua32, linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource } from '../helpers/cpu_test_harness';

for (const [op, name] of [[OpCode.K1, 'constant'], [OpCode.NEWT, 'table']] as const) test(`checkpoint and GC retain a ${name} in the preserved caller prefix after an open-result call`, () => {
	const code = new Uint8Array(6 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, op, 0, 0, 0);
	writeInstruction(code, 1, OpCode.WIDE, 0, 0, 0);
	writeInstruction(code, 2, OpCode.CLOSURE, 4, 0, 0);
	writeInstruction(code, 3, OpCode.CALL, 4, 1, 0);
	writeInstruction(code, 4, OpCode.RET, 0, 2, 0);
	writeInstruction(code, 5, OpCode.RET, 0, 0, 0);
	const image = linkRawTestSystemBlua32({
		text: code,
		functions: [{ firstWord: 0, wordCount: 5, maxStack: 8 }, { firstWord: 5, wordCount: 1 }],
		closureRelocations: [{ wordIndex: 2, functionAddress: blua32TestFunctionAddress(SYSTEM_ROM_BASE, 1) }],
	});
	const { cpu } = createTestSystemCpu(image);
	const returnPc = cpu.readFramePc(0) + 4 * INSTRUCTION_BYTES;
	cpu.setExecutionHook((_domain, pc) => pc === returnPc, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.ExecutionStopped);
	assert.equal(cpu.rootThread.frameAtDepth(0).top, 4, 'open CALL accepts zero results without reviving earlier arguments');
	if (op === OpCode.NEWT) {
		const weak = cpu.createTable(1, 0);
		const mode = cpu.createTable(0, 1);
		cpu.gc.tables.setStringKey(mode, cpu.stringPool.intern('__mode'), valueString(cpu.stringPool.intern('v')));
		cpu.gc.tables.setMetatableAddress(weak, mode);
		cpu.gc.tables.setInteger(weak, 1, cpu.readFrameRegister(0, 0));
		cpu.setGlobalByKey(cpu.stringPool.intern('weak'), valueTable(weak));
		cpu.collectTrackedHeapBytes();
		assert.ok(cpu.gc.tables.getInteger(weak, 1) === cpu.readFrameRegister(0, 0), 'live caller locals remain heap roots across calls');
	}
	const saved = cpu.captureRuntimeState();
	cpu.setExecutionHook(null, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
	cpu.restoreRuntimeState(saved);
	assert.equal(cpu.rootThread.frameAtDepth(0).registers.getTag(0), op === OpCode.K1 ? ValueTag.Integer : ValueTag.Table,
		'snapshot preserves the caller local below its call area');
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	const values: Value[] = [];
	cpu.readCompletionValues(values);
	assert.equal(values.length, 1);
	if (op === OpCode.K1) assert.deepEqual(values, [valueInteger(1)]);
	else assert.ok(values[0] === cpu.gc.tables.getInteger(valuePayload(cpu.getGlobalByKey(cpu.stringPool.find('weak')!)), 1));
});

test('a closure completion value refers to separate physical closure and capture records', () => {
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource(`
local root = {}
return function() return root end
`, 'snapshot-allocation-order.lua')));
	cpu.runUntilDepth(0, 1000);
	const state = cpu.captureRuntimeState();
	const result = state.completionValues[0];
	const descriptor = asClosure(result, cpu.gc);
	assert.equal(valuePayload(result), descriptor);
	const cell = ClosureRecord.captureAddress(cpu.memory, descriptor, 0);
	assert.notEqual(cell, descriptor);
	assert.equal(cpu.gc.cellRecordAddress(cell), cell);
	assert.equal(Upvalue.isOpen(cpu.memory, cell), false);
	assert.ok(valueIsTable(Upvalue.load(cpu.memory, cell)));
});

test('repeated restore replays the full CPU state independently of fresh execution grants', () => {
	const image = linkTestSystemBlua32(compileLuaSource(`
local cached<const> = function() return 1 end
local dynamic = function() return 2 end
return {}, cached, dynamic
`, 'snapshot-identities.lua'));
	const { cpu } = createTestSystemCpu(image);
	const anchor = cpu.captureRuntimeState();
	const anchorRam = cpu.memory.captureSaveState();

	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	const expected = cpu.captureRuntimeState();
	for (const budget of [1001, 2001, 4001, 8001]) {

		cpu.memory.restoreSaveState(anchorRam);
		cpu.restoreRuntimeState(anchor);
		assert.deepEqual(cpu.captureRuntimeState(), anchor);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded, 'the next call consumes only its newly supplied grant');
		assert.equal(cpu.runUntilDepth(0, budget), RunResult.Halted);
		assert.deepEqual(cpu.captureRuntimeState(), expected);
	}
});

test('checkpoint capture preserves the authoritative global registers without mutation', () => {
	const code = new Uint8Array(3 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.K1, 0, 0, 0);
	writeInstruction(code, 1, OpCode.SETGL, 0, 0, 0);
	writeInstruction(code, 2, OpCode.RET, 0, 0, 0);
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32({
		text: code,
		functions: [{ firstWord: 0, wordCount: 3 }],
		globalNames: ['answer'],
	}));
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	const key = cpu.stringPool.find('answer')!;
	const heap = [cpu.luaHeap.usedBytes(), cpu.luaHeap.collectionTarget()];
	const snapshot = cpu.captureRuntimeState();
	assert.deepEqual([cpu.luaHeap.usedBytes(), cpu.luaHeap.collectionTarget()], heap);
	assert.equal(cpu.getGlobalByKey(key), valueInteger(1));
	cpu.restoreRuntimeState(snapshot);
	assert.deepEqual(cpu.captureRuntimeState(), snapshot);
	assert.equal(cpu.getGlobalByKey(key), valueInteger(1));
});

test('restore retains weak referents until the original allocation-triggered collection', () => {
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(
		compileLuaSource('return 0', 'snapshot-weak.lua'),
	));
	const weakKey = cpu.stringPool.intern('weak');
	const weak = cpu.createTable(1, 0);
	const metatable = cpu.createTable(0, 1);
	cpu.gc.tables.setStringKey(metatable, cpu.stringPool.intern('__mode'), valueString(cpu.stringPool.intern('v')));
	cpu.gc.tables.setMetatableAddress(weak, metatable);
	cpu.gc.tables.setInteger(weak, 1, valueTable(cpu.createTable()));
	cpu.setGlobalByKey(weakKey, valueTable(weak));
	// These allocations have left guest accounting debt but are unreachable.
	for (let index = 0; index < 17; index += 1) cpu.createTable(256, 0);
	const ram = cpu.memory.captureSaveState();
	const anchor = cpu.captureRuntimeState();

	const allocateUntilCollected = (): number => {
		const current = valuePayload(cpu.getGlobalByKey(weakKey));
		assert.ok(valueIsTable(cpu.gc.tables.getInteger(current, 1)));
		for (let count = 1; count < 4096; count += 1) {
			cpu.createTable(256, 0);
			if (cpu.gc.tables.getInteger(current, 1) === valueNil()) return count;
		}
		assert.fail('allocation did not reach the guest collection threshold');
	};
	const expectedCount = allocateUntilCollected();
	const expected = cpu.captureRuntimeState();
	for (let pass = 0; pass < 3; pass += 1) {

		cpu.memory.restoreSaveState(ram);
		cpu.restoreRuntimeState(anchor);
		assert.deepEqual(cpu.captureRuntimeState(), anchor);
		assert.equal(allocateUntilCollected(), expectedCount);
		assert.deepEqual(cpu.captureRuntimeState(), expected);
	}
});

test('a materialized but unrooted canonical closure remains part of the checkpoint', () => {
	const code = new Uint8Array(6 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(code, 1, OpCode.CLOSURE, 0, 0, 0);
	writeInstruction(code, 2, OpCode.KNIL, 0, 0, 0);
	writeInstruction(code, 3, OpCode.NEWT, 0, 0, 0);
	writeInstruction(code, 4, OpCode.RET, 0, 2, 0);
	writeInstruction(code, 5, OpCode.RET, 0, 0, 0);
	const address = blua32TestFunctionAddress(SYSTEM_ROM_BASE, 1);
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32({
		text: code,
		functions: [{ firstWord: 0, wordCount: 5 }, { firstWord: 5, wordCount: 1 }],
		closureRelocations: [{ wordIndex: 1, functionAddress: address }],
	}));
	const entry = cpu.readFramePc(0), functionAddress = cpu.rootThread.frameAtDepth(0).functionAddress;
	const cold = cpu.captureRuntimeState();
	const coldRam = cpu.memory.captureSaveState();
	assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.CLOSURE] + BASE_CYCLES[OpCode.KNIL]), RunResult.Yielded);
	const warm = cpu.captureRuntimeState();
	const warmRam = cpu.memory.captureSaveState();
	assert.equal(cpu.readFrameRegister(0, 0), valueNil());
	const closureAddress = allocatedObjectRecords(cpu).find(record =>
		cpu.memory.readRamRecordByte(record) === ValueTag.Closure
		&& cpu.memory.readRamRecordWord(record + CLOSURE_PROTOTYPE_ADDRESS) === address
		&& (cpu.memory.readRamRecordByte(record + CLOSURE_BINDING_FLAGS) & CLOSURE_CANONICAL) !== 0)!;
	assert.ok(closureAddress);
	cpu.runUntilDepth(0, 1000);
	const expected = cpu.captureRuntimeState();
	cpu.memory.restoreSaveState(coldRam);
	cpu.restoreRuntimeState(cold);
	cpu.memory.restoreSaveState(warmRam);
	cpu.restoreRuntimeState(warm);
	assert.equal(cpu.gc.closureRecordAddress(closureAddress), closureAddress);
	assert.deepEqual(cpu.captureRuntimeState(), warm);
	cpu.runUntilDepth(0, 1000);
	assert.deepEqual(cpu.captureRuntimeState(), expected);

	cpu.memory.restoreSaveState(warmRam);
	cpu.restoreRuntimeState(warm);
	while (cpu.gc.phase() !== GcPhase.Sweep) cpu.gc.step();
	assert.equal(cpu.memory.readRamRecordByte(closureAddress + GC_COLOR_OFFSET), cpu.gc.white() ^ 1);
	const sweep = cpu.captureRuntimeState(), sweepRam = cpu.memory.captureSaveState();
	const build = () => {
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, functionAddress, entry);
		assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.CLOSURE]), RunResult.Yielded);
		return cpu.readFrameRegister(0, 0);
	};
	const replacement = build();
	assert.notEqual(valuePayload(replacement), closureAddress);
	cpu.memory.restoreSaveState(sweepRam);
	cpu.restoreRuntimeState(sweep);
	assert.equal(build(), replacement, 'restore does not republish an already retired closure');

});

test('hard-halt is restored independently of the live future CPU latch', () => {
	const code = new Uint8Array(3 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(code, 1, OpCode.WIDE, 0, 0, 0);
	writeInstruction(code, 2, OpCode.RET, 0, 0, 0);
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32({
		text: code,
		functions: [{ firstWord: 0, wordCount: 3 }],
	}));
	const start = cpu.captureRuntimeState();
	const startingRam = cpu.memory.captureSaveState();
	cpu.runUntilDepth(0, 1000);
	const halted = cpu.captureRuntimeState();
	const haltedRam = cpu.memory.captureSaveState(), depth = cpu.getFrameDepth();
	assert.equal(halted.hardHalted, true);
	cpu.memory.restoreSaveState(startingRam);
	cpu.restoreRuntimeState(start);
	assert.equal(cpu.captureRuntimeState().hardHalted, false);
	cpu.memory.restoreSaveState(haltedRam);
	cpu.restoreRuntimeState(halted);
	cpu.runUntilDepth(0, 1000);
	const after = cpu.captureRuntimeState();
	assert.equal(after.hardHalted, true);
	assert.equal(cpu.getFrameDepth(), depth, 'hard halt retains the restored physical cursor');
});

test('CPU capture walks no language records; fresh restore reattaches a graph from RAM', () => {
	const image = linkTestSystemBlua32(compileLuaSource('return 19, 21', 'snapshot-physical-records.lua'));
	const { cpu } = createTestSystemCpu(image);
	const key = cpu.stringPool.intern('graph');
	cpu.setGlobalByKey(key, valueNil());
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	const before = cpu.captureRuntimeState();
	const root = cpu.createTable(1024, 0);
	const rootValue = valueTable(root);
	cpu.setGlobalByKey(key, rootValue);
	for (let index = 1; index <= 1024; ++index) {
		const child = cpu.createTable(1, 0);
		cpu.gc.tables.setInteger(child, 1, rootValue);
		cpu.gc.tables.setInteger(root, index, valueTable(child));
	}
	const ram = cpu.memory.captureSaveState();
	const storage: Value[] = [];
	const saved = cpu.captureRuntimeState(storage);
	assert.deepEqual(saved, before, 'language allocations are not additional CPU latch state');
	assert.equal(saved.completionValues, storage);
	const future = cpu.createTable();
	const other = createTestSystemCpu(image).cpu;
	other.memory.restoreSaveState(ram);
	other.restoreRuntimeState(saved);
	assert.equal(other.gc.tableRecordAddress(future), 0);
	const restored = valuePayload(other.getGlobalByKey(key));
	assert.equal(restored, root);
	assert.notEqual(other.gc.tables.getInteger(restored, 1), other.gc.tables.getInteger(restored, 2));
	const child = valuePayload(other.gc.tables.getInteger(restored, 1024));
	assert.equal(other.gc.tables.getInteger(child, 1), rootValue);
	assert.deepEqual(other.memory.captureSaveState(), ram, 'rebinding must not write guest bytes');
	assert.deepEqual(other.captureRuntimeState(), before);
});

test('snapshot words preserve int32 and f32 bits, primitive tags and interned ids', () => {
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource('return 0', 'snapshot-values.lua')));
	const key = cpu.stringPool.intern('values');
	const values = [
		valueInteger(0), valueInteger(-2147483648), valueInteger(2147483647),
		valueFloatBits(0x80000000), valueFloat(0), valueFloat(1.25), valueFloatBits(0xffc12345),
		valueFloatBits(0x7f800001), valueFloat(Infinity), valueFloat(-Infinity), valueFloatBits(1), valueFloatBits(0x7f7fffff),
		valueBool(false), valueBool(true), valueString(cpu.stringPool.intern('saved')),
		valueBuiltinFunction(BuiltinFunctionId.Next), valueNil(),
	];
	const table = cpu.createTable(values.length, 0);
	cpu.setGlobalByKey(key, valueTable(table));
	for (let index = 0; index < values.length; index += 1) cpu.gc.tables.setInteger(table, index + 1, values[index]);
	const state = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(state);
	const restored = valuePayload(cpu.getGlobalByKey(key));
	for (let index = 0; index < values.length; index += 1) assert.equal(cpu.gc.tables.getInteger(restored, index + 1), values[index]);
	assert.deepEqual(cpu.captureRuntimeState(), state);
});

test('deep cyclic guest graphs do not consume the host serialization stack', () => {
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource('return 0', 'snapshot-depth.lua')));
	const key = cpu.stringPool.intern('deep');
	const root = cpu.createTable(1, 0);
	cpu.setGlobalByKey(key, valueTable(root));
	let tail = root;
	for (let index = 1; index < 4096; index += 1) {
		const child = cpu.createTable(1, 0);
		cpu.gc.tables.setInteger(tail, 1, valueTable(child));
		tail = child;
	}
	cpu.gc.tables.setInteger(tail, 1, valueTable(root));
	const state = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(state);
	const restored = valuePayload(cpu.getGlobalByKey(key));
	let current = restored;
	for (let index = 0; index < 4096; index += 1) current = valuePayload(cpu.gc.tables.getInteger(current, 1));
	assert.equal(current, restored);
	assert.deepEqual(cpu.captureRuntimeState(), state);
});


test('table boundary hints and mixed numeric hash layout survive restore without normalization', () => {
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource('return 0', 'snapshot-boundaries.lua')));
	const key = cpu.stringPool.intern('boundary');
	const table = cpu.createTable(64, 128);
	for (let n = 64; n > 0; n--) cpu.gc.tables.setInteger(table, n, valueBool(false));
	for (let n = -1; n >= -64; n--) cpu.gc.tables.setInteger(table, n, valueInteger(n));
	cpu.setGlobalByKey(key, valueTable(table));
	const ram = cpu.memory.captureSaveState();
	const state = cpu.captureRuntimeState();
	assert.equal(cpu.gc.tables.length(table), 64);
	assert.deepEqual(cpu.captureRuntimeState(), state, 'inspection does not normalize a non-boundary hint');
	cpu.gc.tables.setInteger(table, 1, valueNil()); cpu.gc.tables.setInteger(table, 64, valueNil()); cpu.gc.tables.setInteger(table, -32, valueInteger(999));
	cpu.memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(state);
	const restored = valuePayload(cpu.getGlobalByKey(key));
	assert.equal(cpu.gc.tables.length(restored), 64);
	assert.equal(cpu.gc.tables.getInteger(restored, -32), valueInteger(-32));
	assert.deepEqual(cpu.captureRuntimeState(), state);
	for (let n = -65; n >= -256; n--) cpu.gc.tables.setInteger(restored, n, valueInteger(n));
	assert.equal(cpu.gc.tables.length(restored), 64, 'hash growth redistributes storage without changing the boundary');
});
