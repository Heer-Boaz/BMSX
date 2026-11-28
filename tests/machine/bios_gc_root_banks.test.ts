import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { registerReferenceGlobalName, writeReferenceGlobalSlot } from '../helpers/global_bank_reference';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { IMAGE_STRING_RAM_ORDINAL, loadImageStringBinding } from '../../machine/ts/machine/cpu/execution_image';
import { isRamStringId } from '../../machine/ts/machine/cpu/string_pool';
import { executionImageBindingOffset, EXECUTION_IMAGE_BINDING_RAM_STRINGS_OFFSET, EXECUTION_IMAGE_BINDING_STRINGS_OFFSET, GLOBAL_BANK_OFFSET, GlobalBankField, SYSTEM_GLOBAL_BANK_OFFSET } from '../../machine/ts/spec/blua32/execution_domain';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_ROOT_CURSOR, GC_TRACE_HEAD, GcRootBank } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_RECORD_MASK, GC_RECORD_SHIFT } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { valueInteger, valuePayload, valueString, valueTable, valueTag } from '../../machine/ts/machine/cpu/value';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { HEAP_SERVICE_ROOT_PORT_BASE } from '../../machine/ts/spec/bmsx/heap_service';
import { CPU_FIXED_FRAME_COUNT, CPU_FIXED_VALUE_COUNT, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_ROOT_BANKS_OFFSET, GC_ROOT_BANKS_SIZE, GC_WORKSPACE_END, storeImageStringBinding } from '../helpers/firmware_heap_layout';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestBlua32Pair, linkTestSystemBlua32 } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { admitTestHeapServiceCpu, compileTestSystemWithHeap } from '../helpers/heap_service_system';
import { allocateThreadRecordReference } from '../helpers/thread_allocation_reference';

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
const RETAINED_CART_STRINGS = ['retained cart0 one', 'retained cart0 two', 'retained cart1'];
function fixture(optLevel: 0 | 3, moved: GcRootBank.SystemGlobals | GcRootBank.Globals | null = null) {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
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
	assert.ok(valueSlots <= CPU_FIXED_VALUE_COUNT && frames <= CPU_FIXED_FRAME_COUNT, `pinned stack: ${valueSlots} values, ${frames} frames`);
	const cart = (entrySource: string) => linkTestBlua32Pair(compiled,
		compileLuaChunkToProgram(parseLuaChunk(entrySource), [], { entrySource, optLevel })).cartRomBytes;
	const cart0 = cart("return 'retained cart0 one', 42, 'retained cart0 two', 'cart0 ROM only'");
	const cart1 = cart("return 'retained cart1', 'cart1 ROM only'");

	function makeCpu() {
		const memory = new Memory({ systemRom: linked.romBytes, cartridgeSlots: cartridgeSlots(cart0, cart1) }, PSX_MACHINE_SPEC.ramBytes);
		const addressSpace = new ExecutionAddressSpace(memory);
		const cpu = new CPU(memory, new IrqController(memory), addressSpace);
		cpu.reset();
		admitTestHeapServiceCpu(cpu, addressSpace);
		// Intern the retained Strings before admitting either mounted image: its
		// constant binding reuses the existing RAM identity, not the ROM literal.
		for (const literal of RETAINED_CART_STRINGS) nativeHeapReference(cpu).stringPool.intern(literal);
		cpu.replaceExecutionImages([addressSpace.resolveDomain(0)!, addressSpace.resolveDomain(1)!]);
		runGuestToHalt(cpu, 10_000);
		return cpu;
	}
	const cpu = makeCpu(), oracle = makeCpu(), memory = cpu.memory;
	const management = cpu.heapAllocator.managementOffset(), arena = cpu.heapAllocator.allocatorStateOffset();
	const control = management + HEAP_GC_CONTROL_OFFSET, metadata = management + HEAP_STRING_METADATA_OFFSET;
	const floor = memory.ramBusEnd() - RAM_BASE, last = management + GC_WORKSPACE_END;
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
		const id = equal(target => nativeHeapReference(target).stringPool.intern(text));
		assert.ok(id >= RAM_BASE);
		return id;
	}
	const constants = RETAINED_CART_STRINGS.map(string);
	for (const slot of [0, 1] as const)
		assert.deepEqual(equal(target => {
			assert.ok(target['executionImageForDomain'](slot));
			const binding = executionImageBindingOffset(target.heapAllocator.managementOffset(), slot);
			const base = target.memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET);
			const count = target.memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_RAM_STRINGS_OFFSET);
			return Array.from({ length: count }, (_, i) =>
				target.memory.readRamRecordWord(base + 4 * i) & ~IMAGE_STRING_RAM_ORDINAL);
		}), slot === 0 ? constants.slice(0, 2) : constants.slice(2));
	assert.equal(cpu.rootBankSlots(GcRootBank.SystemConstants), 0);
	assert.equal(cpu.rootBankSlots(GcRootBank.Cart0Constants), 2);
	assert.equal(cpu.rootBankSlots(GcRootBank.Cart1Constants), 1);

	const name = string('system variable'), first = string('system root Value');
	const table = equal(target => createReferenceTable(target, 1, 0)), otherTable = equal(target => createReferenceTable(target, 0, 1));
	const active = equal(target => allocateThreadRecordReference(target, 0)), completionThread = equal(target => allocateThreadRecordReference(target, 0));
	const halted = equal(target => allocateThreadRecordReference(target, 0));
	for (const [kind, key, value] of [
		[GcRootBank.SystemGlobals, name, valueString(first)],
		[GcRootBank.SystemGlobals, string('second system variable'), valueTable(table)],
		[GcRootBank.Globals, string('cart root'), valueTable(otherTable)],
		[GcRootBank.Globals, string('same key and Value'), valueString(string('same key and Value'))],
	] as const) {
		equal(target => {
			const bank = kind === GcRootBank.SystemGlobals ? target['systemGlobalBank'] : target['globalBank'];
			const slot = registerReferenceGlobalName(nativeHeapReference(target).gc, bank, key);
			writeReferenceGlobalSlot(nativeHeapReference(target).gc, bank, slot, value);
			return slot;
		});
	}
	const returned = string('returned String');
	const finished = [valueString(returned), valueTable(table), valueInteger(19)];

	const descriptor = management + GC_ROOT_BANKS_OFFSET;
	const namespace = management + (moved === GcRootBank.SystemGlobals ? SYSTEM_GLOBAL_BANK_OFFSET : GLOBAL_BANK_OFFSET);
	const lateName = moved === null ? 0 : string('late root name');
	const lateValue = moved === null ? 0 : string('late root value');
	equal(target => {
		const ram = target.memory;
		target.activeThread = target.bindThread(active);
		target['completionThread'] = completionThread;
		target['haltedUntilIrqThread'] = halted;
		const result = new ValueSlots(finished.length);
		for (const [slot, value] of finished.entries()) result.setEncoded(slot, valueTag(value), valuePayload(value));
		target['latchCompletionValues'](result, 0, finished.length);
		const occupied = target.heapAllocator.occupiedBytes(), charged = target.luaHeap.usedBytes();
		const descriptorEnd = descriptor + GC_ROOT_BANKS_SIZE;
		const before = ram.ramData().slice(floor, descriptor);
		const after = ram.ramData().slice(descriptorEnd, last);
		target.publishHeapRootBanks();
		assert.equal(target.heapAllocator.occupiedBytes(), occupied);
		assert.equal(target.luaHeap.usedBytes(), charged);
		assert.deepEqual(ram.ramData().subarray(floor, descriptor), before);
		assert.deepEqual(ram.ramData().subarray(descriptorEnd, last), after);
		if (moved !== null) {
			const bank = moved === GcRootBank.SystemGlobals ? target['systemGlobalBank'] : target['globalBank'];
			const previous = ram.readRamRecordWord(namespace + GlobalBankField.Values);
			const capacity = ram.readRamRecordWord(namespace + GlobalBankField.Capacity);
			for (let i = bank.count; i < capacity; ++i) registerReferenceGlobalName(nativeHeapReference(target).gc, bank, nativeHeapReference(target).stringPool.intern(`namespace filler ${i}`));
			writeReferenceGlobalSlot(nativeHeapReference(target).gc, bank, registerReferenceGlobalName(nativeHeapReference(target).gc, bank, lateName), valueString(lateValue));
			assert.notEqual(ram.readRamRecordWord(namespace + GlobalBankField.Values), previous);
		}
		nativeHeapReference(target).stringPool.takeMarkWork();
		nativeHeapReference(target).stringPool.beginReachabilityEpoch();
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
		return cycles;
	}
	function step(limit: number, work: number, stop: GcRootBank) {
		begin(limit, work, stop);
		finish();
		assert.equal(cpu.heapServiceResult(), nativeHeapReference(oracle).gc['traceRootBanks'](limit, work, stop));
		compare(`limit=${limit}, initial=${work}, stop=${stop}`);
	}
	const nameSlot = cpu['systemGlobalBank'].find(name)!;
	const lateSlot = moved === null ? 0 : (moved === GcRootBank.SystemGlobals ? cpu['systemGlobalBank'] : cpu['globalBank']).find(lateName)!;
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
	return { cpu, oracle, memory, cursor, depth, index, marked, name, nameSlot, first, returned, halted,
		constants, lateName, lateValue, lateSlot, setCursor, begin, beginPort, grant, finish, step, compare };
}

for (const optLevel of [0, 3] as const) {
	for (const [kind, name] of [[GcRootBank.SystemGlobals, 'System'], [GcRootBank.Globals, 'ordinary']] as const) {
		test(`the BIOS reloads the relocated ${name} namespace without publishing its roots at O${optLevel}`, () => {
			const f = fixture(optLevel, kind);
			f.setCursor(kind, f.lateSlot);
			assert.ok(!f.marked(f.lateName) && !f.marked(f.lateValue));
			f.step(1, 0, GcRootBank.End);
			assert.equal(f.cpu.heapServiceResult(), 5);
			assert.ok(f.marked(f.lateName) && f.marked(f.lateValue));
		});
	}
	test(`BLua root banks match native name/Value order, counts, and overshooting work at O${optLevel}`, () => {
		const f = fixture(optLevel);
		f.setCursor(GcRootBank.SystemGlobals, f.nameSlot);
		f.step(2, 2, GcRootBank.End);
		assert.equal(f.cursor(), (GcRootBank.SystemGlobals << CURSOR_BITS) | f.nameSlot);
		assert.equal(f.marked(f.name), false);
		f.step(1, 0, GcRootBank.End);
		assert.equal(f.cpu.heapServiceResult(), 5, 'one global name and one String Value cross the one-word allowance');
		assert.ok(f.marked(f.name) && f.marked(f.first));
		assert.equal(f.cursor(), (GcRootBank.SystemGlobals << CURSOR_BITS) | (f.nameSlot + 1));
		for (let i = 0; i < 64 && f.cursor() !== 0; ++i) f.step(4 + i % 4, i % 3, GcRootBank.End);
		assert.equal(f.cursor(), 0);
		assert.equal(f.depth(), f.index(f.halted), 'halted Thread is marked after root, active, and completion Threads');
		assert.ok(f.constants.every(f.marked));
		assert.ok(f.marked(f.returned), 'the Completion String remains a root');
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
		assert.equal(f.cpu.heapServiceResult(), nativeHeapReference(f.oracle).gc['traceRootBanks'](3, 0, GcRootBank.End));
		f.compare('name → Value');
		restoreCpuCheckpoint(f.cpu, checkpoint);
		assert.equal(f.finish(), cycles);
		f.compare('restored name → Value');
	});

	test(`BLua root-bank rewind reloads the Completion owner at O${optLevel}`, () => {
		const f = fixture(optLevel);
		f.setCursor(GcRootBank.Completion);
		f.begin(1, 0, GcRootBank.End);
		f.grant(1);
		assert.equal(f.cpu.heapServiceActive(), true);
		assert.equal(f.marked(f.returned), false);
		const checkpoint = captureCpuCheckpoint(f.cpu);
		const cycles = f.finish();
		assert.equal(f.cpu.heapServiceResult(), nativeHeapReference(f.oracle).gc['traceRootBanks'](1, 0, GcRootBank.End));
		assert.equal(f.marked(f.returned), true);
		f.compare('borrowed Completion slot');

		f.cpu['clearCompletionValues']();
		assert.equal(f.cpu.rootBankSlots(GcRootBank.Completion), 0);
		restoreCpuCheckpoint(f.cpu, checkpoint);
		assert.equal(f.cpu.rootBankSlots(GcRootBank.Completion), 3);
		assert.equal(f.finish(), cycles);
		f.compare('restored Completion slot');
	});
}

for (const operation of ['read_byte', 'write_word'] as const) {
	test(`the retired constant projection address rejects ${operation}`, () => {
		const f = fixture(0);
		const address = HEAP_SERVICE_ROOT_PORT_BASE - 0x800000;
		assert.equal(f.memory.isReadableMainMemoryRange(address, 4), false, 'ordinary bus has no root plane');
		f.beginPort(operation, address);
		assert.throws(() => f.finish(), operation === 'read_byte' ? /outside installed RAM and ROM/ : /outside its private RAM port/);
	});
}


test('compact resident String bindings preserve ordinal identity and root order over dirty backing', () => {
	const { memory } = fixture(0);
	const base = RAM_BASE + 0x20000, count = 7;
	for (let mask = 0; mask < 1 << count; ++mask) {
		for (let slot = 0; slot < count; ++slot) memory.writeRamRecordWord(base + 4 * slot, 0xfffffff9);
		const words = Array.from({ length: count }, (_, i) => ((mask & (1 << i)) !== 0
			? RAM_BASE + 0x20000 + 8 * i : (((i & 1) === 0 ? 0x90000000 : 0x10000000) + 8 * i)));
		let ram = 0;
		for (const [slot, word] of words.entries()) ram = storeImageStringBinding(memory, base, count, slot, ram, word);
		const roots = words.filter(isRamStringId);
		assert.equal(ram, roots.length);
		assert.deepEqual(roots, Array.from({ length: ram }, (_, i) =>
			memory.readRamRecordWord(base + 4 * i) & ~IMAGE_STRING_RAM_ORDINAL));
		ram = 0;
		for (const [slot, word] of words.entries()) {
			const original = loadImageStringBinding(memory, base, count, slot, ram);
			assert.equal(original, word);
			ram += +isRamStringId(original);
		}
	}
});
