import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GcPhase, GC_STEP_WORDS } from '../../machine/ts/machine/cpu/gc_heap';
import { ValueTag, valueString } from '../../machine/ts/machine/cpu/value';
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
	frame.registers.setTable(0, roots); frame.top = 1;
	for (let i = 1; i <= 1000; ++i) {
		const item = cpu.createTable(1, 1);
		item.setStringKey(field, false); roots.setInteger(i, item);
	}
	const target = roots.getInteger(1000) as typeof roots;
	const firstWork = cpu.gc.step();
	assert.ok(firstWork >= GC_STEP_WORDS);
	assert.equal(cpu.captureRuntimeState().gc.phase, GcPhase.Mark);
	assert.equal(target.gcColor, 3, 'the mutation really targets an already traced allocation');
	const arrayChild = cpu.createTable(), fieldChild = cpu.createTable(), metatable = cpu.createTable();
	target.setInteger(1, arrayChild);
	target.setStringKey(field, fieldChild);
	target.metatable = metatable;
	assert.equal(cpu.gc.captureState(object => object.hashId).gray.filter(id => id === target.hashId).length, 1,
		'repeated stores requeue a traced table once, without growing a barrier worklist');
	const rootChild = cpu.createTable();
	frame.registers.setTable(1, rootChild); frame.top = 2;
	const expectedIds = [arrayChild.hashId, fieldChild.hashId, metatable.hashId, rootChild.hashId];
	let steps = 0;
	while (cpu.gc.active() && steps++ < 1000) cpu.gc.step();
	assert.ok(!cpu.gc.active()); assert.ok(steps > 2, 'the graph was not collected in one call');
	const state = cpu.captureRuntimeState();
	for (const id of expectedIds) assert.ok(cpu.gc.captureState(object => object.hashId).allocations.includes(id));
	assert.equal(target.getInteger(1), arrayChild); assert.equal(target.getStringKey(field), fieldChild);
	assert.equal(target.metatable, metatable); assert.equal(frame.registers.getTable(1), rootChild);
	assert.equal(state.luaHeap.trackedBytes, cpu.luaHeap.usedBytes());
	frame.registers.clear(frame.stackCapacity); frame.top = 0;
	cpu.collectTrackedHeapBytes();
	for (const id of expectedIds) assert.ok(!cpu.gc.captureState(object => object.hashId).allocations.includes(id));
});

test('snapshots preserve Mark, Sweep and String progress without tracing dead graph edges', () => {
	const cpu = machine(), roots = cpu.createTable(1024, 0);
	cpu.rootThread.currentFrame!.registers.setTable(0, roots); cpu.rootThread.currentFrame!.top = 1;
	for (let i = 1; i <= 1000; ++i) {
		roots.setInteger(i, cpu.createTable(1, 1));
		// Newer children are swept before their dead parents. Saving a sweep must
		// retain the parents' retirement bytes, not follow the retired children.
		const deadParent = cpu.createTable(1, 0);
		deadParent.setInteger(1, cpu.createTable());
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
			frame.registers.setTable(1, born); frame.top = 2;
			state = cpu.captureRuntimeState();
		}
		const strings = cpu.stringPool.captureState();
		cpu.stringPool.restoreState(strings); cpu.restoreRuntimeState(state);
		assert.deepEqual(cpu.captureRuntimeState(), state, 'save/load cannot finish or restart collection');
		assert.deepEqual(cpu.stringPool.captureState(), strings);
		if (!cpu.gc.active()) break;
	}
	assert.deepEqual(phases, new Set([GcPhase.Mark, GcPhase.Sweep, GcPhase.Strings, GcPhase.Pause]));
	assert.equal(cpu.rootThread.currentFrame!.registers.getTable(1).hashId, bornDuringSweep);
	assert.equal(cpu.stringPool.find(`dead-0-${'x'.repeat(256)}`), undefined);
	cpu.collectTrackedHeapBytes();
	assert.equal(cpu.gc.captureState(object => object.hashId).allocations.length, 1004,
		'root thread, root closure, root table, 1000 children and one sweep-born table remain');
});

test('allocation assists debit one bounded graph step and retain the pending request outside its work', () => {
	const cpu = machine(), frame = cpu.rootThread.currentFrame!, root = cpu.createTable(2048, 0);
	frame.registers.setTable(0, root); frame.top = 1;
	for (let i = 1; i <= 2048; ++i) root.setInteger(i, cpu.createTable());
	const before = cpu.luaHeap.usedBytes();
	cpu.luaHeap.restoreState({ trackedBytes: before, nextCollectionBytes: before });
	cpu.instructionBudgetRemaining = 1;
	const pending = cpu.createTable();
	assert.equal(cpu.captureRuntimeState().gc.phase, GcPhase.Mark);
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
	for (let i = 1; i <= 1000; ++i) roots.setInteger(i, cpu.createTable());
	const modeKey = cpu.stringPool.intern('__mode');
	const metatable = cpu.createTable(0, 1);
	metatable.setStringKey(modeKey, valueString(cpu.stringPool.intern('v')));
	const weak = roots.getInteger(1000) as typeof roots;
	weak.metatable = metatable;
	const child = cpu.createTable();
	weak.setInteger(1, child);
	cpu.gc.step();
	assert.equal(cpu.captureRuntimeState().gc.phase, GcPhase.Mark);
	assert.equal(weak.gcColor, 3);
	assert.equal(weak.gcWeakListed, true);
	assert.notEqual(child.gcColor, 3, 'the weak entry has not retained its child');
	// Only the shared mode table is written, not the table holding the edge.
	metatable.setStringKey(modeKey, null);
	while (cpu.gc.active()) cpu.gc.step();
	assert.equal(weak.getInteger(1), child);
	assert.ok(cpu.gc.captureState(object => object.hashId).allocations.includes(child.hashId));
	cpu.collectTrackedHeapBytes();
	assert.equal(weak.getInteger(1), child);
});
