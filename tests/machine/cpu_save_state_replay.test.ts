import { GcPhase, asClosure } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import { setReferenceGlobal } from '../helpers/global_bank_reference';
import { GC_COLOR_OFFSET, CLOSURE_CANONICAL } from '../../toolchain/ts/firmware/stock_object_layout';
import * as ClosureRecord from '../../machine/ts/machine/cpu/closure';
import { allocatedObjectRecords, runCpuWithinBudget } from '../helpers/cpu_execution';
import { CLOSURE_BINDING_FLAGS, CLOSURE_PROTOTYPE_ADDRESS } from '../../machine/ts/machine/cpu/closure';
import { valuePayload } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import * as Upvalue from '../../machine/ts/machine/cpu/upvalue';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { valueTable, valueIsTable, valueFloat, valueFloatBits, valueInteger, valueBool, valueNil, valueBuiltinFunction, type Value, ValueTag, valueString } from '../../machine/ts/machine/cpu/value';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { SYSTEM_EXECUTION_DOMAIN_ID, SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { createTestSystemCpu, linkRawTestSystemBlua32, linkTestSystemBlua32, seedTestRomClosure } from '../helpers/blua32';
import { compileHeapServiceSystem } from '../helpers/heap_service_system';
import { compileLuaSource, runGuestToHalt } from '../helpers/cpu_test_harness';

for (const name of ['constant', 'table']) test(`checkpoint and GC retain a ${name} in the preserved caller prefix after an open-result call`, () => {
	const code = new Uint8Array(6 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, name === 'table' ? OpCode.MOV : OpCode.K1, 0, 0, 0);
	writeInstruction(code, 1, OpCode.WIDE, 0, 0, 0);
	writeInstruction(code, 2, OpCode.CLOSURE, 4, 0, 0);
	writeInstruction(code, 3, OpCode.CALL, 4, 1, 0);
	writeInstruction(code, 4, OpCode.RET, 0, 2, 0);
	writeInstruction(code, 5, OpCode.RET, 0, 0, 0);
	const image = linkRawTestSystemBlua32({
		text: code,
		functions: [{ firstWord: 0, wordCount: 5, maxStack: 8 }, { firstWord: 5, wordCount: 1 }],
		closureRelocations: [{ wordIndex: 2, functionIndex: 1 }],
	});
	const { cpu } = createTestSystemCpu(image);
	seedTestRomClosure(cpu, image.symbols.functionAddresses[1]);
	if (name === 'table') cpu.rootThread.frameAtDepth(0).registers.setTable(0, createReferenceTable(cpu));
	const returnPc = cpu.readFramePc(0) + 4 * INSTRUCTION_BYTES;
	cpu.setExecutionHook((_domain, pc) => pc === returnPc, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.ExecutionStopped);
	assert.equal(cpu.rootThread.frameAtDepth(0).top, 4, 'open CALL accepts zero results without reviving earlier arguments');
	if (name === 'table') {
		const weak = createReferenceTable(cpu, 1, 0);
		const mode = createReferenceTable(cpu, 0, 1);
		nativeHeapReference(cpu).gc.tables.setStringKey(mode, nativeHeapReference(cpu).stringPool.intern('__mode'), valueString(nativeHeapReference(cpu).stringPool.intern('v')));
		nativeHeapReference(cpu).gc.tables.setMetatableAddress(weak, mode);
		nativeHeapReference(cpu).gc.tables.setInteger(weak, 1, cpu.readFrameRegister(0, 0));
		setReferenceGlobal(cpu, nativeHeapReference(cpu).stringPool.intern('weak'), valueTable(weak));
		nativeHeapReference(cpu).gc.collect();
		assert.ok(cpu.tables.getInteger(weak, 1) === cpu.readFrameRegister(0, 0), 'live caller locals remain heap roots across calls');
	}
	const saved = cpu.captureRuntimeState();
	cpu.setExecutionHook(null, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
	cpu.restoreRuntimeState(saved);
	assert.equal(cpu.rootThread.frameAtDepth(0).registers.getTag(0), name === 'constant' ? ValueTag.Integer : ValueTag.Table,
		'snapshot preserves the caller local below its call area');
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	const values: Value[] = [];
	cpu.readCompletionValues(values);
	assert.equal(values.length, 1);
	if (name === 'constant') assert.deepEqual(values, [valueInteger(1)]);
	else assert.ok(values[0] === cpu.tables.getInteger(valuePayload(cpu.getGlobalByKey(nativeHeapReference(cpu).stringPool.find('weak')!)), 1));
});

test('a closure completion value refers to separate physical closure and capture records', () => {
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileHeapServiceSystem(`
local root = {}
return function() return root end
`, 0)));
	runGuestToHalt(cpu, 100_000);
	const state = cpu.captureRuntimeState();
	const result = state.completionValues[0];
	const descriptor = asClosure(result, nativeHeapReference(cpu).gc);
	assert.equal(valuePayload(result), descriptor);
	const cell = ClosureRecord.captureAddress(cpu.memory, descriptor, 0);
	assert.notEqual(cell, descriptor);
	assert.equal(nativeHeapReference(cpu).gc.cellRecordAddress(cell), cell);
	assert.equal(Upvalue.isOpen(cpu.memory, cell), false);
	assert.ok(valueIsTable(Upvalue.load(cpu.memory, cell)));
});

test('repeated restore replays the full CPU state independently of fresh execution grants', () => {
	const image = linkTestSystemBlua32(compileHeapServiceSystem(`
local cached<const> = function() return 1 end
local dynamic = function() return 2 end
return {}, cached, dynamic
`, 0));
	const { cpu } = createTestSystemCpu(image);
	const anchor = cpu.captureRuntimeState();
	const anchorRam = cpu.memory.captureSaveState();

	runGuestToHalt(cpu, 100_000);
	const expected = cpu.captureRuntimeState();
	for (const budget of [1001, 2001, 4001, 8001]) {
		cpu.memory.restoreSaveState(anchorRam);
		cpu.restoreRuntimeState(anchor);
		assert.deepEqual(cpu.captureRuntimeState(), anchor);
		let result = cpu.runUntilDepth(0, 1);
		assert.equal(result, RunResult.Yielded, 'the next call consumes only its newly supplied grant');
		for (let grant = 0; grant < 128 && result === RunResult.Yielded; ++grant)
			result = cpu.runUntilDepth(0, budget);
		assert.equal(result, RunResult.Halted);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
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
	const key = nativeHeapReference(cpu).stringPool.find('answer')!;
	const heap = [nativeHeapReference(cpu).luaHeap.usedBytes(), nativeHeapReference(cpu).luaHeap.collectionTarget()];
	const snapshot = cpu.captureRuntimeState();
	assert.deepEqual([nativeHeapReference(cpu).luaHeap.usedBytes(), nativeHeapReference(cpu).luaHeap.collectionTarget()], heap);
	assert.equal(cpu.getGlobalByKey(key), valueInteger(1));
	cpu.restoreRuntimeState(snapshot);
	assert.deepEqual(cpu.captureRuntimeState(), snapshot);
	assert.equal(cpu.getGlobalByKey(key), valueInteger(1));
});

test('restore retains weak referents until the original allocation-triggered collection', () => {
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(
		compileLuaSource('return 0', 'snapshot-weak.lua'),
	));
	const weakKey = nativeHeapReference(cpu).stringPool.intern('weak');
	const weak = createReferenceTable(cpu, 1, 0);
	const metatable = createReferenceTable(cpu, 0, 1);
	nativeHeapReference(cpu).gc.tables.setStringKey(metatable, nativeHeapReference(cpu).stringPool.intern('__mode'), valueString(nativeHeapReference(cpu).stringPool.intern('v')));
	nativeHeapReference(cpu).gc.tables.setMetatableAddress(weak, metatable);
	nativeHeapReference(cpu).gc.tables.setInteger(weak, 1, valueTable(createReferenceTable(cpu)));
	setReferenceGlobal(cpu, weakKey, valueTable(weak));
	// These allocations have left guest accounting debt but are unreachable.
	for (let index = 0; index < 17; index += 1) createReferenceTable(cpu, 256, 0);
	const ram = cpu.memory.captureSaveState();
	const anchor = cpu.captureRuntimeState();

	const allocateUntilCollected = (): number => {
		const current = valuePayload(cpu.getGlobalByKey(weakKey));
		assert.ok(valueIsTable(cpu.tables.getInteger(current, 1)));
		for (let count = 1; count < 4096; count += 1) {
			createReferenceTable(cpu, 256, 0);
			if (cpu.tables.getInteger(current, 1) === valueNil()) return count;
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
	const image = linkTestSystemBlua32(compileHeapServiceSystem(`
local target<const> = function() end
return 1
`, 0, [], 'snapshot-canonical.lua'));
	const { cpu } = createTestSystemCpu(image);
	const functionAddress = image.vectors.entryFunctionAddress;
	const entry = image.image.functions.find(fn => fn.address === functionAddress)!.codeAddress;
	cpu.setExecutionHook((_domain, at) => at === entry, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
	assert.equal(runCpuWithinBudget(cpu, 10_000), RunResult.ExecutionStopped);
	cpu.setExecutionHook(null, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
	const frame = cpu.getFrameDepth() - 1;
	const cold = cpu.captureRuntimeState();
	const coldRam = cpu.memory.captureSaveState();
	const build = () => {
		assert.equal(cpu.runUntilDepth(frame, BASE_CYCLES[OpCode.CLOSURE]), RunResult.Yielded);
		assert.equal(cpu.fixedInterruptActive(), true, 'a cold canonical Closure enters the System vector');
		for (let grant = 0; grant < 32 && cpu.fixedInterruptActive(); ++grant)
			assert.equal(cpu.runUntilDepth(frame, 1024), RunResult.Yielded);
		return cpu.readFrameRegister(frame, 0);
	};
	const first = build(), closureAddress = valuePayload(first);
	assert.notEqual(closureAddress, 0);
	const address = cpu.captureClosureBinding(closureAddress).functionAddress;
	cpu.rootThread.frameAtDepth(frame).registers.setNil(0);

	const warm = cpu.captureRuntimeState();
	const warmRam = cpu.memory.captureSaveState();
	assert.equal(cpu.readFrameRegister(frame, 0), valueNil());
	assert.equal(allocatedObjectRecords(cpu).find(record =>
		cpu.memory.readRamRecordByte(record) === ValueTag.Closure
		&& cpu.memory.readRamRecordWord(record + CLOSURE_PROTOTYPE_ADDRESS) === address
		&& (cpu.memory.readRamRecordByte(record + CLOSURE_BINDING_FLAGS) & CLOSURE_CANONICAL) !== 0), closureAddress);
	cpu.runUntilDepth(0, 1000);
	const expected = cpu.captureRuntimeState();
	cpu.memory.restoreSaveState(coldRam);
	cpu.restoreRuntimeState(cold);
	cpu.memory.restoreSaveState(warmRam);
	cpu.restoreRuntimeState(warm);
	assert.equal(nativeHeapReference(cpu).gc.closureRecordAddress(closureAddress), closureAddress);
	assert.deepEqual(cpu.captureRuntimeState(), warm);
	cpu.runUntilDepth(0, 1000);
	assert.deepEqual(cpu.captureRuntimeState(), expected);

	cpu.memory.restoreSaveState(warmRam);
	cpu.restoreRuntimeState(warm);
	while (nativeHeapReference(cpu).gc.phase() !== GcPhase.Sweep) nativeHeapReference(cpu).gc.step();
	assert.equal(cpu.memory.readRamRecordByte(closureAddress + GC_COLOR_OFFSET), nativeHeapReference(cpu).gc.white() ^ 1);
	const sweep = cpu.captureRuntimeState(), sweepRam = cpu.memory.captureSaveState();
	const atColdSite = () => {
		cpu.writeFrameExecution(frame, SYSTEM_EXECUTION_DOMAIN_ID, functionAddress, entry);
		return build();
	};
	const replacement = atColdSite();
	assert.notEqual(valuePayload(replacement), closureAddress);
	cpu.memory.restoreSaveState(sweepRam);
	cpu.restoreRuntimeState(sweep);
	assert.equal(atColdSite(), replacement, 'restore does not republish an already retired closure');

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
	const image = linkTestSystemBlua32(compileHeapServiceSystem('return 19, 21', 0, [], 'snapshot-physical-records.lua'));
	const { cpu } = createTestSystemCpu(image);
	const key = nativeHeapReference(cpu).stringPool.intern('graph');
	setReferenceGlobal(cpu, key, valueNil());
	runGuestToHalt(cpu, 10_000);
	const before = cpu.captureRuntimeState();
	const root = createReferenceTable(cpu, 1024, 0);
	const rootValue = valueTable(root);
	setReferenceGlobal(cpu, key, rootValue);
	for (let index = 1; index <= 1024; ++index) {
		const child = createReferenceTable(cpu, 1, 0);
		nativeHeapReference(cpu).gc.tables.setInteger(child, 1, rootValue);
		nativeHeapReference(cpu).gc.tables.setInteger(root, index, valueTable(child));
	}
	const ram = cpu.memory.captureSaveState();
	const storage: Value[] = [];
	const saved = cpu.captureRuntimeState(storage);
	assert.deepEqual(saved, before, 'language allocations are not additional CPU latch state');
	assert.equal(saved.completionValues, storage);
	const future = createReferenceTable(cpu);
	const other = createTestSystemCpu(image).cpu;
	other.memory.restoreSaveState(ram);
	other.restoreRuntimeState(saved);
	assert.equal(nativeHeapReference(other).gc.tableRecordAddress(future), 0);
	const restored = valuePayload(other.getGlobalByKey(key));
	assert.equal(restored, root);
	assert.notEqual(other.tables.getInteger(restored, 1), other.tables.getInteger(restored, 2));
	const child = valuePayload(other.tables.getInteger(restored, 1024));
	assert.equal(other.tables.getInteger(child, 1), rootValue);
	assert.deepEqual(other.memory.captureSaveState(), ram, 'rebinding must not write guest bytes');
	assert.deepEqual(other.captureRuntimeState(), before);
});

test('snapshot words preserve int32 and f32 bits, primitive tags and interned ids', () => {
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource('return 0', 'snapshot-values.lua')));
	const key = nativeHeapReference(cpu).stringPool.intern('values');
	const values = [
		valueInteger(0), valueInteger(-2147483648), valueInteger(2147483647),
		valueFloatBits(0x80000000), valueFloat(0), valueFloat(1.25), valueFloatBits(0xffc12345),
		valueFloatBits(0x7f800001), valueFloat(Infinity), valueFloat(-Infinity), valueFloatBits(1), valueFloatBits(0x7f7fffff),
		valueBool(false), valueBool(true), valueString(nativeHeapReference(cpu).stringPool.intern('saved')),
		valueBuiltinFunction(BuiltinFunctionId.Next), valueNil(),
	];
	const table = createReferenceTable(cpu, values.length, 0);
	setReferenceGlobal(cpu, key, valueTable(table));
	for (let index = 0; index < values.length; index += 1) nativeHeapReference(cpu).gc.tables.setInteger(table, index + 1, values[index]);
	const state = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(state);
	const restored = valuePayload(cpu.getGlobalByKey(key));
	for (let index = 0; index < values.length; index += 1) assert.equal(cpu.tables.getInteger(restored, index + 1), values[index]);
	assert.deepEqual(cpu.captureRuntimeState(), state);
});

test('deep cyclic guest graphs do not consume the host serialization stack', () => {
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource('return 0', 'snapshot-depth.lua')));
	const key = nativeHeapReference(cpu).stringPool.intern('deep');
	const root = createReferenceTable(cpu, 1, 0);
	setReferenceGlobal(cpu, key, valueTable(root));
	let tail = root;
	for (let index = 1; index < 4096; index += 1) {
		const child = createReferenceTable(cpu, 1, 0);
		nativeHeapReference(cpu).gc.tables.setInteger(tail, 1, valueTable(child));
		tail = child;
	}
	nativeHeapReference(cpu).gc.tables.setInteger(tail, 1, valueTable(root));
	const state = cpu.captureRuntimeState();
	cpu.restoreRuntimeState(state);
	const restored = valuePayload(cpu.getGlobalByKey(key));
	let current = restored;
	for (let index = 0; index < 4096; index += 1) current = valuePayload(cpu.tables.getInteger(current, 1));
	assert.equal(current, restored);
	assert.deepEqual(cpu.captureRuntimeState(), state);
});


test('table boundary hints and mixed numeric hash layout survive restore without normalization', () => {
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compileLuaSource('return 0', 'snapshot-boundaries.lua')));
	const key = nativeHeapReference(cpu).stringPool.intern('boundary');
	const table = createReferenceTable(cpu, 64, 128);
	for (let n = 64; n > 0; n--) nativeHeapReference(cpu).gc.tables.setInteger(table, n, valueBool(false));
	for (let n = -1; n >= -64; n--) nativeHeapReference(cpu).gc.tables.setInteger(table, n, valueInteger(n));
	setReferenceGlobal(cpu, key, valueTable(table));
	const ram = cpu.memory.captureSaveState();
	const state = cpu.captureRuntimeState();
	assert.equal(cpu.tables.length(table), 64);
	assert.deepEqual(cpu.captureRuntimeState(), state, 'inspection does not normalize a non-boundary hint');
	nativeHeapReference(cpu).gc.tables.setInteger(table, 1, valueNil()); nativeHeapReference(cpu).gc.tables.setInteger(table, 64, valueNil()); nativeHeapReference(cpu).gc.tables.setInteger(table, -32, valueInteger(999));
	cpu.memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(state);
	const restored = valuePayload(cpu.getGlobalByKey(key));
	assert.equal(cpu.tables.length(restored), 64);
	assert.equal(cpu.tables.getInteger(restored, -32), valueInteger(-32));
	assert.deepEqual(cpu.captureRuntimeState(), state);
	for (let n = -65; n >= -256; n--) nativeHeapReference(cpu).gc.tables.setInteger(restored, n, valueInteger(n));
	assert.equal(cpu.tables.length(restored), 64, 'hash growth redistributes storage without changing the boundary');
});
