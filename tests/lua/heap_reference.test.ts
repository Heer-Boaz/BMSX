import { DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { valuePayload as tableAddressPayload } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import { CLOSURE_CAPTURE_WORDS, closureRecordBytes, UPVALUE_HEAP_BYTES, UPVALUE_FLAGS, UPVALUE_OPEN, UPVALUE_OWNER, UPVALUE_VALUE_TAG, UPVALUE_VALUE_WORD, Upvalue } from '../../machine/ts/machine/cpu/closure';
import { asClosure, valueFloatBits, valueInteger, valueNil } from '../../machine/ts/machine/cpu/value';
import { captureCpuCheckpoint, restoreCpuCheckpoint } from '../helpers/cpu_execution';
import { test } from 'node:test';
import { heapAllocationBytes } from '../../machine/ts/machine/cpu/heap_allocator';
import { GcKind } from '../../machine/ts/machine/cpu/gc_object';
import { GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { BUILTIN_FUNCTIONS } from '../../machine/ts/machine/cpu/builtin_values';
import { asTable, valueTable, valueBuiltinFunction, ValueTag } from '../../machine/ts/machine/cpu/value';
import { ValueStorage } from '../../machine/ts/machine/cpu/value_storage';
import { writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { RunResult, type CPU } from '../../machine/ts/machine/cpu/cpu';
import { SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { blua32TestFunctionAddress, createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

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
	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	return cpu;
}
function checkReferences(cpu: CPU): void {
	const { gc } = cpu;
	const ids = gc.captureState(object => {
		const id = gc.reference(object);
		assert.notEqual(id, 0);
		switch (object.gcKind) {
			case GcKind.Table: assert.equal(gc.tableAt(id), object); break;
			case GcKind.Closure: assert.equal(gc.closureAt(id), object); break;
			case GcKind.Upvalue: assert.equal(gc.cellAt(id), object); break;
			case GcKind.Thread: assert.equal(gc.threadAt(id), object); break;
			default: assert.equal(gc.object(id), object); break;
		}
		return id;
	}).allocations;
	assert.equal(new Set(ids).size, ids.length);
}

test('32-bit object payloads survive directory growth and collection', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!;
	const captured = frame.registers.getClosure(1, cpu.gc);
	const cell = cpu.gc.cellAt(captured.captureAddress(0))!;
	assert.equal(frame.registers.getPayload(1), captured.address);
	assert.equal(captured.referenceId, 0);
	assert.equal(cell.referenceId, 0);
	assert.equal(cpu.gc.closureAt(cell.address), null);
	checkReferences(cpu);
	const roots = cpu.createTable(512), slots = new ValueStorage(400);
	frame.registers.setTable(0, cpu.gc.reference(roots)); frame.top = 2;
	for (let i = 0; i < slots.capacity; ++i) {
		const object = cpu.createTable(); roots.records.setInteger(roots.address, i + 1, valueTable(cpu.gc.reference(object)));
		slots.words[i] = cpu.gc.reference(object); slots.tags[i] = ValueTag.Table;
	}
	cpu.collectTrackedHeapBytes();
	for (let i = 0; i < slots.capacity; ++i) assert.equal(cpu.gc.tableAt(slots.words[i]), asTable(roots.records.getInteger(roots.address, i + 1), cpu.gc));
	checkReferences(cpu);
});

test('freed ids recycle without reusing the hash identity or retaining the old object', () => {
	const cpu = machine(); cpu.collectTrackedHeapBytes();
	const dead = cpu.createTable(), id = cpu.gc.reference(dead), hash = dead.hashId;
	cpu.collectTrackedHeapBytes();
	assert.equal(dead.referenceId, 0);
	const next = cpu.createTable();
	assert.equal(cpu.gc.reference(next), id); assert.notEqual(next.hashId, hash);
	assert.equal(cpu.gc.tableAt(id), next);
});

test('equally initialized CPUs have independent object directories', () => {
	const first = machine(), second = machine(), a = first.createTable(), b = second.createTable();
	assert.equal(first.gc.reference(a), second.gc.reference(b)); assert.notEqual(a, b);
	assert.equal(first.gc.tableAt(first.gc.reference(a)), a); assert.equal(second.gc.tableAt(second.gc.reference(b)), b);
});

test('restore registers identities before edges and releases discarded future ids', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!, roots = cpu.createTable(4);
	frame.registers.setTable(0, cpu.gc.reference(roots)); frame.top = 2;
	for (let i = 1; i <= 4; ++i) roots.records.setInteger(roots.address, i, valueTable(cpu.gc.reference(cpu.createTable())));
	cpu.createTable();
	cpu.createTable();
	cpu.collectTrackedHeapBytes();
	const saved = cpu.captureRuntimeState(), thread = cpu.gc.reference(cpu.rootThread), canonical = cpu.gc.reference(frame.closure);
	const root = frame.registers.get(0), fourth = roots.records.getInteger(roots.address, 4);
	const ram = cpu.memory.captureSaveState();
	assert.equal(saved.gc.references.filter(id => id !== 0).length, 0, "physical guest objects have no directory slots");
	for (let iteration = 0; iteration < 64; ++iteration) {
		const future = Array.from({ length: 12 }, () => cpu.createTable());
		cpu.memory.restoreSaveState(ram);
		cpu.restoreRuntimeState(saved);
		assert.equal(cpu.gc.threadAt(thread), cpu.rootThread);
		assert.equal(cpu.gc.reference(cpu.rootThread.currentFrame!.closure), canonical);
		assert.equal(cpu.rootThread.currentFrame!.registers.get(0), root);
		assert.equal(cpu.gc.tables.getInteger(tableAddressPayload(root), 4), fourth);
		for (const object of future) assert.equal(object.referenceId, 0);
		checkReferences(cpu);
		assert.deepEqual(cpu.captureRuntimeState(), saved);
		assert.deepEqual([cpu.createTable().address, cpu.createTable().address], future.slice(0, 2).map(table => table.address));
		cpu.memory.restoreSaveState(ram);
		cpu.restoreRuntimeState(saved);
	}
});

test('incremental GC and phase-preserving restore keep the directory synchronized', () => {
	const cpu = machine(), roots = cpu.createTable(1024), frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, cpu.gc.reference(roots)); frame.top = 2;
	for (let i = 1; i <= 1000; ++i) {
		roots.records.setInteger(roots.address, i, valueTable(cpu.gc.reference(cpu.createTable(1, 1))));
		const dead = cpu.createTable(1); dead.records.setInteger(dead.address, 1, valueTable(cpu.gc.reference(cpu.createTable())));
	}
	const phases = new Set<GcPhase>();
	for (let step = 0; step < 1000; ++step) {
		cpu.gc.step(); checkReferences(cpu);
		const saved = cpu.captureRuntimeState(); phases.add(saved.gc.phase);
		cpu.restoreRuntimeState(saved); checkReferences(cpu);
		assert.deepEqual(cpu.captureRuntimeState(), saved);
		if (!cpu.gc.active()) break;
	}
	for (const phase of [GcPhase.Mark, GcPhase.Atomic, GcPhase.Sweep, GcPhase.Pause]) assert.ok(phases.has(phase));
});


test('builtin functions retain their own ids outside the GC directory', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!, functions = cpu.createTable(BUILTIN_FUNCTIONS.length);
	frame.registers.setTable(0, cpu.gc.reference(functions)); frame.top = 2;
	const before = cpu.gc.captureState(object => cpu.gc.reference(object));
	for (const builtin of BUILTIN_FUNCTIONS) functions.records.setInteger(functions.address, builtin.id + 1, valueBuiltinFunction(builtin.id));
	const after = cpu.gc.captureState(object => cpu.gc.reference(object));
	assert.deepEqual(after.allocations, before.allocations);
	cpu.restoreRuntimeState(cpu.captureRuntimeState());
	const restored = cpu.rootThread.currentFrame!.registers.getTable(0, cpu.gc);
	for (const builtin of BUILTIN_FUNCTIONS) assert.equal(restored.records.getInteger(restored.address, builtin.id + 1), valueBuiltinFunction(builtin.id));
});


test('a closed capture is read from RAM, rewound with RAM and released by collection', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!, memory = cpu.memory;
	const key = cpu.stringPool.intern('saved_capture');
	cpu.setGlobalByKey(key, frame.registers.get(1));
	const closure = frame.registers.getClosure(1, cpu.gc);
	const cell = cpu.gc.cellAt(closure.captureAddress(0)) as Upvalue;
	const address = cell.address;
	assert.equal(memory.readRamRecordWord(closure.address + CLOSURE_CAPTURE_WORDS), cell.address);
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
	memory.writeRamRecordByte(rawCell + UPVALUE_FLAGS, UPVALUE_OPEN);
	memory.writeRamRecordWord(rawCell + UPVALUE_OWNER, frame.thread.address | 0x80000000);
	memory.writeRamRecordWord(rawCell + UPVALUE_VALUE_WORD, frame.stackBase);
	memory.writeRamRecordWord(closure.address + CLOSURE_CAPTURE_WORDS, rawCell | 0x80000000);
	assert.equal(cpu.readClosureUpvalue(closure, 0), valueFloatBits(0xffa12345), 'a raw open cell needs no host attachment');
	memory.writeRamRecordWord(closure.address + CLOSURE_CAPTURE_WORDS, address);
	frame.thread.resizeStack(oldCapacity);
	cpu.abortCompletionCall(0);
	assert.equal(cell.open, false);
	assert.equal(memory.readRamRecordWord(address + UPVALUE_VALUE_WORD), 0xffa12345);
	assert.equal(memory.readRamRecordByte(address + UPVALUE_VALUE_TAG), ValueTag.Float);
	const checkpoint = captureCpuCheckpoint(cpu);
	memory.writeRamRecordWord(address + UPVALUE_VALUE_WORD, 0x80000000);
	assert.equal(cpu.readClosureUpvalue(closure, 0), valueFloatBits(0x80000000));
	memory.writeRamRecordByte(rawCell + UPVALUE_FLAGS, 0);
	memory.writeRamRecordWord(rawCell + UPVALUE_VALUE_WORD, 55);
	memory.writeRamRecordByte(rawCell + UPVALUE_VALUE_TAG, ValueTag.Integer);
	memory.writeRamRecordWord(closure.address + CLOSURE_CAPTURE_WORDS, rawCell | 0x80000000);
	assert.equal(cpu.readClosureUpvalue(closure, 0), valueInteger(55));
	restoreCpuCheckpoint(cpu, open);
	cpu.rootThread.currentFrame!.registers.setInteger(0, 44);
	restoreCpuCheckpoint(cpu, checkpoint);
	assert.equal(cpu.readClosureUpvalue(asClosure(cpu.getGlobalByKey(key), cpu.gc), 0), valueFloatBits(0xffa12345));
	cpu.collectTrackedHeapBytes();
	const occupied = cpu.heapAllocator.occupiedBytes();
	cpu.setGlobalByKey(key, valueNil());
	cpu.collectTrackedHeapBytes();
	assert.equal(cpu.heapAllocator.occupiedBytes(), occupied - heapAllocationBytes(closureRecordBytes(1)) - UPVALUE_HEAP_BYTES);
});

test('a vacant closure slot costs a visit while its object page remains in use', () => {
	const cpu = machine(), { gc } = cpu, frame = cpu.rootThread.currentFrame!;
	const closure = frame.registers.getClosure(1, gc);
	const cellAddress = closure.captureAddress(0);
	const sweep = () => {
		while (gc.captureState(() => 0).phase !== GcPhase.Sweep) gc.step();
		const work = gc.step();
		while (gc.active()) gc.step();
		return work;
	};
	const occupied = sweep();
	frame.registers.setNil(1);
	assert.equal(sweep(), occupied, 'reclaiming an issued closure costs one visit');
	assert.equal(cpu.memory.readRamRecordByte(closure.address), 0);
	assert.equal(gc.closureAt(closure.address), null);
	assert.equal(gc.cellAt(cellAddress)!.open, true, 'an open frame still roots the cell');
	assert.equal(sweep(), occupied, 'a free slot still costs one visit');
});
