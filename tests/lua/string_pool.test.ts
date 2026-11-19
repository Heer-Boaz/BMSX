import { textToByteString } from '../../machine/ts/common/byte_string';
import assert from 'node:assert/strict';
import test from 'node:test';
import { heapAllocationBytes } from '../../machine/ts/machine/cpu/heap_allocator';
import { BLUA32_STRING_RECORD_HEADER_SIZE, BLUA32_STRING_RECORD_KIND } from '../../machine/ts/spec/blua32/image_format';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { ValueTag, valueNil, valueInteger, valueTable, valueString } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { Memory } from '../../machine/ts/machine/memory/memory';
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
	const state = cpu.luaHeap.captureState(), ram = cpu.memory.captureSaveState();
	const names = ['future one', 'future two', 'future three'];
	const expected = names.map(text => pool.intern(text));
	const expectedRam = cpu.memory.captureSaveState();
	cpu.memory.restoreSaveState(ram);
	cpu.luaHeap.restoreState(state);
	assert.deepEqual(names.map(text => pool.intern(text)), expected);
	assert.deepEqual(cpu.memory.captureSaveState(), expectedRam);
});

test('reusing an unreachable deleted string-key ID cannot resurrect its old mapping', () => {
	const cpu = createCpu(), pool = cpu.stringPool;
	const root = pool.intern('table root'), table = cpu.createTable(0, 8);
	cpu.setGlobalByKey(root, valueTable(cpu.gc.reference(table)));
	const removed = pool.intern('removed key');
	table.records.setStringKey(table.address, removed, valueInteger(19));
	table.records.setStringKey(table.address, removed, valueNil());
	const retained = pool.intern('retained key');
	table.records.setStringKey(table.address, retained, valueInteger(23));
	cpu.collectTrackedHeapBytes();
	assert.equal(pool.find('removed key'), undefined);
	const replacement = pool.intern('replacement key');
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
	const baseline = cpu.luaHeap.usedBytes();
	const text = textToByteString('β😀A🚀\0é'.repeat(23));
	const old = pool.intern(text);
	assert.equal(cpu.luaHeap.usedBytes(), baseline + heapAllocationBytes(BLUA32_STRING_RECORD_HEADER_SIZE + text.length));
	assert.equal(pool.byteAt(old, 128), text.charCodeAt(128));
	cpu.collectTrackedHeapBytes();
	assert.equal(cpu.luaHeap.usedBytes(), baseline);
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
