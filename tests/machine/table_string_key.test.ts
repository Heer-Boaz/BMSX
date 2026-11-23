import { TableHeader } from '../../machine/ts/machine/cpu/table';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { hashCanonicalTableKey, ValueTag, valueInteger, valueFloat, valueFloatBits, valueBool, valueNil, valueTable, valueString, type Value } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { TABLE_HASH_UNPROBED, TableLookupStatus, type TableLookupResult } from '../../machine/ts/machine/cpu/table';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { BLUA32_STRING_RECORD_ALIGNMENT_SHIFT } from '../../machine/ts/spec/blua32/image_format';
import { MAIN_RAM_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';

test('aligned String identities distribute home slots and preserve displaced collision chains', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const tables = cpu.gc.tables, table = cpu.createTable(0, 8);
	const keys: number[][] = Array.from({ length: 8 }, () => []);
	const probe = { node: -1, remaining: 0, value: valueNil() };
	for (let i = 10; i < 90; ++i) {
		const key = cpu.stringPool.intern(`table-home-key-${i}`);
		const home = (key >>> BLUA32_STRING_RECORD_ALIGNMENT_SHIFT) & 7;
		tables.beginStringProbe(table, key, probe);
		assert.equal(probe.node, home, 'use record identity bits, not zero byte-offset bits');
		keys[home].push(key);
	}
	assert.ok(keys.every(group => group.length >= 2), 'the interned records exercise all eight homes');
	const [resident, collided] = keys[0];
	assert.equal(tables.storeStringKey(table, resident, ValueTag.Integer, 11), 0);
	const slot = tables.storeStringKey(table, collided, ValueTag.Integer, 22);
	assert.ok(slot > 0 && slot < 8, 'a genuine same-home collision uses a free node');
	const incoming = keys[slot][0];
	assert.equal(tables.storeStringKey(table, incoming, ValueTag.Integer, 33), slot,
		'an incoming home displaces the chain member');
	tables.beginStringProbe(table, collided, probe);
	assert.equal(tables.advanceStringProbe(table, collided, probe, 8), 2);
	assert.equal(probe.value, valueInteger(22));
	assert.equal(tables.getStringKey(table, resident), valueInteger(11));
	assert.equal(tables.getStringKey(table, incoming), valueInteger(33));
});

test('known string chains preserve mixed-key collisions, cached updates, tombstones and rehash order', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const keys: number[] = [];
	for (let n = 0; keys.length < 16; n += 1) {
		const key = cpu.stringPool.intern(`collision_${n}`);
		if ((hashCanonicalTableKey(valueString(key)) & 31) === 0) keys.push(key);
	}
	const generic = cpu.createTable(0, 4);
	const strings = cpu.createTable(0, 4);
	const object = cpu.createTable();
	const objectKey = valueTable(object);
	const values: Value[] = [valueBool(false), valueFloatBits(0x80000000), valueFloat(5.25), valueFloatBits(0xffc01234), valueFloat(Infinity), objectKey, valueString(keys[0]), valueNil()];
	const slots = new ValueSlots(2);
	let prediction = 0;
	const cached = { slot: -1, value: valueNil() };
	const compare = () => {
		const bytes = cpu.gc.tables.getTrackedHeapBytes(strings);
		for (const key of keys) {
			const expected = cpu.gc.tables.get(generic, valueString(key));
			assert.equal(cpu.gc.tables.getStringKey(strings, key), expected);
			cpu.gc.tables.loadStringKey(strings, key, slots, 0);
			assert.equal(slots.get(0), expected);
			cpu.gc.tables.getStringKeyCached(strings, key, prediction, cached);
			prediction = cached.slot;
			assert.equal(cached.value, expected);
		}
		assert.equal(cpu.gc.tables.getTrackedHeapBytes(strings), bytes, 'lookups reserve no guest storage');
		// Physical iteration order is serialized state, not an incidental layout.
		assert.equal(cpu.gc.tables.storedSlotCount(strings), cpu.gc.tables.storedSlotCount(generic));
		for (let slot = 0; slot < cpu.gc.tables.storedSlotCount(generic); slot += 1) {
			const a = cpu.gc.tables.loadStoredEntry(generic, slot, slots, 0);
			const b = cpu.gc.tables.loadStoredEntry(strings, slot, slots, 0);
			assert.equal(b, a);
			if (!a) continue;
			const key = slots.get(0), value = slots.get(1);
			cpu.gc.tables.loadStoredEntry(generic, slot, slots, 0);
			assert.equal(slots.get(0), key);
			assert.equal(slots.get(1), value);
		}
	};
	compare();
	for (const key of [valueInteger(0), valueBool(false), objectKey]) {
		cpu.gc.tables.set(generic, key, valueInteger(19));
		cpu.gc.tables.set(strings, key, valueInteger(19));
	}
	for (let n = 0; n < 256; n += 1) {
		const key = keys[(n * 7) & 15];
		const value = values[(n >> 4) & 7];
		cpu.gc.tables.set(generic, valueString(key), value);
		slots.set(0, value);
		if ((n & 1) === 0) {
			cpu.gc.tables.storeStringKey(strings, key, slots.getTag(0), slots.getPayload(0));
		} else if (!cpu.gc.tables.storePredictedStringKey(strings, key, prediction, slots.getTag(0), slots.getPayload(0))) {
			prediction = cpu.gc.tables.storeStringKey(strings, key, slots.getTag(0), slots.getPayload(0));
		}
		if ((n & 15) === 0) {
			cpu.gc.tables.setInteger(generic, (n >> 4) + 1, valueInteger(n));
			cpu.gc.tables.setInteger(strings, (n >> 4) + 1, valueInteger(n));
		}
		compare();
	}
	cpu.gc.tables.set(generic, objectKey, valueNil());
	cpu.gc.tables.set(strings, objectKey, valueNil());
	compare();
	cpu.gc.tables.clear(generic);
	cpu.gc.tables.clear(strings);
	compare();

	const tables = cpu.gc.tables, chain = cpu.createTable(0, 2);
	const head = tables.storeStringKey(chain, keys[0], ValueTag.Integer, 11);
	const tail = tables.storeStringKey(chain, keys[1], ValueTag.Integer, 22);
	tables.setStringKey(chain, keys[0], valueNil());
	assert.notEqual(head, tail);
	assert.equal(tables.storeStringKey(chain, keys[1], ValueTag.Integer, 33), tail,
		'a tombstoned home must not hide a live colliding key');
	assert.equal(tables.storeStringKey(chain, keys[2], ValueTag.Integer, 44), head);
	assert.equal(tables.getStringKey(chain, keys[1]), valueInteger(33), 'reusing the home keeps its live link');
	assert.equal(tables.getStringKey(chain, keys[0]), valueNil());
});

test('known string lookup follows changing inherited fields and preserves false and signed zero', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const key = cpu.stringPool.intern('field');
	const indexKey = cpu.stringPool.intern('__index');
	const parent = cpu.createTable(0, 2);
	cpu.gc.tables.setStringKey(parent, key, valueBool(false));
	const metatable = cpu.createTable(0, 1);
	cpu.gc.tables.setStringKey(metatable, indexKey, valueTable(parent));
	const child = cpu.createTable();
	cpu.gc.tables.setMetatableAddress(child, metatable);
	const slots = new ValueSlots(1);
	const result: TableLookupResult = { value: valueNil(), slot: -1, extraVisits: 0, status: TableLookupStatus.Resolved, receiver: 0 };
	cpu.gc.tables.resolveStringIndex(child, indexKey, key, result);
	assert.equal(result.status, TableLookupStatus.Resolved);
	assert.equal(result.value, valueBool(false));
	cpu.gc.tables.resolveStringIndexCached(child, indexKey, key, -1, result);
	let prediction = result.slot;
	assert.equal(result.extraVisits, 1);
	assert.ok(prediction >= 0);
	assert.equal(result.value, valueBool(false));
	cpu.gc.tables.storeStringKey(parent, key, ValueTag.Nil, 0);
	cpu.gc.tables.resolveStringIndexCached(child, indexKey, key, prediction, result);
	prediction = result.slot;
	assert.equal(prediction, -1);
	assert.equal(result.value, valueNil());
	cpu.gc.tables.storeStringKey(parent, key, ValueTag.Float, 0x80000000);
	cpu.gc.tables.resolveStringIndex(child, indexKey, key, result);
	assert.equal(result.status, TableLookupStatus.Resolved);
	assert.equal(result.value, valueFloatBits(0x80000000));

	cpu.gc.tables.setStringKey(child, key, valueBool(false));
	cpu.gc.tables.resolveStringIndexCached(child, indexKey, key, result.slot, result);
	assert.equal(result.value, valueBool(false));
	assert.equal(result.extraVisits, 0, 'an own field stops traversal even when its value is false');

	const raw = cpu.createTable(0, 8);
	const highBitKey = valueString((key ^ 0x80000000) >>> 0);
	cpu.gc.tables.set(raw, highBitKey, valueInteger(21));
	assert.equal(cpu.gc.tables.getStringKey(raw, key), valueNil(), 'String keys use the entire payload');
	cpu.gc.tables.setStringKey(raw, key, valueInteger(42));
	memory.writeRamRecordWord(raw + TableHeader.Storage, cpu.gc.tables.storageAddress(raw) + MAIN_RAM_SIZE);
	assert.equal(cpu.gc.tables.get(raw, highBitKey), valueInteger(21));
	cpu.gc.tables.getStringKeyCached(raw, key, -1, result);
	prediction = result.slot;
	assert.equal(result.value, valueInteger(42));
	assert.ok(prediction >= 0);
	assert.equal(cpu.gc.tables.loadPredictedStringKey(raw, key, prediction, slots, 0), true);
	assert.equal(slots.get(0), valueInteger(42));
});


test('deleting a string mapping allows its reserved hash placement to be reused', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const table = cpu.createTable(0, 1), present = cpu.stringPool.intern('full'), missing = cpu.stringPool.intern('new');
	cpu.gc.tables.setStringKey(table, present, valueInteger(73));
	const storage = cpu.gc.tables.storageAddress(table), used = cpu.luaHeap.usedBytes();
	cpu.gc.tables.setStringKey(table, present, valueNil());
	assert.equal(cpu.gc.tables.storeStringKey(table, missing, ValueTag.Integer, 19), 0);
	assert.equal(cpu.gc.tables.storageAddress(table), storage);
	assert.equal(cpu.luaHeap.usedBytes(), used, 'the pre-paid mapping is reused');
	assert.equal(cpu.gc.tables.getStringKey(table, missing), valueInteger(19));
});

test('fixed string assignment retains the terminal hash result across forwarding', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const tables = cpu.gc.tables, source = cpu.createTable(), forwarded = cpu.createTable(0, 2);
	const meta = cpu.createTable(0, 1), terminalMeta = cpu.createTable();
	const newIndex = cpu.stringPool.intern('__newindex'), field = cpu.stringPool.intern('field'), absent = cpu.stringPool.intern('absent');
	tables.setStringKey(meta, newIndex, valueTable(forwarded));
	tables.setMetatableAddress(source, meta);
	const result: TableLookupResult = { value: valueNil(), slot: -1, extraVisits: 0, status: TableLookupStatus.Resolved, receiver: 0 };
	const ownSlot = tables.storeStringKey(forwarded, field, ValueTag.False, 0);

	tables.resolveAssignment(source, newIndex, valueString(field), result, true);
	assert.equal(result.slot, TABLE_HASH_UNPROBED, 'without a metatable the mutator owns the only probe');
	assert.equal(result.receiver, forwarded);
	assert.equal(result.extraVisits, 1);

	tables.setMetatableAddress(forwarded, terminalMeta);
	tables.resolveAssignment(source, newIndex, valueString(field), result, true);
	assert.deepEqual(result, { value: valueNil(), slot: ownSlot, extraVisits: 1, status: TableLookupStatus.Store, receiver: forwarded },
		'false is a live field, but its payload is not the result of an assignment lookup');
	tables.storeStringKey(result.receiver, field, ValueTag.Nil, 0, result.slot);
	assert.equal(tables.getStringKey(forwarded, field), valueNil());
	tables.resolveAssignment(source, newIndex, valueString(field), result, true);
	assert.equal(result.slot, ownSlot, 'the matched tombstone is distinct from a scanned miss');
	assert.equal(tables.storeStringKey(result.receiver, field, ValueTag.Integer, 19, result.slot), ownSlot);
	assert.equal(tables.getStringKey(forwarded, field), valueInteger(19));

	tables.resolveAssignment(source, newIndex, valueString(absent), result, true);
	assert.deepEqual(result, { value: valueNil(), slot: -1, extraVisits: 1, status: TableLookupStatus.Store, receiver: forwarded });
	tables.storeStringKey(result.receiver, absent, ValueTag.Nil, 0, result.slot);
	assert.equal(tables.getStringKey(forwarded, absent), valueNil());
	assert.equal(tables.getStringKey(source, field), valueNil());
});
