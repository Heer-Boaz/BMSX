import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
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
	const tables = nativeHeapReference(cpu).gc.tables, table = createReferenceTable(cpu, 0, 8);
	const keys: number[][] = Array.from({ length: 8 }, () => []);
	const probe = { node: -1, remaining: 0, slot: -1, value: valueNil() };
	for (let i = 10; i < 90; ++i) {
		const key = nativeHeapReference(cpu).stringPool.intern(`table-home-key-${i}`);
		const home = (key >>> BLUA32_STRING_RECORD_ALIGNMENT_SHIFT) & 7;
		tables.beginStringProbe(table, key, probe);
		assert.equal(probe.node, home, 'use record identity bits, not zero byte-offset bits');
		keys[home].push(key);
	}
	assert.ok(keys.every(group => group.length >= 3), 'the interned records exercise all eight homes');
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
	const displaced = probe.slot;
	tables.setStringKey(table, collided, valueNil());
	for (const key of [collided, keys[0][2]]) {
		tables.beginStringProbe(table, key, probe);
		assert.equal(tables.advanceStringProbe(table, key, probe, 0), 0);
		assert.deepEqual([probe.node, probe.remaining], [0, 8]);
		assert.equal(tables.advanceStringProbe(table, key, probe, 1), 1);
		assert.deepEqual([probe.node, probe.remaining], [displaced, 7]);
		assert.equal(tables.advanceStringProbe(table, key, probe, 1), 1);
		assert.deepEqual([probe.node, probe.remaining, probe.value, probe.slot],
			[-1, 6, valueNil(), key === collided ? displaced : -1]);
		assert.equal(tables.getStringKeyCached(table, key, -1, probe), key === collided ? 0 : 1);
		assert.equal(probe.slot, -1, 'neither nil result publishes a prediction');
	}
});

test('known string chains preserve mixed-key collisions, cached updates, tombstones and rehash order', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const keys: number[] = [];
	for (let n = 0; keys.length < 16; n += 1) {
		const key = nativeHeapReference(cpu).stringPool.intern(`collision_${n}`);
		if ((hashCanonicalTableKey(valueString(key)) & 31) === 0) keys.push(key);
	}
	const generic = createReferenceTable(cpu, 0, 4);
	const strings = createReferenceTable(cpu, 0, 4);
	const object = createReferenceTable(cpu);
	const objectKey = valueTable(object);
	const values: Value[] = [valueBool(false), valueFloatBits(0x80000000), valueFloat(5.25), valueFloatBits(0xffc01234), valueFloat(Infinity), objectKey, valueString(keys[0]), valueNil()];
	const slots = new ValueSlots(2);
	let prediction = 0;
	const cached = { slot: -1, value: valueNil() };
	const compare = () => {
		const bytes = nativeHeapReference(cpu).gc.tables.getTrackedHeapBytes(strings);
		for (const key of keys) {
			const expected = cpu.tables.get(generic, valueString(key));
			assert.equal(cpu.tables.getStringKey(strings, key), expected);
			cpu.tables.loadStringKey(strings, key, slots, 0);
			assert.equal(slots.get(0), expected);
			cpu.tables.getStringKeyCached(strings, key, prediction, cached);
			prediction = cached.slot;
			assert.equal(cached.value, expected);
		}
		assert.equal(nativeHeapReference(cpu).gc.tables.getTrackedHeapBytes(strings), bytes, 'lookups reserve no guest storage');
		// Physical iteration order is serialized state, not an incidental layout.
		assert.equal(cpu.tables.storedSlotCount(strings), cpu.tables.storedSlotCount(generic));
		for (let slot = 0; slot < cpu.tables.storedSlotCount(generic); slot += 1) {
			const a = cpu.tables.loadStoredEntry(generic, slot, slots, 0);
			const b = cpu.tables.loadStoredEntry(strings, slot, slots, 0);
			assert.equal(b, a);
			if (!a) continue;
			const key = slots.get(0), value = slots.get(1);
			cpu.tables.loadStoredEntry(generic, slot, slots, 0);
			assert.equal(slots.get(0), key);
			assert.equal(slots.get(1), value);
		}
	};
	compare();
	for (const key of [valueInteger(0), valueBool(false), objectKey]) {
		nativeHeapReference(cpu).gc.tables.set(generic, key, valueInteger(19));
		nativeHeapReference(cpu).gc.tables.set(strings, key, valueInteger(19));
	}
	for (let n = 0; n < 256; n += 1) {
		const key = keys[(n * 7) & 15];
		const value = values[(n >> 4) & 7];
		nativeHeapReference(cpu).gc.tables.set(generic, valueString(key), value);
		slots.set(0, value);
		if ((n & 1) === 0) {
			nativeHeapReference(cpu).gc.tables.storeStringKey(strings, key, slots.getTag(0), slots.getPayload(0));
		} else if (!cpu.tables.storePredictedStringKey(strings, key, prediction, slots.getTag(0), slots.getPayload(0))) {
			prediction = nativeHeapReference(cpu).gc.tables.storeStringKey(strings, key, slots.getTag(0), slots.getPayload(0));
		}
		if ((n & 15) === 0) {
			nativeHeapReference(cpu).gc.tables.setInteger(generic, (n >> 4) + 1, valueInteger(n));
			nativeHeapReference(cpu).gc.tables.setInteger(strings, (n >> 4) + 1, valueInteger(n));
		}
		compare();
	}
	nativeHeapReference(cpu).gc.tables.set(generic, objectKey, valueNil());
	nativeHeapReference(cpu).gc.tables.set(strings, objectKey, valueNil());
	compare();
	nativeHeapReference(cpu).gc.tables.clear(generic);
	nativeHeapReference(cpu).gc.tables.clear(strings);
	compare();

	const tables = nativeHeapReference(cpu).gc.tables, chain = createReferenceTable(cpu, 0, 2);
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
	const key = nativeHeapReference(cpu).stringPool.intern('field');
	const indexKey = nativeHeapReference(cpu).stringPool.intern('__index');
	const parent = createReferenceTable(cpu, 0, 2);
	nativeHeapReference(cpu).gc.tables.setStringKey(parent, key, valueBool(false));
	const metatable = createReferenceTable(cpu, 0, 1);
	nativeHeapReference(cpu).gc.tables.setStringKey(metatable, indexKey, valueTable(parent));
	const child = createReferenceTable(cpu);
	nativeHeapReference(cpu).gc.tables.setMetatableAddress(child, metatable);
	const slots = new ValueSlots(1);
	const result: TableLookupResult = { value: valueNil(), slot: -1, extraVisits: 0, status: TableLookupStatus.Resolved, receiver: 0 };
	cpu.tables.resolveStringIndex(child, key, result);
	assert.equal(result.status, TableLookupStatus.Resolved);
	assert.equal(result.value, valueBool(false));
	cpu.tables.resolveStringIndexCached(child, key, -1, result);
	let prediction = result.slot;
	assert.equal(result.extraVisits, 1);
	assert.ok(prediction >= 0);
	assert.equal(result.value, valueBool(false));
	nativeHeapReference(cpu).gc.tables.storeStringKey(parent, key, ValueTag.Nil, 0);
	cpu.tables.resolveStringIndexCached(child, key, prediction, result);
	prediction = result.slot;
	assert.equal(prediction, -1);
	assert.equal(result.value, valueNil());
	nativeHeapReference(cpu).gc.tables.storeStringKey(parent, key, ValueTag.Float, 0x80000000);
	cpu.tables.resolveStringIndex(child, key, result);
	assert.equal(result.status, TableLookupStatus.Resolved);
	assert.equal(result.value, valueFloatBits(0x80000000));

	nativeHeapReference(cpu).gc.tables.setStringKey(child, key, valueBool(false));
	cpu.tables.resolveStringIndexCached(child, key, result.slot, result);
	assert.equal(result.value, valueBool(false));
	assert.equal(result.extraVisits, 0, 'an own field stops traversal even when its value is false');

	const raw = createReferenceTable(cpu, 0, 8);
	const highBitKey = valueString((key ^ 0x80000000) >>> 0);
	nativeHeapReference(cpu).gc.tables.set(raw, highBitKey, valueInteger(21));
	assert.equal(cpu.tables.getStringKey(raw, key), valueNil(), 'String keys use the entire payload');
	nativeHeapReference(cpu).gc.tables.setStringKey(raw, key, valueInteger(42));
	memory.writeRamRecordWord(raw + TableHeader.HashStorage, cpu.tables.hashAddress(raw) + MAIN_RAM_SIZE);
	assert.equal(cpu.tables.get(raw, highBitKey), valueInteger(21));
	cpu.tables.getStringKeyCached(raw, key, -1, result);
	prediction = result.slot;
	assert.equal(result.value, valueInteger(42));
	assert.ok(prediction >= 0);
	assert.equal(cpu.tables.loadPredictedStringKey(raw, key, prediction, slots, 0), true);
	assert.equal(slots.get(0), valueInteger(42));
});


test('deleting a string mapping allows its reserved hash placement to be reused', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const table = createReferenceTable(cpu, 0, 1), present = nativeHeapReference(cpu).stringPool.intern('full'), missing = nativeHeapReference(cpu).stringPool.intern('new');
	nativeHeapReference(cpu).gc.tables.setStringKey(table, present, valueInteger(73));
	const storage = cpu.tables.hashAddress(table), used = nativeHeapReference(cpu).luaHeap.usedBytes();
	nativeHeapReference(cpu).gc.tables.setStringKey(table, present, valueNil());
	assert.equal(nativeHeapReference(cpu).gc.tables.storeStringKey(table, missing, ValueTag.Integer, 19), 0);
	assert.equal(cpu.tables.hashAddress(table), storage);
	assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), used, 'the pre-paid mapping is reused');
	assert.equal(cpu.tables.getStringKey(table, missing), valueInteger(19));
});

test('fixed string assignment probes the terminal table only if it can invoke a setter', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const tables = nativeHeapReference(cpu).gc.tables, source = createReferenceTable(cpu), forwarded = createReferenceTable(cpu, 0, 2);
	const meta = createReferenceTable(cpu, 0, 1), terminalMeta = createReferenceTable(cpu);
	const newIndex = nativeHeapReference(cpu).stringPool.intern('__newindex'), field = nativeHeapReference(cpu).stringPool.intern('field'), absent = nativeHeapReference(cpu).stringPool.intern('absent');
	tables.setStringKey(meta, newIndex, valueTable(forwarded));
	tables.setMetatableAddress(source, meta);
	const result: TableLookupResult = { value: valueNil(), slot: -1, extraVisits: 0, status: TableLookupStatus.Resolved, receiver: 0 };
	const ownSlot = tables.storeStringKey(forwarded, field, ValueTag.False, 0);

	tables.resolveAssignment(source, valueString(field), result, true);
	assert.equal(result.slot, TABLE_HASH_UNPROBED, 'without a metatable the mutator owns the only probe');
	assert.equal(result.receiver, forwarded);
	assert.equal(result.extraVisits, 1);

	tables.setMetatableAddress(forwarded, terminalMeta);
	tables.setStringKey(terminalMeta, newIndex, valueBool(false));
	tables.resolveAssignment(source, valueString(field), result, true);
	assert.deepEqual(result, { value: valueNil(), slot: ownSlot, extraVisits: 1, status: TableLookupStatus.Store, receiver: forwarded },
		'false is a live field, but its payload is not the result of an assignment lookup');
	tables.storeStringKey(result.receiver, field, ValueTag.Nil, 0, result.slot);
	assert.equal(tables.getStringKey(forwarded, field), valueNil());
	tables.resolveAssignment(source, valueString(field), result, true);
	assert.equal(result.status, TableLookupStatus.Forward, 'a tombstone does not shadow a method, even one with a false value');
	tables.setStringKey(terminalMeta, newIndex, valueNil());
	tables.resolveAssignment(source, valueString(field), result, true);
	assert.equal(result.slot, TABLE_HASH_UNPROBED, 'with no possible setter the mutator owns the only probe');
	assert.equal(tables.storeStringKey(result.receiver, field, ValueTag.Integer, 19, result.slot), ownSlot);
	assert.equal(tables.getStringKey(forwarded, field), valueInteger(19));

	tables.resolveAssignment(source, valueString(absent), result, true);
	assert.deepEqual(result, { value: valueNil(), slot: TABLE_HASH_UNPROBED, extraVisits: 1, status: TableLookupStatus.Store, receiver: forwarded });
	tables.storeStringKey(result.receiver, absent, ValueTag.Nil, 0, result.slot);
	assert.equal(tables.getStringKey(forwarded, absent), valueNil());
	assert.equal(tables.getStringKey(source, field), valueNil());
});

test('a periodic __index path retains the cost of its prefix and last incomplete round', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const tables = nativeHeapReference(cpu).gc.tables, next = [1, 2, 3, 4, 2], roots = next.map(() => createReferenceTable(cpu));
	const indexKey = nativeHeapReference(cpu).stringPool.intern('__index'), method = valueString(indexKey), key = valueString(nativeHeapReference(cpu).stringPool.intern('field'));
	for (let i = 0; i < roots.length; ++i) {
		const meta = createReferenceTable(cpu, 0, 128);
		tables.setMetatableAddress(roots[i], meta);
		for (let j = 0, n = 0; j < 65 + i; ++j) {
			if (j === 1) tables.set(meta, method, valueTable(roots[next[i]]));
			else {
				let other: Value;
				do other = valueInteger(n++); while (((hashCanonicalTableKey(other) ^ hashCanonicalTableKey(method)) & 127) !== 0);
				tables.set(meta, other, valueBool(false));
			}
		}
	}
	const result = { value: valueNil(), slot: -1, extraVisits: 0, status: TableLookupStatus.Resolved, receiver: 0 };
	let links = 0, position = 0;
	for (let limit = 1; limit <= 32; ++limit) {
		links += 1 + position;
		position = next[position];
		assert.equal(tables.resolveIndex(roots[0], key, result, limit), links);
		assert.equal(result.extraVisits, limit - 1);
		assert.equal(result.status, TableLookupStatus.ChainExhausted);
	}
});
