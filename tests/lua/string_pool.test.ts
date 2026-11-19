import { textToByteString } from '../../machine/ts/common/byte_string';
import assert from 'node:assert/strict';
import test from 'node:test';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { ValueTag, valueNil, valueInteger, valueTable, valueString } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';

function createCpu(): CPU {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: [null, null] }, PSX_MACHINE_SPEC.ramBytes);
	return new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
}

test('all byte values survive intern, indexing and snapshot restore', () => {
	const pool = createCpu().stringPool;
	for (const text of [Array.from({ length: 256 }, (_, code) => String.fromCharCode(code)).join(''),
		...['Aé雪\0Z', 'β😀A🚀\0é', '😀', 'a'.repeat(4096), '雪'.repeat(65), 'β😀A🚀\0é'.repeat(23)].map(textToByteString)]) {
		const id = pool.intern(text);
		const expected = Array.from(text, char => char.charCodeAt(0));
		const state = pool.captureState();
		for (let index = expected.length - 1; index >= 0; index -= 1) {
			assert.equal(pool.byteAt(id, index), expected[index]);
		}
		assert.deepEqual(pool.captureState(), state);
		pool.restoreState(state);
		for (let index = 0; index < expected.length; index += 1) {
			assert.equal(pool.byteAt(id, index), expected[index]);
		}
	}
});

test('collection removes unreachable text from the intern index and snapshots without accumulating IDs', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	const baselineBytes = cpu.collectTrackedHeapBytes(), baseline = pool.captureState();
	const suffix = 'x'.repeat(512);
	for (let round = 0; round < 8; round += 1) {
		for (let index = 0; index < 128; index += 1) pool.intern(`garbage-${round}-${index}-${suffix}`);
		assert.equal(cpu.collectTrackedHeapBytes(), baselineBytes);
		assert.equal(pool.find(`garbage-${round}-0-${suffix}`), undefined);
		assert.deepEqual(pool.captureState().entries, baseline.entries,
			'actual text returns to the permanent CPU roots, not just the RAM counter');
		assert.equal(pool.captureState().slots, baseline.slots + 128, 'vacant ID storage is reused, not accumulated each cycle');
		assert.equal(pool.captureState().freeIds.length, 128);
	}
});

test('untracked literals and empty strings are collectible; recycled slots publish new byte sequences', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	const baselineTracked = pool.trackedLuaHeapBytes();
	const old = pool.intern('retired literal', false);
	const empty = pool.intern('');
	cpu.collectTrackedHeapBytes();
	assert.equal(pool.find('retired literal'), undefined);
	assert.equal(pool.find(''), undefined);
	const replacement = pool.intern(textToByteString('β😀'));
	assert.equal(replacement, empty, 'sweep returns freed IDs in directory order; the last returned slot is reused first');
	assert.equal(pool.toString(replacement), 'β😀');
	assert.equal(pool.byteLength(replacement), 6);
	assert.equal(pool.byteAt(replacement, 0), 0xce);
	assert.equal(pool.byteAt(replacement, 5), 0x80);
	assert.equal(pool.trackedLuaHeapBytes(), baselineTracked + 6);
	assert.equal(pool.intern('second replacement'), old);
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
	cpu.setGlobalByKey(root, valueTable(cpu.gc.reference(table)));
	const removed = pool.intern('removed key');
	table.records.setStringKey(table.address, removed, valueInteger(19));
	table.records.setStringKey(table.address, removed, valueNil());
	const retained = pool.intern('retained key');
	table.records.setStringKey(table.address, retained, valueInteger(23));
	cpu.collectTrackedHeapBytes();
	assert.equal(pool.find('removed key'), undefined);
	const replacement = pool.intern('replacement key');
	assert.equal(replacement, removed);
	assert.equal(table.records.getStringKey(table.address, replacement), valueNil());
	table.records.setStringKey(table.address, replacement, valueInteger(29));
	assert.equal(table.records.get(table.address, valueString(replacement)), valueInteger(29));
	assert.equal(table.records.getStringKey(table.address, retained), valueInteger(23));
	const entry = new ValueSlots(2), keys: string[] = [];
	for (table.records.next(table.address, entry.get(0), entry, 0); entry.getTag(0) !== ValueTag.Nil;
		table.records.next(table.address, entry.get(0), entry, 0)) {
		assert.equal(entry.getTag(0), ValueTag.String);
		keys.push(pool.toString(entry.getStringId(0)));
	}
	assert.deepEqual(keys.sort(), ['replacement key', 'retained key']);
});


test('long byte strings are reclaimed before an ID is reused', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	cpu.collectTrackedHeapBytes();
	const baseline = pool.trackedLuaHeapBytes();
	const text = textToByteString('β😀A🚀\0é'.repeat(23));
	const old = pool.intern(text);
	assert.equal(pool.trackedLuaHeapBytes(), baseline + 14 * 23, 'only payload bytes are charged');
	assert.equal(pool.byteAt(old, 128), text.charCodeAt(128));
	cpu.collectTrackedHeapBytes();
	assert.equal(pool.trackedLuaHeapBytes(), baseline);
	const id = pool.intern(textToByteString('😀'.repeat(65)));
	assert.equal(id, old);
	assert.equal(pool.byteAt(id, 64), 0xf0);
	cpu.collectTrackedHeapBytes();
	assert.equal(pool.intern('ascii'), old);
	assert.equal(pool.byteAt(old, 4), 105);
});
