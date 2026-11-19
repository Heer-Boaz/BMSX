import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { valuePayload as tableAddressPayload } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import { UPVALUE_HEAP_BYTES, UPVALUE_VALUE_TAG, UPVALUE_VALUE_WORD, Upvalue } from '../../machine/ts/machine/cpu/closure';
import { asClosure, valueFloatBits, valueNil } from '../../machine/ts/machine/cpu/value';
import { captureCpuCheckpoint, restoreCpuCheckpoint } from '../helpers/cpu_execution';
import { test } from 'node:test';
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
function checkDirectory(cpu: CPU): number {
	const ids = cpu.gc.captureState(object => cpu.gc.reference(object)).allocations;
	assert.equal(new Set(ids).size, ids.length);
	for (const id of ids) { assert.notEqual(id, 0); assert.equal(cpu.gc.reference(id >= RAM_BASE ? cpu.gc.tableAt(id)! : cpu.gc.object(id)), id); }
	return Math.max(...ids);
}

test('32-bit object payloads survive directory growth and collection', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!;
	const captured = frame.registers.getClosure(1, cpu.gc);
	for (const object of [cpu.rootThread, frame.closure, captured, cpu.gc.object(captured.upvalues[0])])
		assert.equal(cpu.gc.object(cpu.gc.reference(object)), object);
	const roots = cpu.createTable(512), slots = new ValueStorage(400);
	frame.registers.setTable(0, cpu.gc.reference(roots)); frame.top = 2;
	for (let i = 0; i < slots.capacity; ++i) {
		const object = cpu.createTable(); roots.records.setInteger(roots.address, i + 1, valueTable(cpu.gc.reference(object)));
		slots.words[i] = cpu.gc.reference(object); slots.tags[i] = ValueTag.Table;
	}
	cpu.collectTrackedHeapBytes();
	for (let i = 0; i < slots.capacity; ++i) assert.equal(cpu.gc.tableAt(slots.words[i]), asTable(roots.records.getInteger(roots.address, i + 1), cpu.gc));
	checkDirectory(cpu);
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
	assert.equal(saved.gc.references.filter(id => id === 0).length, 5, "physical tables have no directory slots");
	for (let iteration = 0; iteration < 64; ++iteration) {
		const future = Array.from({ length: 12 }, () => cpu.createTable());
		cpu.memory.restoreSaveState(ram);
		cpu.restoreRuntimeState(saved);
		assert.equal(cpu.gc.object(thread), cpu.rootThread);
		assert.equal(cpu.gc.reference(cpu.rootThread.currentFrame!.closure), canonical);
		assert.equal(cpu.rootThread.currentFrame!.registers.get(0), root);
		assert.equal(cpu.gc.tables.getInteger(tableAddressPayload(root), 4), fourth);
		for (const object of future) assert.equal(object.referenceId, 0);
		checkDirectory(cpu);
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
		cpu.gc.step(); checkDirectory(cpu);
		const saved = cpu.captureRuntimeState(); phases.add(saved.gc.phase);
		cpu.restoreRuntimeState(saved); checkDirectory(cpu);
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
	const cell = cpu.gc.object(closure.upvalues[0]) as Upvalue;
	const address = cell.address;
	frame.registers.setFloatBits(0, 0xffa12345);
	cpu.abortCompletionCall(0);
	assert.equal(cell.open, false);
	assert.equal(memory.readRamRecordWord(address + UPVALUE_VALUE_WORD), 0xffa12345);
	assert.equal(memory.readRamRecordByte(address + UPVALUE_VALUE_TAG), ValueTag.Float);
	const checkpoint = captureCpuCheckpoint(cpu);
	memory.writeRamRecordWord(address + UPVALUE_VALUE_WORD, 0x80000000);
	assert.equal(cpu.readClosureUpvalue(closure, 0), valueFloatBits(0x80000000));
	restoreCpuCheckpoint(cpu, checkpoint);
	assert.equal(cpu.readClosureUpvalue(asClosure(cpu.getGlobalByKey(key), cpu.gc), 0), valueFloatBits(0xffa12345));
	const occupied = cpu.heapAllocator.occupiedBytes();
	cpu.setGlobalByKey(key, valueNil());
	cpu.collectTrackedHeapBytes();
	assert.equal(cpu.heapAllocator.occupiedBytes(), occupied - UPVALUE_HEAP_BYTES);
});
