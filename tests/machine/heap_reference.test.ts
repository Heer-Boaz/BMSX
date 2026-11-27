import { setReferenceGlobal } from '../helpers/global_bank_reference';
import { resizeThreadStackReference } from '../helpers/thread_allocation_reference';
import * as ClosureRecord from '../../machine/ts/machine/cpu/closure';
import { DYNAMIC_RAM_BASE, MAIN_RAM_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { valuePayload } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import { CLOSURE_CAPTURE_WORDS } from '../../machine/ts/machine/cpu/closure';
import { UPVALUE_RECORD_KIND, UPVALUE_FLAGS, UPVALUE_OPEN, UPVALUE_OWNER, UPVALUE_VALUE_TAG, UPVALUE_VALUE_WORD, bindOpen, isOpen } from '../../machine/ts/machine/cpu/upvalue';
import { asClosure, valueFloatBits, valueInteger, valueNil } from '../../machine/ts/machine/cpu/value';
import { abortFixtureCompletionCall, allocatedObjectRecords, captureCpuCheckpoint, restoreCpuCheckpoint } from '../helpers/cpu_execution';
import { test } from 'node:test';
import { GC_OBJECT_PREFIX } from '../../machine/ts/machine/cpu/gc_object';
import { THREAD_RECORD_KIND } from '../../machine/ts/machine/cpu/thread';
import { GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { BUILTIN_FUNCTIONS } from '../../machine/ts/machine/cpu/builtin_values';
import { valueTable, valueClosure, valueBuiltinFunction, ValueTag } from '../../machine/ts/machine/cpu/value';
import { ValueStorage } from '../../machine/ts/machine/cpu/value_storage';
import { writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { type CPU } from '../../machine/ts/machine/cpu/cpu';
import { createTestSystemCpu, linkRawTestSystemBlua32, seedTestCapturedClosure, seedTestRomClosure } from '../helpers/blua32';
import { runGuestToHalt } from '../helpers/cpu_test_harness';

function machine(): CPU {
	const text = new Uint8Array(8);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	writeInstruction(text, 1, OpCode.RET, 0, 1, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 1, maxStack: 8 },
		{ firstWord: 1, wordCount: 1, maxStack: 1, staticClosure: false, upvalueDescs: [{ inStack: true, index: 0 }] },
	] });
	const { cpu, memory } = createTestSystemCpu(image);
	const frame = cpu.rootThread.currentFrame!, cells = new Uint32Array(1);
	frame.registers.set(1, valueClosure(seedTestCapturedClosure(cpu, image.symbols.functionAddresses[1], cells)));
	bindOpen(memory, cells[0], frame.thread.address, frame.stackBase, 0);
	frame.openUpvalueHead = cells[0];
	frame.top = 2;
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
			case THREAD_RECORD_KIND: assert.equal(gc.threadRecordAddress(address), address); break;
		}
	}
	assert.equal(new Set(records).size, records.length);
}

test('marking selects issued white headers, not arbitrary byte patterns', () => {
	const cpu = machine(), { gc, memory } = cpu, table = cpu.createTable();
	const raw = DYNAMIC_RAM_BASE + 0x600, header = ValueTag.Table | ((0xfc | gc.white()) << 8);
	memory.writeRamRecordWord(raw, header);
	assert.equal(gc.markValue(valueTable(raw)), false);
	assert.equal(memory.readRamRecordWord(raw), header);
	memory.writeRamRecordWord(table, header);
	assert.equal(gc.markValue(valueClosure(table)), false);
	assert.equal(gc.markValue(valueTable(table + MAIN_RAM_SIZE)), true);
	assert.equal(gc.markValue(valueTable(table)), false);
});

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
	frame.closureAddress = seedTestRomClosure(cpu, frame.functionAddress);
	frame.registers.setTable(0, roots); frame.top = 2;
	for (let i = 1; i <= 4; ++i) cpu.gc.tables.setInteger(roots, i, valueTable(cpu.createTable()));
	cpu.createTable();
	cpu.createTable();
	cpu.collectTrackedHeapBytes();
	const saved = cpu.captureRuntimeState(), thread = cpu.rootThread.address, canonical = frame.closure;
	const root = frame.registers.get(0), fourth = cpu.gc.tables.getInteger(roots, 4);
	const ram = cpu.memory.captureSaveState();
	for (let iteration = 0; iteration < 64; ++iteration) {
		const future = Array.from({ length: 12 }, () => cpu.createTable());
		cpu.memory.restoreSaveState(ram);
		cpu.restoreRuntimeState(saved);
		assert.equal(cpu.rootThread.address, thread);
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
	setReferenceGlobal(cpu, key, frame.registers.get(1));
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
	resizeThreadStackReference(cpu, frame.thread, 80);
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
	resizeThreadStackReference(cpu, frame.thread, oldCapacity);
	abortFixtureCompletionCall(cpu, 0);
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
	const arena = cpu.heapAllocator, occupied = arena.occupiedBytes();
	const retiredBytes = arena.allocationBytes(closure - GC_OBJECT_PREFIX) + arena.allocationBytes(address - GC_OBJECT_PREFIX);
	setReferenceGlobal(cpu, key, valueNil());
	cpu.collectTrackedHeapBytes();
	assert.equal(arena.occupiedBytes(), occupied - retiredBytes);
	assert.equal(cpu.gc.cellRecordAddress(address), 0, 'a retired capture has no issued header');
	assert.equal(memory.readRamRecordByte(address), 0);
});

test('reclaimed closures are not visited by the next sweep', () => {
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
	assert.equal(sweep(), occupied, 'reclaiming an object costs the same visit as retaining it');
	assert.equal(cpu.memory.readRamRecordByte(closure), 0);
	assert.equal(gc.closureRecordAddress(closure), 0);
	assert.equal(gc.openCellAddress(cellAddress), cellAddress, 'an open frame still roots the cell');
	assert.equal(sweep(), occupied - 1, 'only allocated records are visited');
});

test('restoring a suspended sweep keeps its cursor when a new object is added', () => {
	const cpu = machine(), { gc } = cpu;
	const dead = cpu.createTable();
	const keep = cpu.createTable();
	cpu.rootThread.currentFrame!.registers.set(0, valueTable(keep));
	while (gc.phase() !== GcPhase.Sweep) gc.step();
	assert.equal(gc.step(valueNil(), valueNil(), valueNil(), 0, false, 1), 1);
	assert.equal(gc.tableRecordAddress(dead), dead);
	const suspended = captureCpuCheckpoint(cpu);
	const finish = () => {
		const fresh = cpu.createTable();
		assert.equal(gc.step(valueNil(), valueNil(), valueNil(), 0, false, 1), 1);
		assert.equal(gc.tableRecordAddress(dead), 0, 'a new head does not disturb the suspended cursor');
		while (gc.active()) gc.step();
		assert.equal(gc.tableRecordAddress(fresh), fresh);
		assert.equal(gc.tableRecordAddress(keep), keep);
		return fresh;
	};
	const fresh = finish();
	const finished = cpu.memory.captureSaveState();
	restoreCpuCheckpoint(cpu, suspended);
	assert.equal(finish(), fresh);
	assert.deepEqual(cpu.memory.ramData(), finished.ram);
});
