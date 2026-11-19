import { TableHeader } from '../../machine/ts/machine/cpu/table';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { ValueTag, valueInteger, valueFloat, valueFloatBits, valueBool, valueNil, valueTable, valueString, type Value } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { TABLE_STORE_REQUIRES_GROWTH, TableLookupStatus, type TableLookupResult } from '../../machine/ts/machine/cpu/table';
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
	const objectKey = valueTable(cpu.gc.reference(object));
	const values: Value[] = [valueBool(false), valueFloatBits(0x80000000), valueFloat(5.25), valueFloatBits(0xffc01234), valueFloat(Infinity), objectKey, valueString(keys[0]), valueNil()];
	const slots = new ValueSlots(2);
	let prediction = 0;
	const compare = () => {
		const bytes = strings.records.getTrackedHeapBytes(strings.address);
		for (const key of keys) {
			const expected = generic.records.get(generic.address, valueString(key));
			assert.equal(strings.records.getStringKey(strings.address, key), expected);
			strings.records.loadStringKey(strings.address, key, slots, 0);
			assert.equal(slots.get(0), expected);
			prediction = strings.records.loadStringKeyCached(strings.address, key, prediction, slots, 0);
			assert.equal(slots.get(0), expected);
		}
		assert.equal(strings.records.getTrackedHeapBytes(strings.address), bytes, 'lookups reserve no guest storage');
		// Physical iteration order is serialized state, not an incidental layout.
		assert.equal(strings.records.storedSlotCount(strings.address), generic.records.storedSlotCount(generic.address));
		for (let slot = 0; slot < generic.records.storedSlotCount(generic.address); slot += 1) {
			const a = generic.records.loadStoredEntry(generic.address, slot, slots, 0);
			const b = strings.records.loadStoredEntry(strings.address, slot, slots, 0);
			assert.equal(b, a);
			if (!a) continue;
			const key = slots.get(0), value = slots.get(1);
			generic.records.loadStoredEntry(generic.address, slot, slots, 0);
			assert.equal(slots.get(0), key);
			assert.equal(slots.get(1), value);
		}
	};
	compare();
	for (const key of [valueInteger(0), valueBool(false), objectKey]) {
		generic.records.set(generic.address, key, valueInteger(19));
		strings.records.set(strings.address, key, valueInteger(19));
	}
	for (let n = 0; n < 256; n += 1) {
		const key = keys[(n * 7) & 15];
		const value = values[(n >> 4) & 7];
		generic.records.set(generic.address, valueString(key), value);
		slots.set(0, value);
		if ((n & 1) === 0) {
			const before = strings.records.getTrackedHeapBytes(strings.address);
			const slot = strings.records.storeStringKeyWithoutGrowth(strings.address, key, slots.getTag(0), slots.getPayload(0));
			assert.equal(strings.records.getTrackedHeapBytes(strings.address), before, 'bounded mutation reserves no storage');
			if (slot === TABLE_STORE_REQUIRES_GROWTH)
				strings.records.storeStringKey(strings.address, key, slots.getTag(0), slots.getPayload(0));
		} else {
			prediction = strings.records.storeStringKeyCached(strings.address, key, prediction, slots.getTag(0), slots.getPayload(0));
		}
		if ((n & 15) === 0) {
			generic.records.setInteger(generic.address, (n >> 4) + 1, valueInteger(n));
			strings.records.setInteger(strings.address, (n >> 4) + 1, valueInteger(n));
		}
		compare();
	}
	generic.records.set(generic.address, objectKey, valueNil());
	strings.records.set(strings.address, objectKey, valueNil());
	compare();
	generic.records.clear(generic.address);
	strings.records.clear(strings.address);
	compare();
});

test('known string lookup follows changing inherited fields and preserves false and signed zero', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const key = cpu.stringPool.intern('field');
	const indexKey = cpu.stringPool.intern('__index');
	const parent = cpu.createTable(0, 2);
	parent.records.setStringKey(parent.address, key, valueBool(false));
	const metatable = cpu.createTable(0, 1);
	metatable.records.setStringKey(metatable.address, indexKey, valueTable(cpu.gc.reference(parent)));
	const child = cpu.createTable();
	child.metatable = metatable;
	const slots = new ValueSlots(1);
	const result: TableLookupResult = { values: slots, slot: -1, extraVisits: 0, status: TableLookupStatus.Resolved };
	child.records.resolveStringIndex(child.address, indexKey, key, result);
	assert.equal(result.status, TableLookupStatus.Resolved);
	assert.equal(slots.get(0), valueBool(false));
	child.records.resolveStringIndexCached(child.address, indexKey, key, -1, result);
	let prediction = result.slot;
	assert.equal(result.extraVisits, 1);
	assert.ok(prediction >= 0);
	assert.equal(slots.get(0), valueBool(false));
	parent.records.storeStringKey(parent.address, key, ValueTag.Nil, 0);
	child.records.resolveStringIndexCached(child.address, indexKey, key, prediction, result);
	prediction = result.slot;
	assert.equal(prediction, -1);
	assert.equal(slots.get(0), valueNil());
	parent.records.storeStringKey(parent.address, key, ValueTag.Float, 0x80000000);
	child.records.resolveStringIndex(child.address, indexKey, key, result);
	assert.equal(result.status, TableLookupStatus.Resolved);
	assert.equal(slots.get(0), valueFloatBits(0x80000000));
});


test('rejected string-store growth retains the exhausted cursor for allocating completion', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const table = cpu.createTable(0, 1), present = cpu.stringPool.intern('full'), missing = cpu.stringPool.intern('new');
	table.records.setStringKey(table.address, present, valueInteger(73));
	const free = table.address + TableHeader.Free;
	assert.equal(memory.readRamRecordWord(free), 0);
	assert.equal(table.records.storeStringKeyWithoutGrowth(table.address, missing, ValueTag.Integer, 19), TABLE_STORE_REQUIRES_GROWTH);
	assert.equal(memory.readRamRecordWord(free) | 0, -1);
	assert.equal(table.records.getStringKey(table.address, present), valueInteger(73)); assert.equal(table.records.getStringKey(table.address, missing), valueNil());
	assert.equal(table.records.storeStringKeyWithoutGrowth(table.address, missing, ValueTag.Integer, 19), TABLE_STORE_REQUIRES_GROWTH);
	table.records.setStringKey(table.address, present, valueNil());
	assert.equal(table.records.storeStringKeyWithoutGrowth(table.address, missing, ValueTag.Integer, 19), 0);
	assert.equal(table.records.storedSlotCount(table.address), 1);
	assert.equal(table.records.getStringKey(table.address, missing), valueInteger(19));
});
