import { textToByteString } from '../../machine/ts/common/byte_string';
import { hashText } from '../../machine/ts/common/hash';
import assert from 'node:assert/strict';
import test from 'node:test';
import { HEAP_STRING_METADATA_OFFSET, heapAllocationBytes } from '../../machine/ts/machine/cpu/heap_allocator';
import { GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { BLUA32_STRING_RECORD_HEADER_SIZE, BLUA32_STRING_RECORD_KIND } from '../../machine/ts/spec/blua32/image_format';
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
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';

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

test('collection removes unreachable records from all intern buckets and reuses the same capacity', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	const suffix = 'x'.repeat(512);
	let steadyBytes = 0;
	for (let round = 0; round < 8; round += 1) {
		for (let index = 0; index < 128; index += 1) pool.intern(`garbage-${round}-${index}-${suffix}`);
		const bytes = cpu.collectTrackedHeapBytes();
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

test('intern growth admitted into String sweep does not invalidate the original cursor', () => {
	const cpu = createCpu(), pool = cpu.stringPool, { gc, memory } = cpu;
	const capacity = 8192;
	const roots = cpu.createTable(capacity, 0), key = pool.intern('String growth root');
	cpu.setGlobalByKey(key, valueTable(roots));
	const metadata = cpu.heapAllocator.managementOffset() + HEAP_STRING_METADATA_OFFSET;
	const bucketCapacity = () => memory.readRamRecordWord(metadata + 4) & 0x7fffffff;
	const count = capacity - memory.readRamRecordWord(metadata + 8);
	const name = (index: number) => `fill:${index}`;
	for (let i = 0; i < count; ++i) gc.tables.setInteger(roots, i + 1, valueString(pool.intern(name(i))));
	assert.equal(bucketCapacity(), capacity);
	assert.equal(memory.readRamRecordWord(metadata + 8), capacity);
	for (let step = 0; gc.phase() !== GcPhase.Sweep && step < 40; ++step) gc.step();
	assert.equal(gc.phase(), GcPhase.Sweep);
	gc.step(); gc.step();
	assert.equal(gc.phase(), GcPhase.Sweep, 'the last object page is reached by the growth admission');
	const ram = memory.captureSaveState(), state = cpu.captureRuntimeState();
	const finish = () => {
		cpu.luaHeap.setCollectionTarget(0);
		const added = pool.intern('growth crosses into Strings');
		assert.equal(bucketCapacity(), capacity);
		assert.equal(gc.phase(), GcPhase.Strings, 'growth does not synchronously drain the new sweep');
		assert.notEqual(memory.readRamRecordWord(metadata + 0x38), 0, 'the destination owner is already reserved');
		assert.equal(memory.readRamRecordWord(metadata + 0x3c), 0, 'no bucket changes owner during the sweep');
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
	const roots = cpu.createTable(4, 0);
	cpu.setGlobalByKey(pool.intern('collision rehash root'), valueTable(roots));
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
	const oldBase = read(0), trigger = collision(), inserted = pool.intern(trigger);
	const nextBase = read(0x38);
	assert.notEqual(nextBase, 0);
	assert.equal(read(0x3c), 1, 'the intern yields inside the first long bucket, not after it');
	const survivors = [memory.readRamRecordWord(oldBase), memory.readRamRecordWord(nextBase),
		memory.readRamRecordWord(nextBase + 4 * capacity), inserted];
	assert.ok(survivors.every(id => id !== 0), 'the old chain and both destination chains are populated');
	for (let index = 0; index < survivors.length; ++index) gc.tables.setInteger(roots, index + 1, valueString(survivors[index]));
	for (const { text, id } of entries) assert.equal(pool.find(text), id, 'lookups preserve IDs in each directory');

	let logicalRelease = 4 * capacity, physicalRelease = heapAllocationBytes(logicalRelease);
	for (const { text, id } of entries) if (!survivors.includes(id)) {
		const bytes = BLUA32_STRING_RECORD_HEADER_SIZE + text.length;
		logicalRelease += bytes;
		physicalRelease += heapAllocationBytes(bytes);
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
		assert.equal(cpu.luaHeap.usedBytes(), usage - logicalRelease, 'retirement returns the old index and dead String charges');
		assert.equal(cpu.heapAllocator.occupiedBytes(), occupied - physicalRelease, 'the old directory is physically reclaimed');
		return memory.captureSaveState().ram;
	};
	const expected = finish(), collected = archive.capture(memory, checkpoint);
	archive.restore(memory, collected, checkpoint); cpu.restoreRuntimeState(state);
	assert.deepEqual(finish(), expected, 'rewind reproduces the old and new chain frontiers and allocation bytes');
});

test('empty strings are interned and then collected like non-empty records', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	const empty = pool.intern('');
	assert.equal(pool.intern(''), empty);
	assert.equal(pool.byteLength(empty), 0);
	cpu.collectTrackedHeapBytes();
	assert.equal(pool.find(''), undefined);
});

test('nested materialization scopes retain newly returned IDs only through their owning phase', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	pool.beginLocalRoots();
	const outer = pool.intern('outer string');
	pool.beginLocalRoots();
	const inner = pool.intern('inner string');
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

test('RAM restore replays string allocation after partial reuse', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	pool.beginLocalRoots();
	pool.intern('left anchor');
	pool.beginLocalRoots();
	for (const text of ['hole one', 'hole two', 'hole three']) pool.intern(text);
	pool.endLocalRoots();
	pool.intern('right anchor');
	cpu.collectTrackedHeapBytes();
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
	const root = pool.intern('table root'), table = cpu.createTable(0, 8);
	cpu.setGlobalByKey(root, valueTable(table));
	const removed = pool.intern('removed key');
	cpu.gc.tables.setStringKey(table, removed, valueInteger(19));
	cpu.gc.tables.setStringKey(table, removed, valueNil());
	const retained = pool.intern('retained key');
	cpu.gc.tables.setStringKey(table, retained, valueInteger(23));
	cpu.collectTrackedHeapBytes();
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
	cpu.collectTrackedHeapBytes();
	const baseline = cpu.luaHeap.usedBytes(), physical = cpu.heapAllocator.occupiedBytes();
	const text = textToByteString('β😀A🚀\0é'.repeat(23));
	const old = pool.intern(text);
	const bytes = BLUA32_STRING_RECORD_HEADER_SIZE + text.length;
	assert.equal(cpu.luaHeap.usedBytes(), baseline + bytes);
	assert.equal(cpu.heapAllocator.occupiedBytes(), physical + heapAllocationBytes(bytes));
	assert.equal(pool.byteAt(old, 128), text.charCodeAt(128));
	cpu.collectTrackedHeapBytes();
	assert.equal(cpu.luaHeap.usedBytes(), baseline);
	assert.equal(cpu.heapAllocator.occupiedBytes(), physical);
	assert.equal(pool.find(text), undefined);
	const id = pool.intern(textToByteString('😀'.repeat(65)));
	assert.equal(pool.byteAt(id, 64), 0xf0);
	cpu.collectTrackedHeapBytes();
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
	memory.restoreSaveState(state);
	cpu.restoreRuntimeState(checkpoint);
	assert.deepEqual(memory.captureSaveState(), state);
	assert.equal(pool.intern('two sockets'), socket1);
	assert.equal(pool.intern('existing RAM'), ram);
});
