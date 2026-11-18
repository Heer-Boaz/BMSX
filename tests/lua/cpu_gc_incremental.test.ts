import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GcDiagnostics } from '../../machine/ts/machine/cpu/gc_diagnostics';
import { GcPhase, GC_STEP_WORDS } from '../../machine/ts/machine/cpu/gc_heap';
import { ValueTag, asTable, valueBool, valueInteger, valueNil, valueTable, valueString } from '../../machine/ts/machine/cpu/value';
import { writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

function machine() {
	const text = new Uint8Array(4);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	return createTestSystemCpu(linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 8 }] })).cpu;
}

test('incremental marking preserves changed table edges, metatables and final register roots', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!;
	const roots = cpu.createTable(1024, 0), field = cpu.stringPool.intern('child');
	frame.registers.setTable(0, cpu.gc.reference(roots)); frame.top = 1;
	for (let i = 1; i <= 1000; ++i) {
		const item = cpu.createTable(1, 1);
		item.setStringKey(field, valueBool(false)); roots.setInteger(i, valueTable(cpu.gc.reference(item)));
	}
	const target = asTable(roots.getInteger(1000), cpu.gc);
	const firstWork = cpu.gc.step();
	assert.ok(firstWork >= GC_STEP_WORDS);
	assert.equal(cpu.captureRuntimeState().gc.phase, GcPhase.Mark);
	assert.equal(target.gcColor, 3, 'the mutation really targets an already traced allocation');
	const arrayChild = cpu.createTable(), fieldChild = cpu.createTable(), metatable = cpu.createTable();
	target.setInteger(1, valueTable(cpu.gc.reference(arrayChild)));
	target.setStringKey(field, valueTable(cpu.gc.reference(fieldChild)));
	target.metatable = metatable;
	assert.equal(cpu.gc.captureState(object => object.hashId).grayAgain.filter(id => id === target.hashId).length, 1,
		'repeated stores requeue a traced table once, without growing a barrier worklist');
	const rootChild = cpu.createTable();
	frame.registers.setTable(1, cpu.gc.reference(rootChild)); frame.top = 2;
	const expectedIds = [arrayChild.hashId, fieldChild.hashId, metatable.hashId, rootChild.hashId];
	let steps = 0;
	while (cpu.gc.active() && steps++ < 1000) cpu.gc.step();
	assert.ok(!cpu.gc.active()); assert.ok(steps > 2, 'the graph was not collected in one call');
	const state = cpu.captureRuntimeState();
	for (const id of expectedIds) assert.ok(cpu.gc.captureState(object => object.hashId).allocations.includes(id));
	assert.equal(target.getInteger(1), valueTable(cpu.gc.reference(arrayChild))); assert.equal(target.getStringKey(field), valueTable(cpu.gc.reference(fieldChild)));
	assert.equal(target.metatable, metatable); assert.equal(frame.registers.getTable(1, cpu.gc), rootChild);
	assert.equal(state.luaHeap.trackedBytes, cpu.luaHeap.usedBytes());
	frame.registers.clear(frame.stackCapacity); frame.top = 0;
	cpu.collectTrackedHeapBytes();
	for (const id of expectedIds) assert.ok(!cpu.gc.captureState(object => object.hashId).allocations.includes(id));
});

test('snapshots preserve Mark, Atomic, Sweep and String progress without tracing dead graph edges', () => {
	const cpu = machine(), roots = cpu.createTable(1024, 0);
	cpu.rootThread.currentFrame!.registers.setTable(0, cpu.gc.reference(roots)); cpu.rootThread.currentFrame!.top = 1;
	for (let i = 1; i <= 1000; ++i) {
		roots.setInteger(i, valueTable(cpu.gc.reference(cpu.createTable(1, 1))));
		// Newer children are swept before their dead parents. Saving a sweep must
		// retain the parents' retirement bytes, not follow the retired children.
		const deadParent = cpu.createTable(1, 0);
		deadParent.setInteger(1, valueTable(cpu.gc.reference(cpu.createTable())));
	}
	for (let i = 0; i < 320; ++i) cpu.stringPool.intern(`dead-${i}-${'x'.repeat(256)}`);
	const phases = new Set<GcPhase>();
	let bornDuringSweep = 0;
	for (let step = 0; step < 1000; ++step) {
		cpu.gc.step();
		let state = cpu.captureRuntimeState();
		phases.add(state.gc.phase);
		if (state.gc.phase === GcPhase.Sweep && bornDuringSweep === 0) {
			const born = cpu.createTable(); bornDuringSweep = born.hashId;
			const frame = cpu.rootThread.currentFrame!;
			frame.registers.setTable(1, cpu.gc.reference(born)); frame.top = 2;
			state = cpu.captureRuntimeState();
		}
		const strings = cpu.stringPool.captureState();
		cpu.stringPool.restoreState(strings); cpu.restoreRuntimeState(state);
		assert.deepEqual(cpu.captureRuntimeState(), state, 'save/load cannot finish or restart collection');
		assert.deepEqual(cpu.stringPool.captureState(), strings);
		if (!cpu.gc.active()) break;
	}
	assert.deepEqual(phases, new Set([GcPhase.Mark, GcPhase.Atomic, GcPhase.Sweep, GcPhase.Strings, GcPhase.Pause]));
	assert.equal(cpu.rootThread.currentFrame!.registers.getTable(1, cpu.gc).hashId, bornDuringSweep);
	assert.equal(cpu.stringPool.find(`dead-0-${'x'.repeat(256)}`), undefined);
	cpu.collectTrackedHeapBytes();
	assert.equal(cpu.gc.captureState(object => object.hashId).allocations.length, 1004,
		'root thread, root closure, root table, 1000 children and one sweep-born table remain');
});

test('allocation assists debit one bounded graph step and retain the pending request outside its work', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!, root = cpu.createTable(2048, 0);
	frame.registers.setTable(0, cpu.gc.reference(root)); frame.top = 1;
	for (let i = 1; i <= 2048; ++i) root.setInteger(i, valueTable(cpu.gc.reference(cpu.createTable())));
	const before = cpu.luaHeap.usedBytes();
	cpu.luaHeap.restoreState({ trackedBytes: before, nextCollectionBytes: before });
	cpu.instructionBudgetRemaining = 1;
	const pending = cpu.createTable();
	assert.equal(cpu.captureRuntimeState().gc.phase, GcPhase.Mark);
	assert.ok(cpu.instructionBudgetRemaining < 0);
	assert.ok(cpu.instructionBudgetRemaining > -2 * GC_STEP_WORDS, 'one large root is indivisible, not the entire graph');
	assert.equal(cpu.luaHeap.usedBytes(), before + 32);
	frame.registers.setTable(1, cpu.gc.reference(pending)); frame.top = 2;
	cpu.luaHeap.collectRuntime();
	assert.equal(frame.registers.getTag(1), ValueTag.Table);
	assert.equal(cpu.luaHeap.usedBytes(), before + 32);
});


test('final remark observes weak-to-strong changes through a shared metatable', () => {
	const cpu = machine();
	const frame = cpu.rootThread.currentFrame!;
	const roots = cpu.createTable(1024, 0);
	frame.registers.setTable(0, cpu.gc.reference(roots));
	frame.top = 1;
	for (let i = 1; i <= 1000; ++i) roots.setInteger(i, valueTable(cpu.gc.reference(cpu.createTable())));
	const modeKey = cpu.stringPool.intern('__mode');
	const metatable = cpu.createTable(0, 1);
	metatable.setStringKey(modeKey, valueString(cpu.stringPool.intern('v')));
	const weak = asTable(roots.getInteger(1000), cpu.gc);
	weak.metatable = metatable;
	const child = cpu.createTable();
	weak.setInteger(1, valueTable(cpu.gc.reference(child)));
	cpu.gc.step();
	assert.equal(cpu.captureRuntimeState().gc.phase, GcPhase.Mark);
	assert.equal(weak.gcColor, 3);
	assert.equal(weak.gcWeakListed, true);
	assert.notEqual(child.gcColor, 3, 'the weak entry has not retained its child');
	// Only the shared mode table is written, not the table holding the edge.
	metatable.setStringKey(modeKey, valueNil());
	while (cpu.gc.active()) cpu.gc.step();
	assert.equal(weak.getInteger(1), valueTable(cpu.gc.reference(child)));
	assert.ok(cpu.gc.captureState(object => object.hashId).allocations.includes(child.hashId));
	cpu.collectTrackedHeapBytes();
	assert.equal(weak.getInteger(1), valueTable(cpu.gc.reference(child)));
});

test('changed objects wait for a finite second pass and retain later writes across restore', () => {
	const cpu = machine();
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, cpu.gc.reference(cpu.createTable(4096, 0))); frame.top = 1;
	const phases = new Set<GcPhase>();
	for (let i = 0; i < 12; ++i) {
		const target = cpu.rootThread.currentFrame!.registers.getTable(0, cpu.gc);
		target.setInteger(1, valueInteger(i));
		cpu.gc.step();
		const state = cpu.captureRuntimeState(); phases.add(state.gc.phase);
		const strings = cpu.stringPool.captureState();
		cpu.stringPool.restoreState(strings); cpu.restoreRuntimeState(state);
		assert.deepEqual(cpu.captureRuntimeState(), state);
		if (state.gc.phase === GcPhase.Atomic) break;
	}
	assert.ok(phases.has(GcPhase.MarkAgain));
	assert.ok(phases.has(GcPhase.Atomic), 'continuous writes cannot restart the first or second pass indefinitely');
	const target = cpu.rootThread.currentFrame!.registers.getTable(0, cpu.gc);
	const late = cpu.createTable(); target.setInteger(2, valueTable(cpu.gc.reference(late)));
	while (cpu.gc.active()) cpu.gc.step();
	assert.equal(target.getInteger(2), valueTable(cpu.gc.reference(late)));
	assert.ok(cpu.gc.captureState(object => object.hashId).allocations.includes(late.hashId));
});

test('an oversized scan earns actual-work credit, not another assist after 256 bytes', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, cpu.gc.reference(cpu.createTable(4096, 0))); frame.top = 1;
	const before = cpu.luaHeap.usedBytes();
	cpu.luaHeap.restoreState({ trackedBytes: before, nextCollectionBytes: before });
	cpu.instructionBudgetRemaining = 0;
	cpu.createTable();
	const work = -cpu.instructionBudgetRemaining;
	assert.ok(work > GC_STEP_WORDS);
	assert.equal(cpu.luaHeap.captureState().nextCollectionBytes, before + (work >>> 4));
	assert.ok(cpu.luaHeap.captureState().nextCollectionBytes > cpu.luaHeap.usedBytes() + 256);
});

test('sweep shrinks cold stacks with hysteresis, preserves caller windows and rebinds views', () => {
	const cpu = machine(), thread = cpu.rootThread, frame = thread.currentFrame!;
	cpu.luaHeap.reserve((1024 - thread.stackRegisters.capacity()) * 5);
	thread.resizeStack(1024);
	frame.registers.setInteger(0, 123); frame.top = 1;
	const before = cpu.luaHeap.usedBytes();
	cpu.collectTrackedHeapBytes();
	assert.equal(thread.stackRegisters.capacity(), 512);
	assert.equal(cpu.luaHeap.usedBytes(), before - 512 * 5);
	frame.registers.setInteger(0, 456);
	assert.equal(thread.stackRegisters.getInteger(frame.stackBase), 456);
	const parentCapacity = frame.stackCapacity;
	frame.stackCapacity = 200;
	frame.registers.rebind(thread.stackRegisters, frame.stackBase, frame.stackCapacity);
	const child = thread.acquireFrame();
	child.stackBase = 2; child.stackCapacity = 8; child.top = 0;
	child.closure = frame.closure; child.executionImage = frame.executionImage;
	child.registers.rebind(thread.stackRegisters, 2, 8);
	thread.enterFrame(child); thread.stackTop = 10;
	cpu.collectTrackedHeapBytes();
	assert.equal(thread.stackRegisters.capacity(), 512, 'the overlapping caller window, not just current stackTop, prevents shrinking');
	thread.leaveFrame(); frame.stackCapacity = parentCapacity; thread.stackTop = parentCapacity;
	frame.registers.rebind(thread.stackRegisters, frame.stackBase, parentCapacity);
	const grown = 2048;
	cpu.luaHeap.restoreState({ trackedBytes: cpu.luaHeap.usedBytes(), nextCollectionBytes: 0 });
	cpu.luaHeap.collectRuntime(valueNil(), valueNil(), valueNil(), thread);
	assert.equal(thread.stackRegisters.capacity(), 512, 'growth admission keeps its old allocation size stable');
	cpu.luaHeap.reserve((grown - 512) * 5, valueNil(), valueNil(), valueNil(), thread);
	thread.resizeStack(grown);
	assert.equal(frame.registers.getInteger(0), 456);
	const state = cpu.captureRuntimeState(); cpu.restoreRuntimeState(state);
	assert.deepEqual(cpu.captureRuntimeState(), state);
});


test('high retained usage advances automatically without emergency full collections', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!;
	const retained = cpu.createTable(419430, 0);
	frame.registers.setTable(0, cpu.gc.reference(retained)); frame.top = 1;
	cpu.collectTrackedHeapBytes();
	const diagnostics = cpu.gc.diagnostics = new GcDiagnostics();
	for (let i = 0; i < 24000; ++i) cpu.createTable(8, 0);
	assert.equal(diagnostics.fullCollections, 0);
	assert.ok(diagnostics.collections > 0 && diagnostics.steps > diagnostics.collections);
	assert.ok(cpu.luaHeap.usedBytes() <= cpu.luaHeap.capacity());
	assert.equal(frame.registers.getTable(0, cpu.gc), retained);
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
