import { collectReferenceHeapBytes, createReferenceTable } from '../helpers/cpu_heap_reference';
import { setReferenceGlobal } from '../helpers/global_bank_reference';
import { textToByteString } from '../../machine/ts/common/byte_string';
import { writeLE32 } from '../../machine/ts/common/endian';
import { hashText } from '../../machine/ts/common/hash';
import assert from 'node:assert/strict';
import test from 'node:test';
import { HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import {
	BLUA32_STRING_HASH_OFFSET, BLUA32_STRING_LENGTH_OFFSET, BLUA32_STRING_RECORD_HEADER_SIZE,
	BLUA32_STRING_RECORD_KIND, BLUA32_STRING_RECORD_ROM_FLAG,
} from '../../machine/ts/spec/blua32/image_format';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { ValueTag, valuePayload, valueNil, valueInteger, valueTable, valueString } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import { linkRawTestBlua32Pair } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { HEAP_PAGE_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { internStringSliceReference } from '../helpers/string_slice_reference';

function createCpu(): CPU {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: [null, null] }, PSX_MACHINE_SPEC.ramBytes);
	return new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
}

test('all byte values survive intern, indexing and snapshot restore', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	for (const text of [Array.from({ length: 256 }, (_, code) => String.fromCharCode(code)).join(''),
		...['Aé雪\0Z', 'β😀A🚀\0é', '😀', 'a'.repeat(4096), '雪'.repeat(65), 'β😀A🚀\0é'.repeat(23)].map(textToByteString)]) {
		const id = pool.intern(text);
		const expected = Array.from(text, char => char.charCodeAt(0));
		const state = cpu.memory.captureSaveState();
		for (let index = expected.length - 1; index >= 0; index -= 1) {
			assert.equal(pool.byteAt(id, index), expected[index]);
		}
		assert.equal(cpu.memory.readRamRecordWord(id) & 0xff, BLUA32_STRING_RECORD_KIND);
		assert.equal(cpu.memory.readRamRecordWord(id + 8), text.length);
		cpu.memory.restoreSaveState(state);
		for (let index = 0; index < expected.length; index += 1) {
			assert.equal(pool.byteAt(id, index), expected[index]);
		}
	}
});

test('a ROM String requires a complete payload before publication and preserves installed NUL bytes', () => {
	const directory = 8, address = 32, start = address + BLUA32_STRING_RECORD_HEADER_SIZE;
	const payload = 'A\xf7\0\x81Z\0';
	const rom = new Uint8Array(start + payload.length);
	writeLE32(rom, directory, address);
	writeLE32(rom, address, BLUA32_STRING_RECORD_KIND | BLUA32_STRING_RECORD_ROM_FLAG);
	writeLE32(rom, address + BLUA32_STRING_HASH_OFFSET, hashText(payload));
	writeLE32(rom, address + BLUA32_STRING_LENGTH_OFFSET, payload.length);
	rom.set([0x41, 0xf7, 0x00, 0x81, 0x5a, 0x00], start);

	const truncatedMemory = new Memory({ systemRom: rom.subarray(0, -1), cartridgeSlots: [null, null] }, PSX_MACHINE_SPEC.ramBytes);
	const truncated = new CPU(truncatedMemory, new IrqController(truncatedMemory), new ExecutionAddressSpace(truncatedMemory)).stringPool;
	truncated.activateRomTable(SYSTEM_EXECUTION_DOMAIN_ID, directory, 1);
	assert.throws(() => truncated.resolveImageRecord(SYSTEM_EXECUTION_DOMAIN_ID, address), /ROM String is truncated/);
	assert.throws(() => truncated.find(payload), /ROM String is truncated/);

	const memory = new Memory({ systemRom: rom, cartridgeSlots: [null, null] }, PSX_MACHINE_SPEC.ramBytes);
	const pool = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory)).stringPool;
	pool.activateRomTable(SYSTEM_EXECUTION_DOMAIN_ID, directory, 1);
	const id = pool.resolveImageRecord(SYSTEM_EXECUTION_DOMAIN_ID, address);
	assert.equal(id, address);
	assert.equal(pool.bytes(id), payload);
	for (const [first, length] of [[1, 4], [4, 2]]) {
		const expected = payload.slice(first, first + length);
		const result = internStringSliceReference(pool, id, first, length);
		assert.equal(pool.bytes(result), expected);
		assert.equal(pool.find(expected), result);
		assert.equal(internStringSliceReference(pool, id, first, length), result);
	}
});

test('a borrowed String stays live through emergency admission of its slice', () => {
	const cpu = createCpu(), pool = cpu.stringPool, heap = cpu.luaHeap, arena = cpu.heapAllocator;
	heap.setCollectionTarget(heap.capacity());
	const input = '\xff\0\x80A'.repeat(32 * 1024);
	const source = pool.intern(input);
	const garbage = 'q'.repeat(96 * 1024), disposable = pool.intern(garbage);
	assert.equal(arena.setFloor(disposable - disposable % HEAP_PAGE_SIZE), true);
	const first = 13, length = garbage.length, remaining = heap.capacity() - heap.usedBytes();
	assert.ok(remaining >= 0 && remaining < BLUA32_STRING_RECORD_HEADER_SIZE + length,
		'the slice needs the quota occupied by the disposable String');
	const result = internStringSliceReference(pool, source, first, length);
	assert.equal(pool.find(garbage), undefined, 'admission actually collected unreachable Strings');
	assert.equal(pool.find(input), source, 'the only root for the source was the borrowed slice');
	assert.equal(pool.bytes(result), input.slice(first, first + length));
	assert.equal(pool.find(input.slice(first, first + length)), result);
	assert.ok(heap.usedBytes() <= heap.capacity());
});

test('collection removes unreachable records from all intern buckets and reuses the same capacity', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	const suffix = 'x'.repeat(512);
	let steadyBytes = 0;
	for (let round = 0; round < 8; round += 1) {
		for (let index = 0; index < 128; index += 1) pool.intern(`garbage-${round}-${index}-${suffix}`);
		const bytes = collectReferenceHeapBytes(cpu);
		if (round === 0) steadyBytes = bytes;
		assert.equal(bytes, steadyBytes);
		for (let index = 0; index < 128; index += 1) assert.equal(pool.find(`garbage-${round}-${index}-${suffix}`), undefined);
	}
});

test('major String sweep rewinds a real bucket chain behind a retained predecessor', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	const names: string[] = [];
	for (let i = 0; names.length < 7; ++i) {
		const name = `chain:${i}`;
		if ((hashText(name) & 63) === 0) names.push(name);
	}
	const ids = names.slice(0, 6).map(name => pool.intern(name));
	pool.beginReachabilityEpoch();
	pool.markReachable(ids[5]); pool.takeMarkWork();
	pool.beginSweep();
	assert.equal(pool.sweepStep(2), 2, 'one bucket and one live header exhaust two physical units');
	assert.equal(pool.find(names[4]), ids[4], 'other records in this same bucket have not been visited');
	const ram = cpu.memory.captureSaveState();
	const finish = () => {
		const fresh = pool.intern(names[6]);
		assert.equal(pool.sweepStep(1), 1, 'resuming the current bucket charges only the next header');
		assert.equal(pool.find(names[4]), undefined);
		assert.equal(pool.find(names[3]), ids[3]);
		for (let step = 0; pool.sweeping() && step < 100; ++step) pool.sweepStep(2);
		assert.equal(pool.sweeping(), false);
		for (const name of names.slice(0, 5)) assert.equal(pool.find(name), undefined);
		assert.equal(pool.find(names[5]), ids[5]);
		assert.equal(pool.find(names[6]), fresh, 'new head does not invalidate the suspended suffix');
		return cpu.memory.captureSaveState();
	};
	const expected = finish();
	cpu.memory.restoreSaveState(ram);
	assert.deepEqual(finish(), expected);
});

test('String admission starts its sweep during an uncharged index resize', () => {
	const cpu = createCpu(), pool = cpu.stringPool, { gc, memory } = cpu;
	const capacity = 8192;
	const roots = createReferenceTable(cpu, capacity, 0), key = pool.intern('String growth root');
	setReferenceGlobal(cpu, key, valueTable(roots));
	const metadata = cpu.heapAllocator.managementOffset() + HEAP_STRING_METADATA_OFFSET;
	const bucketCapacity = () => memory.readRamRecordWord(metadata + 4) & 0x7fffffff;
	const count = capacity - memory.readRamRecordWord(metadata + 8);
	const name = (index: number) => `fill:${index}`;
	for (let i = 0; i < count; ++i) gc.tables.setInteger(roots, i + 1, valueString(pool.intern(name(i))));
	assert.equal(bucketCapacity(), capacity);
	assert.equal(memory.readRamRecordWord(metadata + 8), capacity);
	for (let step = 0; gc.phase() !== GcPhase.Sweep && step < 40; ++step) gc.step();
	assert.equal(gc.phase(), GcPhase.Sweep);
	const ram = memory.captureSaveState(), state = cpu.captureRuntimeState();
	const finish = () => {
		cpu.luaHeap.setCollectionTarget(0);
		const added = pool.intern('growth crosses into Strings');
		assert.equal(bucketCapacity(), capacity);
		assert.equal(gc.phase(), GcPhase.Strings, 'growth does not synchronously drain the new sweep');
		assert.notEqual(memory.readRamRecordWord(metadata + 0x38), 0, 'the destination owner is already reserved');
		assert.ok(memory.readRamRecordWord(metadata + 0x3c) > 0, 'the index moved buckets before admitting the String');
		for (let step = 0; gc.active() && step < 20; ++step) gc.step();
		assert.equal(gc.phase(), GcPhase.Pause);
		assert.equal(bucketCapacity(), 2 * capacity, 'the collection completes the pending resize incrementally');
		assert.equal(pool.find('growth crosses into Strings'), added);
		for (let i = 0; i < count; ++i) assert.equal(pool.find(name(i)), valuePayload(gc.tables.getInteger(roots, i + 1)));
		return memory.captureSaveState();
	};
	const expected = finish();
	memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
	assert.deepEqual(finish(), expected);
});

test('String rehash splits a collision chain across both planes and replays sweep and retirement', () => {
	const cpu = createCpu(), pool = cpu.stringPool, { gc, memory } = cpu;
	const capacity = 4096;
	const roots = createReferenceTable(cpu, 4, 0);
	setReferenceGlobal(cpu, pool.intern('collision rehash root'), valueTable(roots));
	const metadata = cpu.heapAllocator.managementOffset() + HEAP_STRING_METADATA_OFFSET;
	const read = (field: number) => memory.readRamRecordWord(metadata + field);
	let candidate = 0;
	const collision = () => {
		for (;;) {
			const text = `rehash collision ${candidate++}`;
			if ((hashText(text) & (capacity - 1)) === 0) return text;
		}
	};
	const entries = Array.from({ length: capacity - read(8) }, (_, i) => {
		const text = i < 128 ? collision() : `rehash filler ${i}`;
		return { text, id: pool.intern(text) };
	});
	assert.equal(read(4), capacity);
	const oldBase = read(0), trigger = collision();
	const arena = cpu.heapAllocator;
	const logicalBefore = cpu.luaHeap.usedBytes(), physicalBefore = arena.occupiedBytes();
	const inserted = pool.intern(trigger);
	const insertedBytes = BLUA32_STRING_RECORD_HEADER_SIZE + trigger.length;
	assert.equal(cpu.luaHeap.usedBytes(), logicalBefore + insertedBytes, 'only the String costs budget');
	const nextBase = read(0x38);
	assert.notEqual(nextBase, 0);
	assert.equal(arena.occupiedBytes(), physicalBefore + arena.allocationBytes(nextBase) + arena.allocationBytes(inserted));
	assert.equal(read(0x3c), 1, 'the intern yields inside the first long bucket, not after it');
	const survivors = [memory.readRamRecordWord(oldBase), memory.readRamRecordWord(nextBase),
		memory.readRamRecordWord(nextBase + 4 * capacity), inserted];
	assert.ok(survivors.every(id => id !== 0), 'the old chain and both destination chains are populated');
	for (let index = 0; index < survivors.length; ++index) gc.tables.setInteger(roots, index + 1, valueString(survivors[index]));
	for (const { text, id } of entries) assert.equal(pool.find(text), id, 'lookups preserve IDs in each directory');

	let logicalRelease = 0, physicalRelease = arena.allocationBytes(oldBase);
	for (const { text, id } of entries) if (!survivors.includes(id)) {
		const bytes = BLUA32_STRING_RECORD_HEADER_SIZE + text.length;
		logicalRelease += bytes;
		physicalRelease += arena.allocationBytes(id);
	}
	const usage = cpu.luaHeap.usedBytes(), occupied = cpu.heapAllocator.occupiedBytes();
	const archive = new RamHistory(); archive.start(memory);
	const checkpoint = archive.capture(memory, null), state = cpu.captureRuntimeState();
	const finish = () => {
		for (let step = 0; gc.phase() !== GcPhase.Strings && step < 40; ++step) gc.step();
		assert.equal(gc.phase(), GcPhase.Strings);
		assert.equal(read(0x3c), 1, 'sweep visits both planes before moving any more links');
		for (let step = 0; gc.active() && step < 40; ++step) gc.step();
		assert.equal(gc.phase(), GcPhase.Pause);
		assert.equal(read(0), nextBase);
		assert.equal(read(4), 2 * capacity);
		assert.equal(read(0x38), 0);
		assert.equal(pool.find(trigger), inserted);
		for (const { text, id } of entries) assert.equal(pool.find(text), survivors.includes(id) ? id : undefined);
		assert.equal(cpu.luaHeap.usedBytes(), usage - logicalRelease, 'retirement returns only the dead String charges');
		assert.equal(cpu.heapAllocator.occupiedBytes(), occupied - physicalRelease, 'the old directory is physically reclaimed');
		return memory.captureSaveState().ram;
	};
	const expected = finish(), collected = archive.capture(memory, checkpoint);
	archive.restore(memory, collected, checkpoint); cpu.restoreRuntimeState(state);
	assert.deepEqual(finish(), expected, 'rewind reproduces the old and new chain frontiers and allocation bytes');
});

test('sparse String buckets shrink in place and rewind an upper chain mid-merge', () => {
	const cpu = createCpu(), pool = cpu.stringPool, arena = cpu.heapAllocator, memory = cpu.memory;
	const half = HEAP_PAGE_SIZE / 4, capacity = 2 * half;
	const metadata = arena.managementOffset() + HEAP_STRING_METADATA_OFFSET;
	const read = (field: number) => memory.readRamRecordWord(metadata + field);
	let candidate = 0;
	const collision = (bucket: number): string => {
		for (;;) {
			const text = `shrink collision ${candidate++}`;
			if ((hashText(text) & (capacity - 1)) === bucket) return text;
		}
	};
	const names = [0, half, half].map(collision), savedIds = names.map(name => pool.intern(name));
	const freshNames = [half, 0, half + 1].map(collision);
	for (let filler = 0; read(4) !== capacity && filler < capacity; ++filler) pool.intern(`shrink filler ${filler}`);
	assert.equal(read(4), capacity, 'real inserts published a settled bucket directory');
	const base = read(0), upper = base + 4 * half, used = read(8);
	pool.beginReachabilityEpoch();
	pool.markReachable(pool.intern('__mode'));
	for (const id of savedIds) pool.markReachable(id);
	pool.takeMarkWork();
	pool.beginSweep();
	assert.equal(pool.sweepStep(capacity + used), capacity + used);
	assert.equal(read(4), capacity | 0x40000000, 'sweeping only arms the shrink after the last record');
	assert.equal(read(0x3c), 0);
	assert.equal(pool.find('shrink filler 0'), undefined);
	assert.equal(pool.sweepStep(1), 1, 'the next grant moves one upper record');
	assert.equal(read(0x3c), 0);
	const upperSurvivor = memory.readRamRecordWord(upper), moved = memory.readRamRecordWord(base);
	assert.ok(savedIds.includes(upperSurvivor) && savedIds.includes(moved) && upperSurvivor !== moved,
		'the current chain has different survivors on both sides of the merge');

	const archive = new RamHistory(); archive.start(memory);
	const checkpoint = archive.capture(memory, null), state = cpu.captureRuntimeState();
	const finish = () => {
		const freshIds = freshNames.map(name => pool.intern(name));
		assert.equal(memory.readRamRecordWord(upper), upperSurvivor, 'inserts do not prolong the upper chain being drained');
		assert.equal(memory.readRamRecordWord(base), freshIds[1]);
		assert.equal(memory.readRamRecordWord(upper + 4), freshIds[2], 'the next upper bucket is still its own chain');
		for (const [namesToCheck, ids] of [[names, savedIds], [freshNames, freshIds]] as const) {
			for (let i = 0; i < ids.length; ++i) assert.equal(pool.find(namesToCheck[i]), ids[i]);
		}
		const logical = cpu.luaHeap.usedBytes(), physical = arena.occupiedBytes();
		const oldExtent = arena.allocationBytes(base);
		for (let step = 0; pool.sweeping() && step < half; ++step) assert.ok(pool.sweepStep(3) <= 3);
		assert.equal(pool.sweeping(), false);
		assert.equal(read(0), base, 'the lower directory keeps its address');
		assert.equal(read(4), half);
		const newExtent = arena.allocationBytes(base);
		assert.ok(newExtent < oldExtent, 'shrinking returns a chunk suffix to the allocator');
		assert.equal(arena.occupiedBytes(), physical - oldExtent + newExtent);
		assert.equal(cpu.luaHeap.usedBytes(), logical);
		for (const [namesToCheck, ids] of [[names, savedIds], [freshNames, freshIds]] as const) {
			for (let i = 0; i < ids.length; ++i) assert.equal(pool.find(namesToCheck[i]), ids[i]);
		}
		pool.beginSweep();
		assert.equal(pool.sweepStep(capacity + read(8)), half + read(8), 'subsequent sweeps no longer visit the released buckets');
		assert.equal(pool.sweeping(), false);
		return memory.captureSaveState().ram;
	};
	const expected = finish(), collected = archive.capture(memory, checkpoint);
	archive.restore(memory, collected, checkpoint); cpu.restoreRuntimeState(state);
	assert.deepEqual(finish(), expected, 'rewinding mid-merge reproduces chain ownership and page release');
});

test('String index growth is optional when only the requested String fits', () => {
	const cpu = createCpu(), pool = cpu.stringPool, arena = cpu.heapAllocator;
	const capacity = HEAP_PAGE_SIZE / 4;
	const metadata = arena.managementOffset() + HEAP_STRING_METADATA_OFFSET;
	const read = (field: number) => cpu.memory.readRamRecordWord(metadata + field);
	const earlyText = 'unrooted before directory growth', early = pool.intern(earlyText);
	for (let filler = 0; read(8) < capacity; ++filler) pool.intern(`directory filler ${filler}`);
	assert.equal(read(4), capacity);
	const base = read(0);
	const used = cpu.luaHeap.usedBytes(), pending = 'q'.repeat(60);
	const spare = arena.allocate(BLUA32_STRING_RECORD_HEADER_SIZE + pending.length, true);
	assert.notEqual(spare, 0);
	while (arena.allocate(HEAP_PAGE_SIZE, true) !== 0) {}
	arena.free(spare);
	assert.equal(arena.allocate(8 * capacity, true), 0, 'the optional replacement directory cannot fit');
	const id = pool.intern(pending);
	assert.equal(pool.find(pending), id);
	assert.equal(pool.find(earlyText), early, 'no emergency collection ran for the optional directory');
	assert.equal(read(0), base);
	assert.equal(read(4), capacity);
	assert.equal(read(0x38), 0);
	assert.equal(cpu.luaHeap.usedBytes(), used + BLUA32_STRING_RECORD_HEADER_SIZE + pending.length);
});

test('empty strings are interned and then collected like non-empty records', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	const empty = pool.intern('');
	assert.equal(pool.intern(''), empty);
	assert.equal(pool.byteLength(empty), 0);
	cpu.gc.collect();
	assert.equal(pool.find(''), undefined);
});

test('nested materialization scopes retain newly returned IDs only through their owning phase', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	pool.beginLocalRoots();
	const outer = pool.intern('outer string');
	pool.beginLocalRoots();
	const inner = pool.intern('inner string');
	cpu.gc.collect();
	assert.equal(pool.toString(outer), 'outer string');
	assert.equal(pool.toString(inner), 'inner string');
	pool.endLocalRoots();
	cpu.gc.collect();
	assert.equal(pool.find('inner string'), undefined);
	assert.equal(pool.find('outer string'), outer);
	pool.endLocalRoots();
	cpu.gc.collect();
	assert.equal(pool.find('outer string'), undefined);
});

test('RAM restore replays string allocation after partial reuse', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	pool.beginLocalRoots();
	pool.intern('left anchor');
	pool.beginLocalRoots();
	for (const text of ['hole one', 'hole two', 'hole three']) pool.intern(text);
	pool.endLocalRoots();
	pool.intern('right anchor');
	cpu.gc.collect();
	pool.intern('partially reused');
	pool.endLocalRoots();
	const ram = cpu.memory.captureSaveState();
	const names = ['future one', 'future two', 'future three'];
	const expected = names.map(text => pool.intern(text));
	const expectedRam = cpu.memory.captureSaveState();
	cpu.memory.restoreSaveState(ram);
	assert.deepEqual(names.map(text => pool.intern(text)), expected);
	assert.deepEqual(cpu.memory.captureSaveState(), expectedRam);
});

test('reusing an unreachable deleted string-key ID cannot resurrect its old mapping', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	const root = pool.intern('table root'), table = createReferenceTable(cpu, 0, 8);
	setReferenceGlobal(cpu, root, valueTable(table));
	const removed = pool.intern('removed key');
	cpu.gc.tables.setStringKey(table, removed, valueInteger(19));
	cpu.gc.tables.setStringKey(table, removed, valueNil());
	const retained = pool.intern('retained key');
	cpu.gc.tables.setStringKey(table, retained, valueInteger(23));
	cpu.gc.collect();
	assert.equal(pool.find('removed key'), undefined);
	const replacement = pool.intern('replacement key');
	assert.equal(cpu.gc.tables.getStringKey(table, replacement), valueNil());
	cpu.gc.tables.setStringKey(table, replacement, valueInteger(29));
	assert.equal(cpu.gc.tables.get(table, valueString(replacement)), valueInteger(29));
	assert.equal(cpu.gc.tables.getStringKey(table, retained), valueInteger(23));
	const entry = new ValueSlots(2), keys: string[] = [];
	for (cpu.gc.tables.next(table, entry.get(0), entry, 0); entry.getTag(0) !== ValueTag.Nil;
		cpu.gc.tables.next(table, entry.get(0), entry, 0)) {
		assert.equal(entry.getTag(0), ValueTag.String);
		keys.push(pool.toString(entry.getStringId(0)));
	}
	assert.deepEqual(keys.sort(), ['replacement key', 'retained key']);
});


test('long byte strings are reclaimed before an ID is reused', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	cpu.gc.collect();
	const baseline = cpu.luaHeap.usedBytes(), physical = cpu.heapAllocator.occupiedBytes();
	const text = textToByteString('β😀A🚀\0é'.repeat(23));
	const old = pool.intern(text);
	const bytes = BLUA32_STRING_RECORD_HEADER_SIZE + text.length;
	assert.equal(cpu.luaHeap.usedBytes(), baseline + bytes);
	assert.equal(cpu.heapAllocator.occupiedBytes(), physical + cpu.heapAllocator.allocationBytes(old));
	assert.equal(pool.byteAt(old, 128), text.charCodeAt(128));
	cpu.gc.collect();
	assert.equal(cpu.luaHeap.usedBytes(), baseline);
	assert.equal(cpu.heapAllocator.occupiedBytes(), physical);
	assert.equal(pool.find(text), undefined);
	const id = pool.intern(textToByteString('😀'.repeat(65)));
	assert.equal(pool.byteAt(id, 64), 0xf0);
	cpu.gc.collect();
	assert.equal(pool.byteAt(pool.intern('ascii'), 4), 105);
});

test('activation interns matching bytes across RAM and ROM sockets in activation order', () => {
	const text = new Uint8Array(4), functions = [{ firstWord: 0, wordCount: 1 }];
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	const system = { text, functions, constants: ['system key'] };
	const first = linkRawTestBlua32Pair(system, { text, functions, constants: ['two sockets', 'system key', 'first only'] });
	const second = linkRawTestBlua32Pair(system, { text, functions, constants: ['two sockets', 'existing RAM', 'second only'] });
	const memory = new Memory({ systemRom: first.systemRomBytes, cartridgeSlots: cartridgeSlots(first.cartRomBytes, second.cartRomBytes) }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory)), pool = cpu.stringPool;
	cpu.reset();
	const bios = pool.find('system key'), ram = pool.intern('existing RAM');
	cpu.writeFrameExecution(0, 1, second.cartImage.functions[0].address, second.cartImage.header.textAddress);
	const socket1 = pool.find('two sockets')!;
	assert.equal(socket1 >>> 31, 1, 'the first activated cartridge is socket 1');
	assert.equal(pool.find('existing RAM'), ram);
	cpu.writeFrameExecution(0, 0, first.cartImage.functions[0].address, first.cartImage.header.textAddress);
	assert.equal(pool.intern('two sockets'), socket1);
	assert.equal(pool.intern('system key'), bios);
	assert.equal(pool.find('first only')! >>> 31, 0);
	assert.equal(pool.find('second only')! >>> 31, 1);
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, first.systemImage.functions[0].address, first.systemImage.header.textAddress);

	// Restoring a checkpoint during collection must not publish a new table
	// or mark a RAM record merely by rebuilding the decoded image.
	cpu.gc.step();
	const checkpoint = cpu.captureRuntimeState(), state = memory.captureSaveState();
	cpu.gc.collect();
	assert.equal(pool.find('existing RAM'), ram, 'the resident image owns its original RAM String');
	memory.restoreSaveState(state);
	cpu.restoreRuntimeState(checkpoint);
	assert.deepEqual(memory.captureSaveState(), state);
	cpu.gc.collect();
	assert.equal(pool.find('existing RAM'), ram, 'restored image retains the same RAM String through a fresh epoch');
	assert.equal(pool.intern('two sockets'), socket1);
});
