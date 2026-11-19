import { allocatedObjectRecords } from '../helpers/cpu_execution';
import { FrameField } from '../../machine/ts/machine/cpu/call_state';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { HEAP_PAGE_SIZE, MAIN_RAM_SIZE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GcDiagnostics } from '../../machine/ts/machine/cpu/gc_diagnostics';
import { GC_COLOR_OFFSET, GC_RECORD_LINK, GC_RECORD_SHIFT } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { GcPhase, GC_STEP_WORDS, GC_THREAD_VISITS, GC_VISIT_COUNT, GC_VISIT_TAIL, GC_WEAK_VISITS } from '../../machine/ts/machine/cpu/gc_heap';
import { ValueTag, valueBuiltinFunction, valuePayload, valueBool, valueInteger, valueNil, valueTable, valueString } from '../../machine/ts/machine/cpu/value';
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
	frame.registers.setTable(0, cpu.createTable(4096, 0)); frame.top = 1;
	const phases = new Set<GcPhase>();
	for (let i = 0; i < 12; ++i) {
		const target = cpu.rootThread.currentFrame!.registers.getPayload(0);
		cpu.gc.tables.setInteger(target, 1, valueInteger(i));
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

test('an oversized scan earns actual-work credit, not another assist after 256 bytes', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, cpu.createTable(8192, 0)); frame.top = 1;
	const before = cpu.luaHeap.usedBytes();
	cpu.luaHeap.setCollectionTarget(before);
	cpu.instructionBudgetRemaining = 0;
	cpu.createTable();
	const work = -cpu.instructionBudgetRemaining;
	assert.ok(work > GC_STEP_WORDS);
	assert.equal(cpu.luaHeap.collectionTarget(), before + (work >>> 4));
	assert.ok(cpu.luaHeap.collectionTarget() > cpu.luaHeap.usedBytes() + 256);
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
	const address = valuePayload(frame.registers.get(0)), thread = gc.threadAt(address)!;
	const bytes = gc.allocationBytes(thread);
	frame.registers.setClosure(1, thread.entry!.address);
	frame.top = 2;
	const sweep = () => {
		while (gc.phase() !== GcPhase.Sweep) gc.step();
		let work = 0;
		while (gc.active()) work += gc.step();
		return work;
	};
	const liveWork = sweep(), occupied = cpu.heapAllocator.occupiedBytes();
	assert.equal(gc.threadAt(address), thread);
	frame.registers.setNil(0);
	assert.equal(sweep(), liveWork, 'an occupied Thread slot has the same visit charge whether retained or released');
	assert.equal(gc.threadAt(address), null);
	assert.equal(cpu.memory.readRamRecordByte(address), 0);
	assert.equal(cpu.heapAllocator.occupiedBytes(), occupied - bytes);
	assert.equal(sweep(), liveWork - ((bytes >>> 2) - 1), 'the root Thread keeps the page, and the vacant slot still costs a visit');
});

test('sweep shrinks cold stacks with hysteresis, preserves caller windows and rebinds views', () => {
	const cpu = machine(), thread = cpu.rootThread, frame = thread.currentFrame!;
	thread.resizeStack(1024);
	frame.registers.setInteger(0, 123); frame.top = 1;
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
	cpu.luaHeap.collectRuntime(valueNil(), valueNil(), valueNil(), thread);
	assert.equal(thread.stackRegisters.capacity(), 512, 'growth admission keeps its old allocation size stable');
	thread.resizeStack(grown);
	assert.equal(frame.registers.getInteger(0), 456);
	const state = cpu.captureRuntimeState(); cpu.restoreRuntimeState(state);
	assert.deepEqual(cpu.captureRuntimeState(), state);
});


test('high retained usage advances automatically without emergency full collections', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!;
	const retained = cpu.createTable(419430, 0);
	frame.registers.setTable(0, retained); frame.top = 1;
	cpu.collectTrackedHeapBytes();
	const diagnostics = cpu.gc.diagnostics = new GcDiagnostics();
	for (let i = 0; i < 24000; ++i) cpu.createTable(8, 0);
	assert.equal(diagnostics.fullCollections, 0);
	assert.ok(diagnostics.collections > 0 && diagnostics.steps > diagnostics.collections);
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
