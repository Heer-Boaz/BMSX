import * as ClosureRecord from '../../machine/ts/machine/cpu/closure';
import { DYNAMIC_RAM_BASE, MAIN_RAM_SIZE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { valuePayload } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import { CLOSURE_CAPTURE_WORDS, closureRecordBytes } from '../../machine/ts/machine/cpu/closure';
import { UPVALUE_HEAP_BYTES, UPVALUE_RECORD_KIND, UPVALUE_FLAGS, UPVALUE_OPEN, UPVALUE_OWNER, UPVALUE_VALUE_TAG, UPVALUE_VALUE_WORD, isOpen } from '../../machine/ts/machine/cpu/upvalue';
import { asClosure, valueFloatBits, valueInteger, valueNil } from '../../machine/ts/machine/cpu/value';
import { allocatedObjectRecords, captureCpuCheckpoint, restoreCpuCheckpoint } from '../helpers/cpu_execution';
import { test } from 'node:test';
import { heapAllocationBytes } from '../../machine/ts/machine/cpu/heap_allocator';
import { THREAD_RECORD_KIND } from '../../machine/ts/machine/cpu/thread';
import { GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { BUILTIN_FUNCTIONS } from '../../machine/ts/machine/cpu/builtin_values';
import { valueTable, valueBuiltinFunction, ValueTag } from '../../machine/ts/machine/cpu/value';
import { ValueStorage } from '../../machine/ts/machine/cpu/value_storage';
import { writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { type CPU } from '../../machine/ts/machine/cpu/cpu';
import { blua32TestFunctionAddress, createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { runGuestToHalt } from '../helpers/cpu_test_harness';

function machine(): CPU {
	const text = new Uint8Array(16);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 1, 0, 0);
	writeInstruction(text, 2, OpCode.HALT, 0, 0, 0);
	writeInstruction(text, 3, OpCode.RET, 0, 1, 0);
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 3, maxStack: 8 },
		{ firstWord: 3, wordCount: 1, maxStack: 1, staticClosure: false, upvalueDescs: [{ inStack: true, index: 0 }] },
	], closureRelocations: [{ wordIndex: 1, functionAddress: blua32TestFunctionAddress(SYSTEM_ROM_BASE, 1) }] }));
	runGuestToHalt(cpu, 1000);
	return cpu;
}
function checkReferences(cpu: CPU): void {
	const { gc } = cpu;
	const records = allocatedObjectRecords(cpu);
	for (const address of records) {
		switch (cpu.memory.readRamRecordByte(address)) {
			case ValueTag.Table: assert.equal(gc.tableRecordAddress(address), address); break;
			case ValueTag.Closure: assert.equal(gc.closureRecordAddress(address), address); break;
			case UPVALUE_RECORD_KIND: assert.equal(gc.cellRecordAddress(address), address); break;
			case THREAD_RECORD_KIND: assert.equal(gc.threadAt(address)?.address, address); break;
		}
	}
	assert.equal(new Set(records).size, records.length);
}

test('32-bit object payloads survive heap growth and collection', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!;
	const captured = frame.registers.getClosure(1, cpu.gc);
	const cell = ClosureRecord.captureAddress(cpu.memory, captured, 0);
	assert.equal(frame.registers.getPayload(1), captured);
	assert.equal(cpu.gc.closureRecordAddress(cell), 0);
	checkReferences(cpu);
	const roots = cpu.createTable(512), slots = new ValueStorage(400);
	frame.registers.setTable(0, roots); frame.top = 2;
	for (let i = 0; i < slots.capacity; ++i) {
		const object = cpu.createTable(); cpu.gc.tables.setInteger(roots, i + 1, valueTable(object));
		slots.words[i] = object; slots.tags[i] = ValueTag.Table;
	}
	cpu.collectTrackedHeapBytes();
	for (let i = 0; i < slots.capacity; ++i) assert.equal(cpu.gc.tableRecordAddress(slots.words[i]), valuePayload(cpu.gc.tables.getInteger(roots, i + 1)));
	checkReferences(cpu);
});

test('a freed header is cleared before its physical address is reused', () => {
	const cpu = machine(); cpu.collectTrackedHeapBytes();
	const dead = cpu.createTable(), id = dead;
	cpu.collectTrackedHeapBytes();
	assert.equal(cpu.gc.tableRecordAddress(id), 0);
	const next = cpu.createTable();
	assert.equal(next, id);
	assert.equal(cpu.gc.tableRecordAddress(id), next);
});

test('equally initialized CPUs have independent address spaces', () => {
	const first = machine(), second = machine(), a = first.createTable(), b = second.createTable();
	assert.equal(a, b);
	first.gc.tables.setInteger(a, 1, valueInteger(73));
	second.gc.tables.setInteger(b, 1, valueInteger(85));
	assert.equal(first.gc.tables.getInteger(a, 1), valueInteger(73));
	assert.equal(second.gc.tables.getInteger(b, 1), valueInteger(85));
});

test('restore publishes physical roots and drops discarded future records', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!, roots = cpu.createTable(4);
	frame.registers.setTable(0, roots); frame.top = 2;
	for (let i = 1; i <= 4; ++i) cpu.gc.tables.setInteger(roots, i, valueTable(cpu.createTable()));
	cpu.createTable();
	cpu.createTable();
	cpu.collectTrackedHeapBytes();
	const saved = cpu.captureRuntimeState(), thread = cpu.gc.reference(cpu.rootThread), canonical = frame.closure;
	const root = frame.registers.get(0), fourth = cpu.gc.tables.getInteger(roots, 4);
	const ram = cpu.memory.captureSaveState();
	for (let iteration = 0; iteration < 64; ++iteration) {
		const future = Array.from({ length: 12 }, () => cpu.createTable());
		cpu.memory.restoreSaveState(ram);
		cpu.restoreRuntimeState(saved);
		assert.equal(cpu.gc.threadAt(thread), cpu.rootThread);
		assert.equal(cpu.rootThread.currentFrame!.closure, canonical);
		assert.equal(cpu.rootThread.currentFrame!.registers.get(0), root);
		assert.equal(cpu.gc.tables.getInteger(valuePayload(root), 4), fourth);
		for (const object of future) assert.equal(cpu.gc.tableRecordAddress(object), 0);
		checkReferences(cpu);
		assert.deepEqual(cpu.captureRuntimeState(), saved);
		assert.deepEqual([cpu.createTable(), cpu.createTable()], future.slice(0, 2).map(table => table));
		cpu.memory.restoreSaveState(ram);
		cpu.restoreRuntimeState(saved);
	}
});

test('incremental GC and phase-preserving restore keep physical attachments synchronized', () => {
	const cpu = machine(), roots = cpu.createTable(1024), frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, roots); frame.top = 2;
	for (let i = 1; i <= 1000; ++i) {
		cpu.gc.tables.setInteger(roots, i, valueTable(cpu.createTable(1, 1)));
		const dead = cpu.createTable(1); cpu.gc.tables.setInteger(dead, 1, valueTable(cpu.createTable()));
	}
	const phases = new Set<GcPhase>();
	for (let step = 0; step < 1000; ++step) {
		cpu.gc.step(); checkReferences(cpu);
		const saved = cpu.captureRuntimeState(); phases.add(cpu.gc.phase());
		cpu.restoreRuntimeState(saved); checkReferences(cpu);
		assert.deepEqual(cpu.captureRuntimeState(), saved);
		if (!cpu.gc.active()) break;
	}
	for (const phase of [GcPhase.Mark, GcPhase.Atomic, GcPhase.Sweep, GcPhase.Pause]) assert.ok(phases.has(phase));
});


test('builtin functions retain their own ids outside the GC heap', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!, functions = cpu.createTable(BUILTIN_FUNCTIONS.length);
	frame.registers.setTable(0, functions); frame.top = 2;
	const before = allocatedObjectRecords(cpu);
	for (const builtin of BUILTIN_FUNCTIONS) cpu.gc.tables.setInteger(functions, builtin.id + 1, valueBuiltinFunction(builtin.id));
	const after = allocatedObjectRecords(cpu);
	assert.deepEqual(after, before);
	cpu.restoreRuntimeState(cpu.captureRuntimeState());
	const restored = cpu.rootThread.currentFrame!.registers.getPayload(0);
	for (const builtin of BUILTIN_FUNCTIONS) assert.equal(cpu.gc.tables.getInteger(restored, builtin.id + 1), valueBuiltinFunction(builtin.id));
});


test('a closed capture is read from RAM, rewound with RAM and released by collection', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!, memory = cpu.memory;
	const key = cpu.stringPool.intern('saved_capture');
	cpu.setGlobalByKey(key, frame.registers.get(1));
	const closure = frame.registers.getClosure(1, cpu.gc);
	const address = ClosureRecord.captureAddress(cpu.memory, closure, 0);
	assert.equal(cpu.gc.cellRecordAddress(address), address);
	assert.equal(cpu.gc.openCellAddress(address + MAIN_RAM_SIZE), address, 'a mirrored open link selects the same physical cell');
	assert.equal(memory.readRamRecordWord(closure + CLOSURE_CAPTURE_WORDS), address);
	assert.equal(memory.readRamRecordByte(address + UPVALUE_FLAGS), UPVALUE_OPEN);
	assert.equal(memory.readRamRecordWord(address + UPVALUE_OWNER), frame.thread.address);
	assert.equal(memory.readRamRecordWord(address + UPVALUE_VALUE_WORD), frame.stackBase);
	const open = captureCpuCheckpoint(cpu);
	const oldStack = frame.thread.stackOffset();
	const oldCapacity = frame.thread.stackRegisters.capacity();
	frame.thread.resizeStack(80);
	assert.notEqual(frame.thread.stackOffset(), oldStack);
	frame.registers.setFloatBits(0, 0xffa12345);
	assert.equal(cpu.readClosureUpvalue(closure, 0), valueFloatBits(0xffa12345));
	const rawCell = DYNAMIC_RAM_BASE + 0x600;
	memory.writeRamRecordByte(rawCell, UPVALUE_RECORD_KIND);
	memory.writeRamRecordByte(rawCell + UPVALUE_FLAGS, UPVALUE_OPEN);
	memory.writeRamRecordWord(rawCell + UPVALUE_OWNER, frame.thread.address | 0x80000000);
	memory.writeRamRecordWord(rawCell + UPVALUE_VALUE_WORD, frame.stackBase);
	memory.writeRamRecordWord(closure + CLOSURE_CAPTURE_WORDS, rawCell | 0x80000000);
	assert.equal(cpu.gc.cellRecordAddress(rawCell), 0, 'a header outside the allocator does not make a live GC cell');
	assert.equal(cpu.readClosureUpvalue(closure, 0), valueFloatBits(0xffa12345), 'a raw open cell needs no host attachment');
	memory.writeRamRecordWord(closure + CLOSURE_CAPTURE_WORDS, address);
	frame.thread.resizeStack(oldCapacity);
	cpu.abortCompletionCall(0);
	assert.equal(isOpen(memory, address), false);
	assert.equal(memory.readRamRecordWord(address + UPVALUE_VALUE_WORD), 0xffa12345);
	assert.equal(memory.readRamRecordByte(address + UPVALUE_VALUE_TAG), ValueTag.Float);
	const checkpoint = captureCpuCheckpoint(cpu);
	memory.writeRamRecordWord(address + UPVALUE_VALUE_WORD, 0x80000000);
	assert.equal(cpu.readClosureUpvalue(closure, 0), valueFloatBits(0x80000000));
	memory.writeRamRecordByte(rawCell + UPVALUE_FLAGS, 0);
	memory.writeRamRecordWord(rawCell + UPVALUE_VALUE_WORD, 55);
	memory.writeRamRecordByte(rawCell + UPVALUE_VALUE_TAG, ValueTag.Integer);
	memory.writeRamRecordWord(closure + CLOSURE_CAPTURE_WORDS, rawCell | 0x80000000);
	assert.equal(cpu.readClosureUpvalue(closure, 0), valueInteger(55));
	restoreCpuCheckpoint(cpu, open);
	cpu.rootThread.currentFrame!.registers.setInteger(0, 44);
	restoreCpuCheckpoint(cpu, checkpoint);
	const restored = asClosure(cpu.getGlobalByKey(key), cpu.gc);
	assert.equal(ClosureRecord.captureAddress(cpu.memory, restored, 0), address);
	assert.equal(cpu.readClosureUpvalue(restored, 0), valueFloatBits(0xffa12345));
	cpu.collectTrackedHeapBytes();
	const occupied = cpu.heapAllocator.occupiedBytes();
	cpu.setGlobalByKey(key, valueNil());
	cpu.collectTrackedHeapBytes();
	assert.equal(cpu.heapAllocator.occupiedBytes(), occupied - heapAllocationBytes(closureRecordBytes(1)) - UPVALUE_HEAP_BYTES);
	assert.equal(cpu.gc.cellRecordAddress(address), 0, 'a retired capture has no issued header');
	assert.equal(memory.readRamRecordByte(address), 0);
});

test('a vacant closure slot costs a visit while its object page remains in use', () => {
	const cpu = machine(), { gc } = cpu, frame = cpu.rootThread.currentFrame!;
	const closure = frame.registers.getClosure(1, gc);
	const cellAddress = ClosureRecord.captureAddress(cpu.memory, closure, 0);
	const sweep = () => {
		while (gc.phase() !== GcPhase.Sweep) gc.step();
		const work = gc.step();
		while (gc.active()) gc.step();
		return work;
	};
	const occupied = sweep();
	frame.registers.setNil(1);
	assert.equal(sweep(), occupied, 'reclaiming an issued closure costs one visit');
	assert.equal(cpu.memory.readRamRecordByte(closure), 0);
	assert.equal(gc.closureRecordAddress(closure), 0);
	assert.equal(gc.openCellAddress(cellAddress), cellAddress, 'an open frame still roots the cell');
	assert.equal(sweep(), occupied, 'a free slot still costs one visit');
});
