import assert from 'node:assert/strict';
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
	for (const id of ids) { assert.notEqual(id, 0); assert.equal(cpu.gc.reference(cpu.gc.object(id)), id); }
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
		const object = cpu.createTable(); roots.setInteger(i + 1, valueTable(cpu.gc.reference(object)));
		slots.words[i] = cpu.gc.reference(object); slots.tags[i] = ValueTag.Table;
	}
	cpu.collectTrackedHeapBytes();
	for (let i = 0; i < slots.capacity; ++i) assert.equal(cpu.gc.object(slots.words[i]), asTable(roots.getInteger(i + 1), cpu.gc));
	checkDirectory(cpu);
});

test('freed ids recycle without reusing the hash identity or retaining the old object', () => {
	const cpu = machine(); cpu.collectTrackedHeapBytes();
	const dead = cpu.createTable(), id = cpu.gc.reference(dead), hash = dead.hashId;
	cpu.collectTrackedHeapBytes();
	assert.equal(dead.referenceId, 0);
	const next = cpu.createTable();
	assert.equal(cpu.gc.reference(next), id); assert.notEqual(next.hashId, hash);
	assert.equal(cpu.gc.object(id), next);
});

test('equally initialized CPUs have independent object directories', () => {
	const first = machine(), second = machine(), a = first.createTable(), b = second.createTable();
	assert.equal(first.gc.reference(a), second.gc.reference(b)); assert.notEqual(a, b);
	assert.equal(first.gc.object(first.gc.reference(a)), a); assert.equal(second.gc.object(second.gc.reference(b)), b);
});

test('restore registers identities before edges and releases discarded future ids', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!, roots = cpu.createTable(4);
	frame.registers.setTable(0, cpu.gc.reference(roots)); frame.top = 2;
	for (let i = 1; i <= 4; ++i) roots.setInteger(i, valueTable(cpu.gc.reference(cpu.createTable())));
	cpu.createTable();
	cpu.createTable();
	cpu.collectTrackedHeapBytes();
	const saved = cpu.captureRuntimeState(), thread = cpu.gc.reference(cpu.rootThread), canonical = cpu.gc.reference(frame.closure);
	const root = frame.registers.get(0), fourth = roots.getInteger(4);
	assert.ok(saved.gc.freeReferences.length >= 2);
	for (let iteration = 0; iteration < 64; ++iteration) {
		const future = Array.from({ length: 12 }, () => cpu.createTable());
		cpu.restoreRuntimeState(saved);
		assert.equal(cpu.gc.object(thread), cpu.rootThread);
		assert.equal(cpu.gc.reference(cpu.rootThread.currentFrame!.closure), canonical);
		assert.equal(cpu.rootThread.currentFrame!.registers.get(0), root);
		assert.equal(asTable(root, cpu.gc).getInteger(4), fourth);
		for (const object of future) assert.equal(object.referenceId, 0);
		checkDirectory(cpu);
		assert.deepEqual(cpu.captureRuntimeState(), saved);
		assert.deepEqual([cpu.gc.reference(cpu.createTable()), cpu.gc.reference(cpu.createTable())], saved.gc.freeReferences.slice(0, 2));
	}
});

test('incremental GC and phase-preserving restore keep the directory synchronized', () => {
	const cpu = machine(), roots = cpu.createTable(1024), frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, cpu.gc.reference(roots)); frame.top = 2;
	for (let i = 1; i <= 1000; ++i) {
		roots.setInteger(i, valueTable(cpu.gc.reference(cpu.createTable(1, 1))));
		const dead = cpu.createTable(1); dead.setInteger(1, valueTable(cpu.gc.reference(cpu.createTable())));
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
	for (const builtin of BUILTIN_FUNCTIONS) functions.setInteger(builtin.id + 1, valueBuiltinFunction(builtin.id));
	const after = cpu.gc.captureState(object => cpu.gc.reference(object));
	assert.deepEqual(after.allocations, before.allocations);
	cpu.restoreRuntimeState(cpu.captureRuntimeState());
	const restored = cpu.rootThread.currentFrame!.registers.getTable(0, cpu.gc);
	for (const builtin of BUILTIN_FUNCTIONS) assert.equal(restored.getInteger(builtin.id + 1), valueBuiltinFunction(builtin.id));
});
