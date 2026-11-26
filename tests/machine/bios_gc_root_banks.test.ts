import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_ROOT_CURSOR, GC_TRACE_HEAD, GcRootBank } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_COLOR_OFFSET, GC_RECORD_MASK, GC_RECORD_SHIFT } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { type Value, valueInteger, valuePayload, valueString, valueTable, valueTag } from '../../machine/ts/machine/cpu/value';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_VALUE_COUNT } from '../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestBlua32Pair, linkTestSystemBlua32 } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';
import { captureCpuCheckpoint, restoreCpuCheckpoint } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';

const ROOTS = 'kernel/gc_root_banks', entrySource = 'halt_until_irq';
const modules = ['kernel/dlmalloc', 'kernel/gc_control', 'kernel/gc_strings', 'kernel/gc_mark', ROOTS].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});

const CURSOR_BITS = 20, BANK_BYTES = 16, THREAD_BYTES = 16, DESCRIPTOR_BYTES = THREAD_BYTES + BANK_BYTES * 7;
function fixture(optLevel: 0 | 3) {
	const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	const { slotName } = object.sections.rodata.moduleExports.find(entry => entry.path === ROOTS && entry.exportPathKey === 'trace_root_banks')!;
	const root = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[slotName]);
	assert.ok(root >= 0);
	const entry = linked.image.functions[root].address;
	const { valueSlots, frames } = deriveBlua32FixedStack(linked.image, [root]);
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

	// Test-only publication of the native-owned spans. Globals already have
	// a physical backing and the descriptors simply refer to the live lanes.
	const locations = equal(target => {
		const descriptor = target.heapAllocator.allocate(DESCRIPTOR_BYTES, true);
		assert.ok(descriptor);
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
		for (const [slot, address] of [target.rootThread.address, active, completionThread, halted].entries())
			ram.writeRamRecordWord(descriptor + 4 * slot, address);

		function bind(kind: GcRootBank, count: number, words: number, tags: number, names: number) {
			const address = descriptor + THREAD_BYTES + (kind - GcRootBank.SystemGlobals) * BANK_BYTES;
			assert.equal(count, target.rootBankSlots(kind));
			for (const [i, value] of [count, words, tags, names].entries()) ram.writeRamRecordWord(address + 4 * i, value);
		}
		function publish(kind: GcRootBank, values: readonly Value[], first: number) {
			const base = target.heapAllocator.allocate(values.length * 5, true);
			assert.ok(base);
			const tags = base + 4 * values.length;
			for (const [slot, value] of values.entries()) {
				ram.writeRamRecordWord(base + 4 * slot, valuePayload(value));
				ram.writeRamRecordByte(tags + slot, valueTag(value));
			}
			bind(kind, values.length - first, base + 4 * first, tags + first, 0);
		}
		for (const [kind, bank] of [[GcRootBank.SystemGlobals, target['systemGlobalBank']],
			[GcRootBank.Globals, target['globalBank']]] as const) {
			const { base, capacity, count } = bank.captureState();
			bind(kind, count, base + 12 * capacity, base + 16 * capacity, base);
		}
		bind(GcRootBank.SystemConstants, 0, 0, 0, 0);
		for (const slot of [0, 1] as const) {
			const roots = target['executionImageForDomain'](slot)!.constantStringRoots;
			const base = target.heapAllocator.allocate(4 * roots.length, true);
			assert.ok(base);
			for (const [index, id] of roots.entries()) ram.writeRamRecordWord(base + 4 * index, id);
			bind(GcRootBank.Cart0Constants + slot, roots.length, base, 0, 0);
		}
		publish(GcRootBank.Completion, finished, 0);
		publish(GcRootBank.ConcatOperands, concat, 1);
		target.stringPool.takeMarkWork();
		target.stringPool.beginReachabilityEpoch();
		return { descriptor, rootThread: target.rootThread.address };
	});

	function setCursor(kind: GcRootBank, next = 0) {
		for (const target of [cpu, oracle]) target.memory.writeRamRecordWord(control + GC_ROOT_CURSOR, (kind << CURSOR_BITS) | next);
	}
	function begin(limit: number, work: number, stop: GcRootBank) {
		assert.ok(cpu.beginHeapService(entry, [control, arena, metadata, locations.descriptor - RAM_BASE, limit, work, stop, 0]));
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
	return { cpu, oracle, memory, cursor, depth, index, marked, name, nameSlot, first, consumed, unread, halted,
		unreadTable, constants, setCursor, begin, grant, finish, step, compare };
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
}
