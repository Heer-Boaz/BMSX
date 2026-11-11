import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { ValueTag, valueString, type Value } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { CpuSnapshot, CpuSnapshotWriter, CpuSnapshotTable } from '../../machine/ts/machine/cpu/snapshot';
import { TABLE_STORE_REQUIRES_GROWTH } from '../../machine/ts/machine/cpu/table';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';

test('known string chains preserve mixed-key collisions, cached updates, tombstones and rehash order', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const keys: number[] = [];
	for (let n = 0; keys.length < 16; n += 1) {
		const key = cpu.stringPool.intern(`collision_${n}`);
		if ((Math.imul(key, 2654435761) & 31) === 0) keys.push(key);
	}
	const generic = cpu.createTable(0, 4);
	const strings = cpu.createTable(0, 4);
	const object = cpu.createTable();
	object.hashId = 0;
	const values: Value[] = [false, -0, 5.25, NaN, Infinity, object, valueString(keys[0]), null];
	const slots = new ValueSlots(2);
	let prediction = 0;
	const compare = () => {
		const bytes = strings.getTrackedHeapBytes();
		for (const key of keys) {
			const expected = generic.get(valueString(key));
			assert.equal(strings.getStringKey(key), expected);
			strings.loadStringKey(key, slots, 0);
			assert.equal(slots.get(0), expected);
			prediction = strings.loadStringKeyCached(key, prediction, slots, 0);
			assert.equal(slots.get(0), expected);
		}
		assert.equal(strings.getTrackedHeapBytes(), bytes, 'lookups reserve no guest storage');
		// Physical iteration order is serialized state, not an incidental layout.
		assert.equal(strings.storedSlotCount, generic.storedSlotCount);
		for (let slot = 0; slot < generic.storedSlotCount; slot += 1) {
			const a = generic.loadStoredEntry(slot, slots, 0);
			const b = strings.loadStoredEntry(slot, slots, 0);
			assert.equal(b, a);
			if (!a) continue;
			const key = slots.get(0), value = slots.get(1);
			generic.loadStoredEntry(slot, slots, 0);
			assert.equal(slots.get(0), key);
			assert.equal(slots.get(1), value);
		}
	};
	compare();
	for (const key of [0, false, object]) {
		generic.set(key, 19);
		strings.set(key, 19);
	}
	for (let n = 0; n < 256; n += 1) {
		const key = keys[(n * 7) & 15];
		const value = values[(n >> 4) & 7];
		generic.set(valueString(key), value);
		slots.set(0, value);
		if ((n & 1) === 0) {
			const before = strings.getTrackedHeapBytes();
			const slot = strings.storeStringKeyWithoutGrowth(key, slots.getTag(0), slots.getScalar(0), slots.getReference(0));
			assert.equal(strings.getTrackedHeapBytes(), before, 'bounded mutation reserves no storage');
			if (slot === TABLE_STORE_REQUIRES_GROWTH)
				strings.storeStringKey(key, slots.getTag(0), slots.getScalar(0), slots.getReference(0));
		} else {
			prediction = strings.storeStringKeyCached(key, prediction, slots.getTag(0), slots.getScalar(0), slots.getReference(0));
		}
		if ((n & 15) === 0) {
			generic.setInteger((n >> 4) + 1, n);
			strings.setInteger((n >> 4) + 1, n);
		}
		compare();
	}
	generic.set(object, null);
	strings.set(object, null);
	compare();
	generic.clear();
	strings.clear();
	compare();
});

test('known string lookup follows changing inherited fields and preserves false and signed zero', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const key = cpu.stringPool.intern('field');
	const indexKey = cpu.stringPool.intern('__index');
	const parent = cpu.createTable(0, 2);
	parent.setStringKey(key, false);
	const metatable = cpu.createTable(0, 1);
	metatable.setStringKey(indexKey, parent);
	const child = cpu.createTable();
	child.metatable = metatable;
	const slots = new ValueSlots(1);
	assert.equal(child.resolveStringIndex(indexKey, key, slots, 0), true);
	assert.equal(slots.get(0), false);
	let prediction = child.resolveStringIndexCached(indexKey, key, -1, slots, 0);
	assert.ok(prediction >= 0);
	assert.equal(slots.get(0), false);
	parent.storeStringKey(key, ValueTag.Nil, NaN, null);
	prediction = child.resolveStringIndexCached(indexKey, key, prediction, slots, 0);
	assert.equal(prediction, -1);
	assert.equal(slots.get(0), null);
	parent.storeStringKey(key, ValueTag.Number, -0, null);
	assert.equal(child.resolveStringIndex(indexKey, key, slots, 0), true);
	assert.equal(slots.get(0), -0);
});


test('rejected string-store growth leaves the free-slot search hint for allocating completion', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const table = cpu.createTable(0, 1), present = cpu.stringPool.intern('full'), missing = cpu.stringPool.intern('new');
	table.setStringKey(present, 73);
	const beforeWriter = new CpuSnapshotWriter(new CpuSnapshot());
	const beforeOffset = table.captureSnapshot(beforeWriter, () => {}), before = beforeWriter.finish();
	assert.equal(table.storeStringKeyWithoutGrowth(missing, ValueTag.Number, 19, null), TABLE_STORE_REQUIRES_GROWTH);
	const afterWriter = new CpuSnapshotWriter(new CpuSnapshot());
	const afterOffset = table.captureSnapshot(afterWriter, () => {}), after = afterWriter.finish();
	assert.equal(after.word(afterOffset + CpuSnapshotTable.HashFree), before.word(beforeOffset + CpuSnapshotTable.HashFree));
	assert.equal(table.getStringKey(present), 73); assert.equal(table.getStringKey(missing), null);
});
