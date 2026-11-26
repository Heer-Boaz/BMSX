import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_ROOT_CURSOR, GC_TRACE_HEAD, GcRootBank } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_COLOR_OFFSET, GC_RECORD_MASK, GC_RECORD_SHIFT } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { valueInteger, valuePayload, valueString, valueTable, valueTag } from '../../machine/ts/machine/cpu/value';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { Memory } from '../../machine/ts/machine/memory/memory';
import {
	HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_ROOT_BANKS_OFFSET, HEAP_SERVICE_ROOT_BANKS_SIZE, HEAP_SERVICE_ROOT_PORT_BASE,
	HEAP_SERVICE_ROOT_PORT_STRIDE, HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_VALUE_COUNT, HeapServiceRootPlane,
} from '../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestBlua32Pair, linkTestSystemBlua32 } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';
import { captureCpuCheckpoint, restoreCpuCheckpoint } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';

const ROOTS = 'kernel/gc_root_banks', PORT = 'test/gc_root_port', entrySource = 'halt_until_irq';
const modules = ['kernel/dlmalloc', 'kernel/gc_control', 'kernel/gc_strings', 'kernel/gc_mark', ROOTS].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});
const portSource = `module<const>
local read_byte<const> = function(address)
	local byte<const>: *u8 = address
	return *byte
end
local write_word<const> = function(address)
	local word<const>: *u32 = address
	*word = 0
end
return { read_byte = read_byte, write_word = write_word }
`;
modules.push({ path: PORT, source: portSource, chunk: parseLuaChunk(portSource, PORT) });

const CURSOR_BITS = 20;
function fixture(optLevel: 0 | 3) {
	const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	function entryIndex(path: string, key: string) {
		const { slotName } = object.sections.rodata.moduleExports.find(entry => entry.path === path && entry.exportPathKey === key)!;
		const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[slotName]);
		assert.ok(index >= 0);
		return index;
	}
	const root = entryIndex(ROOTS, 'trace_root_banks');
	const readByte = entryIndex(PORT, 'read_byte'), writeWord = entryIndex(PORT, 'write_word');
	const entry = linked.image.functions[root].address;
	const { valueSlots, frames } = deriveBlua32FixedStack(linked.image, [root, readByte, writeWord]);
	assert.ok(valueSlots <= HEAP_SERVICE_VALUE_COUNT && frames <= HEAP_SERVICE_FRAME_COUNT, `pinned stack: ${valueSlots} values, ${frames} frames`);
	const cart = (entrySource: string) => linkTestBlua32Pair(compiled,
		compileLuaChunkToProgram(parseLuaChunk(entrySource), [], { entrySource, optLevel })).cartRomBytes;
	const cart0 = cart("return 'retained cart0 one', 42, 'retained cart0 two', 'cart0 ROM only'");
	const cart1 = cart("return 'retained cart1', 'cart1 ROM only'");

	function makeCpu() {
		const memory = new Memory({ systemRom: linked.romBytes, cartridgeSlots: cartridgeSlots(cart0, cart1) }, PSX_MACHINE_SPEC.ramBytes);
		const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
		cpu.reset();
		assert.equal(cpu.runUntilDepth(0, 1024), RunResult.Halted);
		return cpu;
	}
	const cpu = makeCpu(), oracle = makeCpu(), memory = cpu.memory;
	const management = cpu.heapAllocator.managementOffset(), arena = cpu.heapAllocator.allocatorStateOffset();
	const control = management + HEAP_GC_CONTROL_OFFSET, metadata = management + HEAP_STRING_METADATA_OFFSET;
	const floor = memory.ramBusEnd() - RAM_BASE, last = management + HEAP_SERVICE_THREAD_OFFSET;
	function compare(label: string) {
		const actual = memory.ramData().subarray(floor, last), expected = oracle.memory.ramData().subarray(floor, last);
		if (Buffer.compare(actual, expected) === 0) return;
		const offset = actual.findIndex((byte, i) => byte !== expected[i]);
		assert.equal(actual[offset], expected[offset], `${label}: RAM 0x${(floor + offset).toString(16)}`);
	}
	function equal<T>(make: (target: CPU) => T): T {
		const result = make(cpu);
		assert.deepEqual(make(oracle), result);
		return result;
	}
	function string(text: string) {
		const id = equal(target => target.stringPool.intern(text));
		assert.ok(id >= RAM_BASE);
		return id;
	}
	const constants = ['retained cart0 one', 'retained cart0 two', 'retained cart1'].map(string);
	for (const slot of [0, 1] as const)
		equal(target => [...target['executionImageForDomain'](slot)!.constantStringRoots]);
	assert.equal(cpu.rootBankSlots(GcRootBank.SystemConstants), 0);
	assert.equal(cpu.rootBankSlots(GcRootBank.Cart0Constants), 2);
	assert.equal(cpu.rootBankSlots(GcRootBank.Cart1Constants), 1);

	const name = string('system variable'), first = string('system root Value');
	const table = equal(target => target.createTable(1, 0)), otherTable = equal(target => target.createTable(0, 1));
	const active = equal(target => target.createThread(0)), completionThread = equal(target => target.createThread(0));
	const halted = equal(target => target.createThread(0));
	for (const [kind, key, value] of [
		[GcRootBank.SystemGlobals, name, valueString(first)],
		[GcRootBank.SystemGlobals, string('second system variable'), valueTable(table)],
		[GcRootBank.Globals, string('cart root'), valueTable(otherTable)],
		[GcRootBank.Globals, string('same key and Value'), valueString(string('same key and Value'))],
	] as const) {
		equal(target => {
			const bank = kind === GcRootBank.SystemGlobals ? target['systemGlobalBank'] : target['globalBank'];
			const slot = bank.registerName(key);
			bank.writeSlot(slot, value);
			return slot;
		});
	}
	const finished = [valueString(string('returned String')), valueTable(table), valueInteger(19)];
	const consumed = string('already consumed'), unread = string('unread concat');
	const unreadTable = equal(target => target.createTable(0, 0));
	const concat = [valueString(consumed), valueTable(unreadTable), valueString(unread), valueInteger(5)];

	const descriptor = management + HEAP_SERVICE_ROOT_BANKS_OFFSET;
	equal(target => {
		const ram = target.memory;
		target.activeThread = target.bindThread(active);
		target['completionThread'] = completionThread;
		target['haltedUntilIrqThread'] = halted;
		const result = new ValueSlots(finished.length);
		for (const [slot, value] of finished.entries()) result.setEncoded(slot, valueTag(value), valuePayload(value));
		target['latchCompletionValues'](result, 0, finished.length);
		target['concat'].restore({
			nextRegister: 0, registersLeft: 0, length: 3, instructionPc: 0, destination: 0, source: 1, offset: 0,
			hash: 0, values: concat, lengths: [1, 1, 1, 1], bytes: new Uint8Array(1),
		});
		const occupied = target.heapAllocator.occupiedBytes(), charged = target.luaHeap.usedBytes();
		const descriptorEnd = descriptor + HEAP_SERVICE_ROOT_BANKS_SIZE;
		const before = ram.ramData().slice(floor, descriptor);
		const after = ram.ramData().slice(descriptorEnd, last);
		target.publishHeapRootBanks();
		assert.equal(target.heapAllocator.occupiedBytes(), occupied);
		assert.equal(target.luaHeap.usedBytes(), charged);
		assert.deepEqual(ram.ramData().subarray(floor, descriptor), before);
		assert.deepEqual(ram.ramData().subarray(descriptorEnd, last), after);
		target.stringPool.takeMarkWork();
		target.stringPool.beginReachabilityEpoch();
	});

	function setCursor(kind: GcRootBank, next = 0) {
		for (const target of [cpu, oracle]) target.memory.writeRamRecordWord(control + GC_ROOT_CURSOR, (kind << CURSOR_BITS) | next);
	}
	function begin(limit: number, work: number, stop: GcRootBank) {
		assert.ok(cpu.beginHeapService(entry, [control, arena, metadata, descriptor, limit, work, stop, 0]));
	}
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		const spent = cycles - cpu.instructionBudgetRemaining;
		assert.ok(spent > 0);
		return spent;
	}
	function finish() {
		let cycles = 0;
		for (let i = 0; i < 16 && cpu.heapServiceActive(); ++i) cycles += grant(512);
		assert.equal(cpu.heapServiceActive(), false);
		return cycles;
	}
	function step(limit: number, work: number, stop: GcRootBank) {
		begin(limit, work, stop);
		finish();
		assert.equal(cpu.heapServiceResult(), oracle.gc['traceRootBanks'](limit, work, stop));
		compare(`limit=${limit}, initial=${work}, stop=${stop}`);
	}
	const nameSlot = cpu['systemGlobalBank'].find(name)!;
	const cursor = () => memory.readRamRecordWord(control + GC_ROOT_CURSOR);
	const depth = () => memory.readRamRecordWord(control + GC_TRACE_HEAD);
	const index = (address: number) => (address & GC_RECORD_MASK) >>> GC_RECORD_SHIFT;
	function marked(id: number) {
		return (memory.readRamRecordByte(id + 1) & 1) === (memory.readRamRecordWord(metadata + 12) & 1);
	}
	function beginPort(operation: 'read_byte' | 'write_word', address: number) {
		const index = operation === 'read_byte' ? readByte : writeWord;
		assert.ok(cpu.beginHeapService(linked.image.functions[index].address, [address]));
	}
	return { cpu, oracle, memory, cursor, depth, index, marked, name, nameSlot, first, consumed, unread, halted,
		unreadTable, constants, setCursor, begin, beginPort, grant, finish, step, compare };
}

for (const optLevel of [0, 3] as const) {
	test(`BLua root banks match native name/Value order, counts, and overshooting work at O${optLevel}`, () => {
		const f = fixture(optLevel);
		f.setCursor(GcRootBank.SystemGlobals, f.nameSlot);
		f.step(2, 2, GcRootBank.ConcatOperands);
		assert.equal(f.cursor(), (GcRootBank.SystemGlobals << CURSOR_BITS) | f.nameSlot);
		assert.equal(f.marked(f.name), false);
		f.step(1, 0, GcRootBank.ConcatOperands);
		assert.equal(f.cpu.heapServiceResult(), 5, 'one global name and one String Value cross the one-word allowance');
		assert.ok(f.marked(f.name) && f.marked(f.first));
		assert.equal(f.cursor(), (GcRootBank.SystemGlobals << CURSOR_BITS) | (f.nameSlot + 1));
		for (let i = 0; i < 64 && f.cursor() !== 0; ++i) f.step(4 + i % 4, i % 3, GcRootBank.ConcatOperands);
		assert.equal(f.cursor(), 0);
		assert.equal(f.depth(), f.index(f.halted), 'halted Thread is marked after root, active, and completion Threads');
		assert.ok(f.constants.every(f.marked));
		assert.equal(f.marked(f.consumed), false);
		assert.equal(f.marked(f.unread), false, 'nonfinal pass stops before unread concat');
		f.setCursor(GcRootBank.ConcatOperands);
		f.step(1, 0, GcRootBank.End);
		assert.equal(f.cursor(), (GcRootBank.ConcatOperands << CURSOR_BITS) | 1);
		assert.equal(f.cpu.heapServiceResult(), 1, 'unread numeric/non-String slots still count');
		assert.equal(f.memory.readRamRecordByte(f.unreadTable + GC_COLOR_OFFSET) & 3, f.cpu.gc.white());
		f.step(16, 4, GcRootBank.End);
		assert.equal(f.cursor(), 0);
		assert.equal(f.marked(f.consumed), false);
		assert.equal(f.marked(f.unread), true);
	});

	test(`BLua root banks resume between the name mark and Value mark at O${optLevel}`, () => {
		const f = fixture(optLevel);
		f.setCursor(GcRootBank.SystemGlobals, f.nameSlot);
		assert.ok(!f.marked(f.name) && !f.marked(f.first));
		f.begin(3, 0, GcRootBank.End);
		for (let i = 0; i < 512 && !f.marked(f.name); ++i) f.grant(1);
		assert.ok(f.cpu.heapServiceActive());
		assert.ok(f.marked(f.name));
		assert.equal(f.marked(f.first), false, 'the Value edge has not issued');
		assert.equal(f.cursor(), (GcRootBank.SystemGlobals << CURSOR_BITS) | (f.nameSlot));
		const checkpoint = captureCpuCheckpoint(f.cpu);
		const cycles = f.finish();
		assert.equal(f.cpu.heapServiceResult(), f.oracle.gc['traceRootBanks'](3, 0, GcRootBank.End));
		f.compare('name → Value');
		restoreCpuCheckpoint(f.cpu, checkpoint);
		assert.equal(f.finish(), cycles);
		f.compare('restored name → Value');
	});

	test(`BLua root-bank rewind reloads the live Concat operand owner at O${optLevel}`, () => {
		const f = fixture(optLevel);
		f.setCursor(GcRootBank.ConcatOperands, 1);
		f.begin(1, 0, GcRootBank.End);
		f.grant(1);
		assert.equal(f.cpu.heapServiceActive(), true);
		assert.equal(f.marked(f.unread), false);
		const checkpoint = captureCpuCheckpoint(f.cpu);
		const cycles = f.finish();
		assert.equal(f.cpu.heapServiceResult(), f.oracle.gc['traceRootBanks'](1, 0, GcRootBank.End));
		assert.equal(f.marked(f.unread), true);
		assert.equal(f.marked(f.consumed), false);
		f.compare('borrowed Concat operand');

		f.cpu['concat'].restore(null);
		restoreCpuCheckpoint(f.cpu, checkpoint);
		assert.equal(f.finish(), cycles);
		f.compare('restored Concat operand');
	});
}

for (const operation of ['read_byte', 'write_word'] as const) {
	test(`CPU-private root port rejects ${operation} on a compact constant word`, () => {
		const f = fixture(0);
		const address = HEAP_SERVICE_ROOT_PORT_BASE + HeapServiceRootPlane.Cart0Constants * HEAP_SERVICE_ROOT_PORT_STRIDE;
		assert.equal(f.memory.isReadableMainMemoryRange(address, 4), false, 'ordinary bus has no root plane');
		f.beginPort(operation, address);
		assert.throws(() => f.finish(), operation === 'read_byte' ? /outside its root port/ : /outside its private RAM port/);
	});
}
