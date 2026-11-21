import { allocatedObjectRecords } from '../helpers/cpu_execution';
import { FRAME_CONTROL_BYTES, FrameField } from '../../machine/ts/machine/cpu/call_state';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { HEAP_PAGE_SIZE, MAIN_RAM_SIZE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GcDiagnostics } from '../../machine/ts/machine/cpu/gc_diagnostics';
import { GC_COLOR_OFFSET, GC_OLD, GC_REMEMBERED, GC_RECORD_LINK, GC_RECORD_SHIFT } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET, heapAllocationBytes } from '../../machine/ts/machine/cpu/heap_allocator';
import { THREAD_HEAP_BYTES, THREAD_INITIAL_FRAMES, THREAD_INITIAL_VALUES, THREAD_STACK_SLOT_BYTES, ThreadStatus } from '../../machine/ts/machine/cpu/thread';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { TableRecords } from '../../machine/ts/machine/cpu/table';
import { GcPhase, GC_TRACE_RECORD, GC_TRACE_CURSOR, GC_STEP_WORDS, GC_THREAD_VISITS, GC_VISIT_COUNT, GC_VISIT_TAIL, GC_WEAK_VISITS } from '../../machine/ts/machine/cpu/gc_heap';
import * as Closure from '../../machine/ts/machine/cpu/closure';
import * as Upvalue from '../../machine/ts/machine/cpu/upvalue';
import { ValueTag, hashCanonicalTableKey, valueBuiltinFunction, valuePayload, valueBool, valueInteger, valueNil, valueTable, valueString, valueThread } from '../../machine/ts/machine/cpu/value';
import { writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { blua32TestFunctionAddress, createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

function machine() {
	const text = new Uint8Array(4);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	return createTestSystemCpu(linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 8 }] })).cpu;
}

test('incremental marking preserves changed table edges, metatables and final register roots', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!;
	const roots = cpu.createTable(1024, 0), field = cpu.stringPool.intern('child');
	frame.registers.setTable(0, roots); frame.top = 1;
	for (let i = 1; i <= 1000; ++i) {
		const item = cpu.createTable(1, 1);
		cpu.gc.tables.setStringKey(item, field, valueBool(false)); cpu.gc.tables.setInteger(roots, i, valueTable(item));
	}
	const target = valuePayload(cpu.gc.tables.getInteger(roots, 1000));
	const firstWork = cpu.gc.step();
	assert.ok(firstWork >= GC_STEP_WORDS);
	assert.equal(cpu.gc.phase(), GcPhase.Mark);
	assert.equal(cpu.gc.memory.readRamRecordByte(target + GC_COLOR_OFFSET), 3, 'the mutation really targets an already traced allocation');
	assert.equal(cpu.memory.readRamRecordByte(target + GC_COLOR_OFFSET), 3);
	assert.equal(cpu.memory.readRamRecordByte(cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET), GcPhase.Mark);
	cpu.gc.tables.setStringKey(target, field, valueInteger(1));
	assert.equal(cpu.memory.readRamRecordByte(target + GC_COLOR_OFFSET), 3);
	assert.equal(cpu.memory.readRamRecordWord(cpu.gc.changedHeadOffset()), 0, 'scalar replacement does not enqueue a black table');
	const arrayChild = cpu.createTable(), fieldChild = cpu.createTable(), metatable = cpu.createTable();
	cpu.gc.tables.setInteger(target, 1, valueTable(arrayChild));
	cpu.gc.tables.setStringKey(target, field, valueTable(fieldChild));
	cpu.gc.tables.setMetatableAddress(target, metatable);
	assert.equal(cpu.memory.readRamRecordWord(cpu.gc.changedHeadOffset()), (target & (MAIN_RAM_SIZE - 1)) >>> GC_RECORD_SHIFT);
	assert.equal(cpu.memory.readRamRecordWord(target + GC_RECORD_LINK), 0,
		'repeated stores do not link the same table to itself');
	const rootChild = cpu.createTable();
	frame.registers.setTable(1, rootChild); frame.top = 2;
	const expectedIds = [arrayChild, fieldChild, metatable, rootChild];
	let steps = 0;
	while (cpu.gc.active() && steps++ < 1000) cpu.gc.step();
	assert.ok(!cpu.gc.active()); assert.ok(steps > 2, 'the graph was not collected in one call');
	for (const id of expectedIds) assert.ok(allocatedObjectRecords(cpu).includes(id));
	assert.equal(cpu.gc.tables.getInteger(target, 1), valueTable(arrayChild)); assert.equal(cpu.gc.tables.getStringKey(target, field), valueTable(fieldChild));
	assert.equal(cpu.gc.tables.metatableAddress(target), metatable); assert.equal(frame.registers.getPayload(1), rootChild);
	frame.registers.clear(frame.stackCapacity); frame.top = 0;
	cpu.collectTrackedHeapBytes();
	for (const id of expectedIds) assert.ok(!allocatedObjectRecords(cpu).includes(id));
});

test('major marking resumes large closure captures from a RAM snapshot', () => {
	const captures = 9000;
	const text = new Uint8Array(7 * 4);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 2, 0, 0);
	writeInstruction(text, 2, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 3, OpCode.CLOSURE, 3, 0, 0);
	writeInstruction(text, 4, OpCode.JMP, 1, 0, 0);
	writeInstruction(text, 5, OpCode.HALT, 0, 0, 0);
	writeInstruction(text, 6, OpCode.HALT, 0, 0, 0);
	const capture = { inStack: true, index: 0 }, lastCapture = { inStack: true, index: 1 };
	const upvalueDescs = Array<typeof capture>(captures).fill(capture);
	upvalueDescs[captures - 1] = lastCapture;
	const { cpu, memory } = createTestSystemCpu(linkRawTestSystemBlua32({
		text,
		functions: [
			{ firstWord: 0, wordCount: 6, maxStack: 8 },
			{ firstWord: 6, wordCount: 1, upvalueDescs: [capture, lastCapture] },
			{ firstWord: 6, wordCount: 1, upvalueDescs },
		],
		closureRelocations: [
			{ wordIndex: 1, functionAddress: blua32TestFunctionAddress(SYSTEM_ROM_BASE, 1) },
			{ wordIndex: 3, functionAddress: blua32TestFunctionAddress(SYSTEM_ROM_BASE, 2) },
		],
	}));
	const frame = cpu.rootThread.currentFrame!, gc = cpu.gc;
	const lastTarget = cpu.createTable();
	frame.registers.setTable(0, cpu.createTable());
	frame.registers.setTable(1, lastTarget); frame.top = 2;
	cpu.runUntilDepth(0, 20000);
	frame.registers.clear(3);
	const closure = frame.registers.getPayload(3);
	const cell = Closure.captureAddress(memory, closure, 0);
	assert.equal(Upvalue.isOpen(memory, cell), false);

	const control = cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	assert.equal(gc.step(), GC_STEP_WORDS);
	assert.equal(gc.phase(), GcPhase.Mark);
	assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), closure);
	const next = memory.readRamRecordWord(control + GC_TRACE_CURSOR);
	assert.ok(next > 0 && next < captures);
	assert.equal(gc.isAlive(lastTarget), false, 'the final capture has not been marked');
	const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
	const finish = () => {
		const replacement = cpu.createTable();
		Upvalue.store(gc, cell, ValueTag.Table, replacement);
		assert.equal(gc.step(), GC_STEP_WORDS);
		assert.ok(memory.readRamRecordWord(control + GC_TRACE_CURSOR) > next);
		for (let step = 0; gc.active() && step < 20; ++step) gc.step();
		assert.equal(gc.active(), false);
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), 0);
		assert.equal(gc.tableRecordAddress(lastTarget), lastTarget);
		assert.equal(gc.tableRecordAddress(replacement), replacement);
		return memory.captureSaveState();
	};
	const expected = finish();
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	assert.deepEqual(finish(), expected, 'save and restore reproduce both marking and mutation');
});

test('primitive hash displacement withdraws a suspended Table mark cursor', () => {
	const count = 4096, occupiedTail = 1000;
	const keys = new Int32Array(count);
	let victimKey = 0;
	for (let key = -1, remaining = count; remaining !== 0 || victimKey === 0; --key) {
		const home = hashCanonicalTableKey(valueInteger(key)) & (count - 1);
		if (keys[home] === 0) { keys[home] = key; --remaining; }
		else if (home === 0 && victimKey === 0) victimKey = key;
	}
	const cpu = machine(), { gc, memory } = cpu;
	const table = cpu.createTable(0, count), victim = cpu.createTable(), tables = gc.tables;
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, table); frame.top = 1;
	tables.setInteger(table, keys[0], valueInteger(0));
	tables.setInteger(table, victimKey, valueTable(victim));
	for (let home = occupiedTail; home < count - 1; ++home) tables.setInteger(table, keys[home], valueInteger(0));
	const checkVictimAt = (node: number) => {
		let seen = false;
		tables.forEachStoredEntry(table, (key, value) => { seen = key === valueInteger(victimKey) && value === valueTable(victim); }, node, node + 1);
		assert.ok(seen);
	};
	checkVictimAt(count - 1);
	const control = cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const work = gc.step();
	assert.ok(work >= GC_STEP_WORDS && work <= GC_STEP_WORDS + 1);
	assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), table);
	assert.ok(memory.readRamRecordWord(control + GC_TRACE_CURSOR) > occupiedTail);
	assert.equal(gc.isAlive(victim), false);
	const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
	const finish = () => {
		tables.setInteger(table, keys[count - 1], valueInteger(1));
		checkVictimAt(occupiedTail - 1);
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), 0);
		for (let step = 0; gc.active() && step < 20; ++step) gc.step();
		assert.equal(gc.active(), false);
		assert.equal(gc.tableRecordAddress(victim), victim, 'the next pass follows the edge at its relocated node');
		return memory.captureSaveState();
	};
	const expected = finish();
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	assert.deepEqual(finish(), expected);
});

test('small collection skips scalar-only table writes, follows live keys and clears young weak keys', () => {
	const cpu = machine(), { gc, memory, stringPool } = cpu;
	const frame = cpu.rootThread.currentFrame!;
	const strong = cpu.createTable(4096, 4), weak = cpu.createTable(0, 4);
	const mode = cpu.createTable(0, 1), field = stringPool.intern('counter');
	const tables = gc.tables;
	tables.setStringKey(mode, stringPool.intern('__mode'), valueString(stringPool.intern('k')));
	tables.setMetatableAddress(weak, mode);
	tables.setStringKey(strong, field, valueInteger(0));
	tables.setInteger(strong, 1, valueBool(true));
	frame.registers.setTable(0, strong); frame.registers.setTable(1, weak); frame.top = 2;
	const minor = () => gc.collectYoung(valueNil(), valueNil(), valueNil());
	minor();
	assert.ok(memory.readRamRecordByte(strong + GC_COLOR_OFFSET) & GC_OLD);
	const quietWork = minor();
	for (let counter = 1; counter <= 8; ++counter) {
		tables.storeStringKeyCached(strong, field, 0, ValueTag.Integer, counter);
		tables.storeIntegerArrayKey(strong, 1, ValueTag.Float, 0x3f800000);
	}
	assert.equal(memory.readRamRecordByte(strong + GC_COLOR_OFFSET) & GC_REMEMBERED, 0);
	assert.equal(minor(), quietWork, 'an existing String key and immediate values do not add scan cycles');
	const strongKey = valueTable(cpu.createTable()), weakKey = valueTable(cpu.createTable());
	tables.set(strong, strongKey, valueInteger(12));
	tables.set(weak, weakKey, valueInteger(15));
	const newField = stringPool.intern('young-key:new-name');
	tables.setStringKey(strong, newField, valueInteger(2));
	assert.ok(memory.readRamRecordByte(strong + GC_COLOR_OFFSET) & GC_REMEMBERED);
	assert.ok(minor() >= quietWork + 8 + 4096 + 8, 'a new reference pays for the actual reserved-slot scan');
	assert.equal(gc.tableRecordAddress(valuePayload(strongKey)), valuePayload(strongKey));
	assert.equal(gc.tableRecordAddress(valuePayload(weakKey)), 0);
	assert.equal(tables.get(weak, weakKey), valueNil());
	assert.equal(stringPool.find('young-key:new-name'), newField);
	assert.equal(tables.getStringKey(strong, newField), valueInteger(2));
});

test('consuming a gray record also consumes a self-linked mark edge', () => {
	const cpu = machine(), { gc, memory } = cpu;
	const rooted = cpu.createTable();
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, rooted);
	frame.top = 1;
	const index = (rooted & (MAIN_RAM_SIZE - 1)) >>> GC_RECORD_SHIFT;
	memory.writeRamRecordByte(rooted + GC_COLOR_OFFSET, 2);
	memory.writeRamRecordWord(rooted + GC_RECORD_LINK, index);
	memory.writeRamRecordWord(gc.changedHeadOffset(), index);
	gc.step();
	assert.equal(gc.phase(), GcPhase.Atomic);
	assert.equal(memory.readRamRecordWord(rooted + GC_RECORD_LINK), 0);
	assert.equal(cpu.gc.memory.readRamRecordByte(rooted + GC_COLOR_OFFSET), 3);
	while (gc.active()) gc.step();
	assert.equal(gc.tableRecordAddress(rooted), rooted);
});

test('snapshots preserve Mark, Atomic, Sweep and String progress without tracing dead graph edges', () => {
	const cpu = machine(), roots = cpu.createTable(1024, 0);
	cpu.rootThread.currentFrame!.registers.setTable(0, roots); cpu.rootThread.currentFrame!.top = 1;
	for (let i = 1; i <= 1000; ++i) {
		cpu.gc.tables.setInteger(roots, i, valueTable(cpu.createTable(1, 1)));
		// Newer children are swept before their dead parents. Saving a sweep must
		// retain the parents' retirement bytes, not follow the retired children.
		const deadParent = cpu.createTable(1, 0);
		cpu.gc.tables.setInteger(deadParent, 1, valueTable(cpu.createTable()));
	}
	for (let i = 0; i < 4200; ++i) cpu.stringPool.intern(`dead-${i}-${'x'.repeat(16)}`);
	const phases = new Set<GcPhase>();
	let bornDuringSweep = 0;
	for (let step = 0; step < 1000; ++step) {
		cpu.gc.step();
		let state = cpu.captureRuntimeState();
		phases.add(cpu.gc.phase());
		if (cpu.gc.phase() === GcPhase.Sweep && bornDuringSweep === 0) {
			const born = cpu.createTable(); bornDuringSweep = born;
			const frame = cpu.rootThread.currentFrame!;
			frame.registers.setTable(1, born); frame.top = 2;
			state = cpu.captureRuntimeState();
		}
		const ram = cpu.memory.captureSaveState();
		cpu.memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
		assert.deepEqual(cpu.captureRuntimeState(), state, 'save/load cannot finish or restart collection');
		assert.deepEqual(cpu.memory.captureSaveState(), ram);
		if (!cpu.gc.active()) break;
	}
	assert.deepEqual(phases, new Set([GcPhase.Mark, GcPhase.Atomic, GcPhase.Sweep, GcPhase.Strings, GcPhase.Pause]));
	assert.equal(cpu.rootThread.currentFrame!.registers.getPayload(1), bornDuringSweep);
	assert.equal(cpu.stringPool.find(`dead-0-${'x'.repeat(16)}`), undefined);
	cpu.collectTrackedHeapBytes();
	assert.equal(allocatedObjectRecords(cpu).length, 1004,
		'root thread, root closure, root table, 1000 children and one sweep-born table remain');
});

test('allocation assists debit one bounded graph step and retain the pending request outside its work', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!, root = cpu.createTable(2048, 0);
	frame.registers.setTable(0, root); frame.top = 1;
	for (let i = 1; i <= 2048; ++i) cpu.gc.tables.setInteger(root, i, valueTable(cpu.createTable()));
	const before = cpu.luaHeap.usedBytes();
	cpu.luaHeap.setCollectionTarget(before);
	cpu.instructionBudgetRemaining = 1;
	const pending = cpu.createTable();
	assert.equal(cpu.gc.phase(), GcPhase.Mark);
	assert.ok(cpu.instructionBudgetRemaining < 0);
	assert.ok(cpu.instructionBudgetRemaining > -2 * GC_STEP_WORDS, 'one large root is indivisible, not the entire graph');
	assert.equal(cpu.luaHeap.usedBytes(), before + 32);
	frame.registers.setTable(1, pending); frame.top = 2;
	cpu.luaHeap.collectRuntime();
	assert.equal(frame.registers.getTag(1), ValueTag.Table);
	assert.equal(cpu.luaHeap.usedBytes(), before + 32);
});


test('final remark observes weak-to-strong changes through a shared metatable', () => {
	const cpu = machine();
	const frame = cpu.rootThread.currentFrame!;
	const roots = cpu.createTable(1024, 0);
	frame.registers.setTable(0, roots);
	frame.top = 1;
	for (let i = 1; i <= 1000; ++i) cpu.gc.tables.setInteger(roots, i, valueTable(cpu.createTable()));
	const modeKey = cpu.stringPool.intern('__mode');
	let metatable = cpu.createTable(0, 1);
	cpu.gc.tables.setStringKey(metatable, modeKey, valueString(cpu.stringPool.intern('v')));
	let weak = valuePayload(cpu.gc.tables.getInteger(roots, 1000));
	const following = valuePayload(cpu.gc.tables.getInteger(roots, 999));
	cpu.gc.tables.setMetatableAddress(weak, metatable);
	cpu.gc.tables.setMetatableAddress(following, metatable);
	const child = cpu.createTable(), childValue = valueTable(child);
	cpu.gc.tables.setInteger(weak, 1, childValue);
	cpu.gc.step();
	const { memory } = cpu, control = cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const index = (address: number) => (address & (MAIN_RAM_SIZE - 1)) >>> GC_RECORD_SHIFT;
	assert.equal(cpu.gc.phase(), GcPhase.Mark);
	assert.equal(cpu.gc.memory.readRamRecordByte(weak + GC_COLOR_OFFSET), 3);
	assert.notEqual(cpu.gc.memory.readRamRecordByte(child + GC_COLOR_OFFSET), 3, 'the weak entry has not retained its child');
	assert.equal(memory.readRamRecordWord(control + GC_WEAK_VISITS), index(weak));
	assert.equal(memory.readRamRecordWord(control + GC_WEAK_VISITS + GC_VISIT_TAIL), index(following));
	assert.equal(memory.readRamRecordWord(control + GC_WEAK_VISITS + GC_VISIT_COUNT), 2);
	assert.equal(memory.readRamRecordWord(control + GC_THREAD_VISITS), index(cpu.rootThread.address));
	assert.equal(memory.readRamRecordWord(control + GC_THREAD_VISITS + GC_VISIT_COUNT), 1);

	const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	assert.deepEqual(memory.captureSaveState().ram, ram.ram, 'restore does not reconstruct visit metadata');
	metatable = cpu.gc.tableRecordAddress(metatable)!;
	weak = cpu.gc.tableRecordAddress(weak)!;
	// Only the shared mode table is written, not the table holding the edge.
	cpu.gc.tables.setStringKey(metatable, modeKey, valueNil());
	while (cpu.gc.active()) cpu.gc.step();
	assert.equal(cpu.gc.tables.getInteger(weak, 1), childValue);
	assert.ok(cpu.gc.tableRecordAddress(child), 'the shared weak-to-strong change is still seen after restore');
	assert.equal(memory.readRamRecordWord(control + GC_WEAK_VISITS + GC_VISIT_COUNT), 0);
	assert.equal(memory.readRamRecordWord(control + GC_THREAD_VISITS + GC_VISIT_COUNT), 0);
	cpu.collectTrackedHeapBytes();
	assert.equal(cpu.gc.tables.getInteger(weak, 1), childValue);
});

test('changed objects wait for a finite second pass and retain later writes across restore', () => {
	const cpu = machine();
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, cpu.createTable(4096, 0));
	frame.registers.setTable(1, cpu.createTable()); frame.registers.setTable(2, cpu.createTable()); frame.top = 3;
	const phases = new Set<GcPhase>();
	for (let i = 0; i < 12; ++i) {
		const target = cpu.rootThread.currentFrame!.registers.getPayload(0);
		cpu.gc.tables.setInteger(target, 1, cpu.rootThread.currentFrame!.registers.get(1 + (i & 1)));
		cpu.gc.step();
		const state = cpu.captureRuntimeState(); phases.add(cpu.gc.phase());
		const ram = cpu.memory.captureSaveState();
		cpu.memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
		assert.deepEqual(cpu.captureRuntimeState(), state);
		if (cpu.gc.phase() === GcPhase.Atomic) break;
	}
	assert.ok(phases.has(GcPhase.MarkAgain));
	assert.ok(phases.has(GcPhase.Atomic), 'continuous writes cannot restart the first or second pass indefinitely');
	const target = cpu.rootThread.currentFrame!.registers.getPayload(0);
	const late = cpu.createTable(); cpu.gc.tables.setInteger(target, 2, valueTable(late));
	while (cpu.gc.active()) cpu.gc.step();
	assert.equal(cpu.gc.tables.getInteger(target, 2), valueTable(late));
	assert.ok(allocatedObjectRecords(cpu).includes(late));
});

test('a large Table scan earns one quantum of allocation credit per assist', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, cpu.createTable(8192, 0)); frame.top = 1;
	const before = cpu.luaHeap.usedBytes();
	cpu.luaHeap.setCollectionTarget(before);
	cpu.instructionBudgetRemaining = 0;
	cpu.createTable();
	const work = -cpu.instructionBudgetRemaining;
	assert.equal(work, GC_STEP_WORDS);
	assert.equal(cpu.luaHeap.collectionTarget(), before + (work >>> 4));
});

test('a rooted raw Thread frame retains its table edge and is collected without an execution view', () => {
	const cpu = machine(), { gc, memory } = cpu;
	const baselineWork = gc.collect(), baselineBytes = cpu.heapAllocator.occupiedBytes();
	const address = cpu.createThread(0);
	memory.writeRamRecordWord(address + ThreadField.Status, ThreadStatus.Suspended);
	const wide = 64, wideBytes = wide * THREAD_STACK_SLOT_BYTES;
	const block = cpu.heapAllocator.allocate(wideBytes, true);
	assert.notEqual(block, 0, 'a large unviewed stack fits the test heap');
	gc.threads.replaceStack(address, block, wide);
	memory.writeRamRecordWord(address + ThreadField.FrameDepth, 1);
	memory.writeRamRecordWord(address + ThreadField.StackTop, 1);
	const frame = memory.readRamRecordWord(address + ThreadField.FrameBlock);
	memory.writeRamRecordWord(frame + FrameField.StackCapacity, THREAD_INITIAL_VALUES);
	memory.writeRamRecordWord(frame + FrameField.Top, 1);
	const child = cpu.createTable();
	memory.writeRamRecordWord(block, child);
	memory.writeRamRecordByte(block + wide * 4, ValueTag.Table);
	const frameBytes = heapAllocationBytes(THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES);
	const bytes = THREAD_HEAP_BYTES + heapAllocationBytes(wideBytes) + frameBytes;
	assert.equal(gc.threadRecordAddress(address), address);
	assert.equal(gc.allocationBytes(address), bytes);
	assert.equal(cpu.heapAllocator.occupiedBytes(), baselineBytes + bytes + TableRecords.HEADER_BYTES);
	const liveWork = gc.collect(valueThread(address), valueNil(), valueNil(), address);
	assert.equal(liveWork, baselineWork + 4 * (bytes >>> 2) + (TableRecords.HEADER_BYTES >>> 2) + 1,
		'three raw Thread traces and its sweep charge the physical allocation, plus one table trace and visit');
	assert.equal(gc.threadRecordAddress(address), address);
	assert.equal(gc.tableRecordAddress(child), child);
	assert.equal(memory.readRamRecordWord(block), child);
	assert.equal(gc.collect(valueThread(address), valueNil(), valueNil(), address), liveWork,
		'repeated collection follows the RAM frame and charges no host attachment work');
	const shrinkWork = gc.collect(valueThread(address));
	const reduced = memory.readRamRecordWord(address + ThreadField.StackCapacity);
	const reducedBlock = memory.readRamRecordWord(address + ThreadField.StackBlock);
	assert.equal(reduced, wide / 2);
	assert.notEqual(reducedBlock, block);
	assert.equal(memory.readRamRecordWord(reducedBlock), child);
	assert.equal(memory.readRamRecordByte(reducedBlock + reduced * 4), ValueTag.Table);
	assert.equal(memory.readRamRecordWord(address + ThreadField.FrameBlock), frame, 'shrinking values leaves the frame allocation in place');
	assert.equal(memory.readRamRecordWord(frame + FrameField.Top), 1);
	const reducedBytes = reduced * THREAD_STACK_SLOT_BYTES;
	const allocationBytes = THREAD_HEAP_BYTES + heapAllocationBytes(reducedBytes) + frameBytes;
	assert.equal(shrinkWork, liveWork + 2 * (reducedBytes >>> 2));
	assert.equal(cpu.heapAllocator.occupiedBytes(), baselineBytes + allocationBytes + TableRecords.HEADER_BYTES);
	let deadWork = 0;
	while (gc.phase() !== GcPhase.Sweep) deadWork += gc.step();
	const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	assert.equal(cpu.rootThread.address, state.rootThreadAddress, 'restore rebinds the root while the pending victim remains a raw record');
	assert.equal(gc.threadRecordAddress(address), address, 'the allocator still owns it until sweep');
	while (gc.active()) deadWork += gc.step();
	assert.equal(deadWork, baselineWork + (allocationBytes >>> 2) + 1,
		'removing the raw Thread root leaves only its physical sweep and the table visit');
	assert.equal(gc.threadRecordAddress(address), 0);
	assert.equal(gc.tableRecordAddress(child), 0);
	assert.equal(memory.readRamRecordByte(address), 0);
	assert.equal(cpu.heapAllocator.occupiedBytes(), baselineBytes);
});

test('a coroutine header is swept with the object page and its stack is released with it', () => {
	const text = new Uint8Array(6 * 4);
	writeInstruction(text, 0, OpCode.GETSYS, 0, 0, 0);
	writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 2, OpCode.CLOSURE, 1, 0, 0);
	writeInstruction(text, 3, OpCode.CALL, 0, 2, 2);
	writeInstruction(text, 4, OpCode.HALT, 0, 0, 0);
	writeInstruction(text, 5, OpCode.RET, 0, 1, 0);
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32({
		text, systemGlobalNames: ['create'],
		functions: [{ firstWord: 0, wordCount: 5, maxStack: 8 }, { firstWord: 5, wordCount: 1, maxStack: 2 }],
		closureRelocations: [{ wordIndex: 2, functionAddress: blua32TestFunctionAddress(SYSTEM_ROM_BASE, 1) }],
	}));
	cpu.setSystemGlobalByKey(cpu.stringPool.intern('create'), valueBuiltinFunction(BuiltinFunctionId.CoroutineCreate));
	cpu.runUntilDepth(0, 1000);
	const { gc } = cpu, frame = cpu.rootThread.currentFrame!;
	const address = valuePayload(frame.registers.get(0));
	const bytes = gc.allocationBytes(address);
	frame.registers.setClosure(1, cpu.memory.readRamRecordWord(address + ThreadField.Entry));
	frame.top = 2;
	const sweep = () => {
		while (gc.phase() !== GcPhase.Sweep) gc.step();
		let work = 0;
		while (gc.active()) work += gc.step();
		return work;
	};
	const liveWork = sweep(), occupied = cpu.heapAllocator.occupiedBytes();
	assert.equal(gc.threadRecordAddress(address), address);
	frame.registers.setNil(0);
	assert.equal(sweep(), liveWork, 'an occupied Thread slot has the same visit charge whether retained or released');
	assert.equal(gc.threadRecordAddress(address), 0);
	assert.equal(cpu.memory.readRamRecordByte(address), 0);
	assert.equal(cpu.heapAllocator.occupiedBytes(), occupied - bytes);
	assert.equal(sweep(), liveWork - ((bytes >>> 2) - 1), 'the root Thread keeps the page, and the vacant slot still costs a visit');
});

test('sweep shrinks cold stacks with hysteresis, preserves caller windows and rebinds views', () => {
	const cpu = machine(), thread = cpu.rootThread, frame = thread.currentFrame!;
	thread.resizeStack(1024);
	frame.registers.setInteger(0, 123); frame.top = 1;
	const values = thread.stackRegisters.ramOffset();
	do { cpu.gc.step(); } while (cpu.gc.active());
	assert.equal(thread.stackRegisters.capacity(), 1024);
	assert.equal(thread.stackRegisters.ramOffset(), values, 'incremental collection keeps surviving storage in place');
	const before = cpu.luaHeap.usedBytes();
	cpu.collectTrackedHeapBytes();
	assert.equal(thread.stackRegisters.capacity(), 512);
	assert.equal(cpu.luaHeap.usedBytes(), before - HEAP_PAGE_SIZE);
	frame.registers.setInteger(0, 456);
	assert.equal(thread.stackRegisters.getInteger(frame.stackBase), 456);
	const parentCapacity = frame.stackCapacity;
	frame.growRegisterWindow(200);
	thread.reserveFrame(thread.stackRegisters.capacity());
	const child = thread.acquireFrame();
	child.controlMemory.writeRamRecordPair(child.controlOffset + FrameField.StackBase, 2, 8);
	child.top = 0;
	child.closureAddress = frame.closureAddress; child.executionImage = frame.executionImage;
	child.registers.rebind(thread.stackRegisters, 2, 8);
	thread.enterFrame(child); thread.stackTop = 10;
	cpu.collectTrackedHeapBytes();
	assert.equal(thread.stackRegisters.capacity(), 512, 'the overlapping caller window, not just current stackTop, prevents shrinking');
	thread.leaveFrame();
	frame.controlMemory.writeRamRecordWord(frame.controlOffset + FrameField.StackCapacity, parentCapacity);
	const grown = 2048;
	cpu.luaHeap.setCollectionTarget(0);
	cpu.luaHeap.collectRuntime(valueNil(), valueNil(), valueNil(), thread.address);
	assert.equal(thread.stackRegisters.capacity(), 512, 'growth admission keeps its old allocation size stable');
	thread.resizeStack(grown);
	assert.equal(frame.registers.getInteger(0), 456);
	const state = cpu.captureRuntimeState(); cpu.restoreRuntimeState(state);
	assert.deepEqual(cpu.captureRuntimeState(), state);
});


test('short-lived allocations above two MiB retained are served by young collections', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!;
	const retained = cpu.createTable(419430, 0);
	frame.registers.setTable(0, retained); frame.top = 1;
	cpu.collectTrackedHeapBytes();
	const diagnostics = cpu.gc.diagnostics = new GcDiagnostics();
	for (let i = 0; i < 4000; ++i) cpu.createTable(8, 0);
	assert.ok(diagnostics.minorCollections >= 2, 'repeated allocation bursts collect the young generation');
	assert.equal(diagnostics.steps, diagnostics.minorCollections, 'no major step retraces the retained heap');
	assert.equal(diagnostics.fullCollections, 0);
	assert.ok(cpu.luaHeap.usedBytes() <= cpu.luaHeap.capacity());
	assert.equal(frame.registers.getPayload(0), retained);
});

test('TS phase diagnostics include atomic pauses and survive restore without changing guest work', () => {
	const plain = machine(), measured = machine();
	let clock = 0;
	const diagnostics = measured.gc.diagnostics = new GcDiagnostics(() => clock += 1_000_000);
	const plainWork = plain.collectTrackedHeapBytes();
	const measuredWork = measured.collectTrackedHeapBytes();
	assert.equal(measuredWork, plainWork);
	assert.deepEqual(measured.captureRuntimeState(), plain.captureRuntimeState());
	assert.equal(diagnostics.collections, 1); assert.equal(diagnostics.fullCollections, 1);
	assert.ok(diagnostics.steps >= 3 && diagnostics.markAgainNanoseconds > 0 && diagnostics.atomicNanoseconds > 0);
	assert.ok(diagnostics.maxStepNanoseconds > 2e6 && diagnostics.stepsOver2ms > 0);
	assert.ok(diagnostics.rootsNanoseconds + diagnostics.traceNanoseconds + diagnostics.markAgainNanoseconds
		+ diagnostics.weakNanoseconds + diagnostics.sweepNanoseconds + diagnostics.stringReclaimNanoseconds <= diagnostics.totalNanoseconds);
	const elapsed = diagnostics.totalNanoseconds;
	const state = measured.captureRuntimeState(); measured.restoreRuntimeState(state);
	assert.equal(diagnostics.totalNanoseconds, elapsed);
});
