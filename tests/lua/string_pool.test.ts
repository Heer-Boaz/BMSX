import assert from 'node:assert/strict';
import test from 'node:test';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { ValueTag, valueString } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';

function createCpu(): CPU {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: [null, null] }, PSX_MACHINE_SPEC.ramBytes);
	return new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
}

test('collection removes unreachable text from the intern index and snapshots without accumulating IDs', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	const baselineBytes = cpu.collectTrackedHeapBytes(), baseline = pool.captureState();
	const suffix = 'x'.repeat(512);
	for (let round = 0; round < 8; round += 1) {
		for (let index = 0; index < 128; index += 1) pool.intern(`garbage-${round}-${index}-${suffix}`);
		assert.equal(cpu.collectTrackedHeapBytes(), baselineBytes);
		assert.equal(pool.find(`garbage-${round}-0-${suffix}`), undefined);
		assert.deepEqual(pool.captureState(), baseline,
			'actual text and snapshot storage return to the permanent CPU roots, not just the RAM counter');
	}
});

test('untracked literals and empty strings are collectible; recycled slots publish new Unicode metadata', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	const baselineTracked = pool.trackedLuaHeapBytes();
	const old = pool.intern('retired literal', false);
	pool.intern('');
	cpu.collectTrackedHeapBytes();
	assert.equal(pool.find('retired literal'), undefined);
	assert.equal(pool.find(''), undefined);
	const replacement = pool.intern('β😀');
	assert.equal(replacement, old);
	assert.equal(pool.toString(replacement), 'β😀');
	assert.equal(pool.codepointCount(replacement), 2);
	assert.equal(pool.trackedLuaHeapBytes(), baselineTracked + 6);
});

test('promoting an existing untracked entry roots it across reservation-triggered collection', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	const text = 'an existing untracked entry';
	const id = pool.intern(text, false);
	const heap = cpu.luaHeap.captureState();
	cpu.luaHeap.restoreState({ trackedBytes: heap.trackedBytes, nextCollectionBytes: 0 });
	assert.equal(pool.intern(text), id);
	assert.equal(pool.find(text), id);
	assert.equal(pool.toString(id), text);
	assert.equal(pool.captureState().entries.find(entry => entry.id === id)!.tracked, true);
	cpu.collectTrackedHeapBytes();
	assert.equal(pool.find(text), undefined, 'the reservation root ends with intern, not with the whole runtime');
});

test('nested materialization scopes retain newly returned IDs only through their owning phase', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	pool.beginLocalRoots();
	const outer = pool.intern('outer string');
	pool.beginLocalRoots();
	const inner = pool.intern('inner string', false);
	cpu.collectTrackedHeapBytes();
	assert.equal(pool.toString(outer), 'outer string');
	assert.equal(pool.toString(inner), 'inner string');
	pool.endLocalRoots();
	cpu.collectTrackedHeapBytes();
	assert.equal(pool.find('inner string'), undefined);
	assert.equal(pool.find('outer string'), outer);
	pool.endLocalRoots();
	cpu.collectTrackedHeapBytes();
	assert.equal(pool.find('outer string'), undefined);
});

test('sparse snapshots reproduce the canonical free-ID order after partial reuse', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	pool.beginLocalRoots();
	pool.intern('left anchor');
	pool.beginLocalRoots();
	const holes = [pool.intern('hole one'), pool.intern('hole two'), pool.intern('hole three')];
	pool.endLocalRoots();
	const right = pool.intern('right anchor');
	cpu.collectTrackedHeapBytes();
	assert.equal(pool.intern('partially reused'), holes[2]);
	pool.endLocalRoots();
	const snapshot = pool.captureState();
	const future = [pool.intern('future one'), pool.intern('future two'), pool.intern('future three')];
	assert.deepEqual(future, [holes[1], holes[0], right + 1]);
	const expected = pool.captureState();
	pool.restoreState(snapshot);
	assert.deepEqual([pool.intern('future one'), pool.intern('future two'), pool.intern('future three')], future);
	assert.deepEqual(pool.captureState(), expected);
});

test('reusing an unreachable deleted string-key ID cannot resurrect its old mapping', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	const root = pool.intern('table root', false), table = cpu.createTable(0, 8);
	cpu.setGlobalByKey(root, ValueTag.Table, NaN, table);
	const removed = pool.intern('removed key');
	table.setStringKey(removed, 19);
	table.setStringKey(removed, null);
	const retained = pool.intern('retained key');
	table.setStringKey(retained, 23);
	cpu.collectTrackedHeapBytes();
	assert.equal(pool.find('removed key'), undefined);
	const replacement = pool.intern('replacement key');
	assert.equal(replacement, removed);
	assert.equal(table.getStringKey(replacement), null);
	table.setStringKey(replacement, 29);
	assert.equal(table.get(valueString(replacement)), 29);
	assert.equal(table.getStringKey(retained), 23);
	const entry = new ValueSlots(2), keys: string[] = [];
	let keyTag: ValueTag = ValueTag.Nil, keyScalar = NaN;
	while (table.next(keyTag, keyScalar, null, entry, 0)) {
		assert.equal(entry.getTag(0), ValueTag.String);
		keyTag = ValueTag.String;
		keyScalar = entry.getStringId(0);
		keys.push(pool.toString(keyScalar));
	}
	assert.deepEqual(keys.sort(), ['replacement key', 'retained key']);
});
