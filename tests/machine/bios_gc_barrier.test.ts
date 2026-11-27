import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_CHANGED_HEAD, GC_MODE_META, GC_REMARK_VISIT_STATE, GC_TRACE_HEAD, GC_TRACE_RECORD, GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_COLOR_OFFSET, GC_GRAY_INDEX_BITS, GC_RECORD_LINK, GC_RECORD_MASK, GC_RECORD_SHIFT } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET, HEAP_STRING_MARK_WORK_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { TableHeader } from '../../machine/ts/machine/cpu/table';
import { initialize, UPVALUE_ADDRESS_MASK, UPVALUE_HEAP_BYTES, UPVALUE_NEXT, UPVALUE_VALUE_TAG, UPVALUE_VALUE_WORD } from '../../machine/ts/machine/cpu/upvalue';
import { ValueTag, valueFromTag } from '../../machine/ts/machine/cpu/value';
import { CPU_FIXED_FRAME_COUNT, CPU_FIXED_VALUE_COUNT, MAIN_RAM_SIZE, RAM_BASE, RAM_RECORD_WORD_MASK } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_WORKSPACE_END } from '../helpers/firmware_heap_layout';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { storeUpvalueReference, writeBlackClosedValueReference, writeClosedValueReference } from '../helpers/upvalue_store_reference';
import { compileTestSystemWithHeap, createTestHeapServiceCpu } from '../helpers/heap_service_system';

const BARRIER = 'kernel/gc_barrier', entrySource = 'halt_until_irq';
const modules = ['kernel/dlmalloc', 'kernel/gc_control', 'kernel/gc_strings', 'kernel/gc_mark', BARRIER].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});

function fixture(optLevel: 0 | 3) {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	const entries = new Map<string, number>();
	for (const { path, exportPathKey, slotName } of object.sections.rodata.moduleExports) {
		const phase = path === 'kernel/gc_control' && exportPathKey === 'internal.phase';
		if (!phase && (path !== BARRIER || exportPathKey.startsWith('internal.'))) continue;
		const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[slotName]);
		assert.ok(index >= 0);
		entries.set(phase ? 'phase' : exportPathKey, index);
	}
	const { valueSlots, frames } = deriveBlua32FixedStack(linked.image, [...entries.values()]);
	assert.ok(valueSlots <= CPU_FIXED_VALUE_COUNT && frames <= CPU_FIXED_FRAME_COUNT);
	const { cpu, memory } = createTestHeapServiceCpu(linked), oracle = createTestHeapServiceCpu(linked).cpu;
	runGuestToHalt(cpu, 10_000);
	runGuestToHalt(oracle, 10_000);
	const management = cpu.heapAllocator.managementOffset(), arena = cpu.heapAllocator.allocatorStateOffset();
	const control = management + HEAP_GC_CONTROL_OFFSET, metadata = management + HEAP_STRING_METADATA_OFFSET;
	const floor = memory.ramBusEnd() - RAM_BASE, end = management + GC_WORKSPACE_END;
	const actual = memory.ramData().subarray(floor, end), expected = oracle.memory.ramData().subarray(floor, end);
	function compare(label: string) {
		if (Buffer.compare(actual, expected) === 0) return;
		const offset = actual.findIndex((byte, index) => byte !== expected[index]);
		assert.equal(actual[offset], expected[offset], `${label}: RAM 0x${(floor + offset).toString(16)}`);
	}
	function add(create: (target: typeof cpu) => number) {
		const address = create(cpu);
		assert.notEqual(address, 0);
		assert.equal(create(oracle), address);
		return address;
	}
	function word(address: number, value: number) {
		for (const mem of [memory, oracle.memory]) mem.writeRamRecordWord(address, value);
	}
	function byte(address: number, value: number) {
		for (const mem of [memory, oracle.memory]) mem.writeRamRecordByte(address, value);
	}
	function begin(name: string, ...args: number[]) {
		assert.ok(cpu.beginHeapService(linked.image.functions[entries.get(name)!].address, [control, ...args]));
	}
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		assert.ok(cpu.instructionBudgetRemaining < cycles);
		return cycles - cpu.instructionBudgetRemaining;
	}
	function finish(cycles = 128) {
		let elapsed = 0;
		for (let i = 0; i < 1024 && cpu.heapServiceActive(); ++i) elapsed += grant(cycles);
		return [cpu.heapServiceResult(), elapsed];
	}
	function invoke(name: string, ...args: number[]) {
		begin(name, ...args);
		const expectedWork = oracle.stringPool.takeMarkWork();
		assert.equal(finish()[0], expectedWork, name);
		compare(name);
	}
	function pendingString(id: number) {
		byte(id + 1, 0x74); // The test selects epoch 1 for the new mark.
		cpu.stringPool.markReachable(id);
		oracle.stringPool.markReachable(id);
		const pending = cpu.stringPool.takeMarkWork();
		assert.equal(pending, 1);
		return pending;
	}
	function phase(phase: number, stage = 0) {
		word(control, 0x5ce000 | phase); // White reads only the low bit of 0xe0.
		word(control + GC_REMARK_VISIT_STATE, (stage << GC_GRAY_INDEX_BITS) | 0x524f);
		word(control + GC_CHANGED_HEAD, 0xedc80311);
		word(control + GC_TRACE_HEAD, 0x98700456);
	}
	word(metadata + 0x0c, 0xa5a5a501);
	return { cpu, memory, oracle, management, arena, control, metadata, add, word, byte, begin, grant, finish, invoke, pendingString, phase, compare };
}

const EPOCH_WORK = 0x5c, MODE_REMAINING = 0x54;
const indexOfRecord = (address: number) => (address & GC_RECORD_MASK) >>> GC_RECORD_SHIFT;

for (const optLevel of [0, 3] as const) {
	test(`BLua global barrier preserves remark detach and immediate String credit at O${optLevel}`, () => {
		const { memory, oracle, arena, control, metadata, add, word, byte, begin, finish, invoke, pendingString, phase } = fixture(optLevel);
		const table = add(target => createReferenceTable(target));
		const thread = add(target => target.rootThread.address);
		const carried = add(target => target.stringPool.intern('pending-global-mark'));
		const value = add(target => target.stringPool.intern('global-barrier-value'));
		for (const [current, remark, queue] of [[GcPhase.Mark, 0, GC_TRACE_HEAD], [GcPhase.Mark, 1, GC_CHANGED_HEAD],
			[GcPhase.MarkAgain, 2, GC_TRACE_HEAD], [GcPhase.Atomic, 0, GC_CHANGED_HEAD], [GcPhase.Atomic, 3, GC_TRACE_HEAD],
			[GcPhase.Sweep, 2, 0], [7, 2, 0]]) {
			phase(current, remark);
			byte(table + GC_COLOR_OFFSET, 0xb4);
			word(table + GC_RECORD_LINK, 0xbafab678);
			const pending = pendingString(carried);
			oracle.gc.writeGlobalRoot(ValueTag.Table, table);
			invoke('mark_global_write', arena, metadata, ValueTag.Table, table, 0, pending);
			if (queue) assert.equal(memory.readRamRecordWord(control + queue), indexOfRecord(table));
			else assert.equal(memory.readRamRecordByte(table + GC_COLOR_OFFSET), 0xb4);
		}
		phase(GcPhase.Mark);
		word(control + EPOCH_WORK, 17);
		byte(value + 1, 0x74);
		const pending = pendingString(carried);
		oracle.gc.writeGlobalRoot(ValueTag.String, value);
		invoke('mark_global_write', arena, metadata, ValueTag.String, value, 0, pending);
		assert.equal(memory.readRamRecordWord(control + EPOCH_WORK), 19);
		phase(GcPhase.Mark);
		byte(thread + GC_COLOR_OFFSET, 0x68);
		oracle.gc.writeGlobalRoot(ValueTag.Float, thread);
		invoke('mark_global_write', arena, metadata, ValueTag.Float, thread, 0, 0);
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_HEAD), indexOfRecord(thread), 'TS direct entry uses the admitted record kind');
		phase(GcPhase.Mark);
		byte(thread + GC_COLOR_OFFSET, 0x68);
		// C++ dispatches Float through markValue and does not follow it. This
		// path is outside the normal caller's admitted GlobalBank edge tags.
		invoke('mark_global_write', arena, metadata, ValueTag.Float, thread, 1, 0);
		assert.equal(memory.readRamRecordByte(thread + GC_COLOR_OFFSET), 0x68);
		for (let selector = 0; selector < 8; ++selector) {
			byte(control, 0xf8 | selector);
			begin('phase');
			assert.equal(finish()[0], oracle.gc.phase(), `physical phase selector ${selector}`);
		}
	});

	test(`BLua Table and closed Upvalue barriers choose new edges or requeue at O${optLevel}`, () => {
		const { memory, oracle, arena, control, metadata, add, word, byte, invoke, pendingString, phase } = fixture(optLevel);
		const table = add(target => createReferenceTable(target));
		const key = add(target => createReferenceTable(target));
		const value = add(target => createReferenceTable(target));
		const cell = add(target => {
			const address = target.luaHeap.allocateRecord(UPVALUE_HEAP_BYTES, true, 0, 0);
			initialize(target.memory, address, target.gc.white());
			target.gc.publishObject(address);
			return address;
		});
		const carried = add(target => target.stringPool.intern('pending-table-mark'));
		const stringKey = add(target => target.stringPool.intern('inserted-key-mark'));
		const stringValue = add(target => target.stringPool.intern('written-value-mark'));
		phase(GcPhase.MarkAgain);
		byte(table + GC_COLOR_OFFSET, 0xbb);
		byte(key + GC_COLOR_OFFSET, 0);
		byte(value + GC_COLOR_OFFSET, 0);
		word(control + EPOCH_WORK, 23);
		const pending = pendingString(carried);
		oracle.gc.writeTableAssignment(table, ValueTag.Table, value, valueFromTag(ValueTag.Table, key));
		invoke('write_table_assignment', arena, metadata, table, ValueTag.Table, value, 1, ValueTag.Table, key, 0, pending);
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_HEAD), indexOfRecord(value));
		assert.equal(memory.readRamRecordWord(value + GC_RECORD_LINK), indexOfRecord(key), 'key edge precedes the new value');
		assert.equal(memory.readRamRecordWord(control + EPOCH_WORK), 24);
		byte(stringKey + 1, 0);
		byte(stringValue + 1, 0);
		const pendingBoth = pendingString(carried);
		oracle.gc.writeTableAssignment(table, ValueTag.String, stringValue, valueFromTag(ValueTag.String, stringKey));
		invoke('write_black_table_assignment', arena, metadata, table, ValueTag.String, stringValue, 1, ValueTag.String, stringKey, 0, pendingBoth);
		assert.equal(memory.readRamRecordWord(control + EPOCH_WORK), 27, 'credit both new String marks and carried work once');
		word(table + TableHeader.Metatable, key);
		byte(value + GC_COLOR_OFFSET, 0);
		const pendingAgain = pendingString(carried);
		oracle.gc.writeTableAssignment(table, ValueTag.Table, value);
		invoke('write_table_assignment', arena, metadata, table, ValueTag.Table, value, 0, 0, 0, 0, pendingAgain);
		assert.equal(memory.readRamRecordWord(control + GC_CHANGED_HEAD), indexOfRecord(table));
		assert.equal(memory.readRamRecordByte(value + GC_COLOR_OFFSET), 0, 'a metatable requires a rescan');
		byte(table + GC_COLOR_OFFSET, 3);
		const pendingIgnored = pendingString(carried);
		oracle.gc.writeTableAssignment(table, ValueTag.BuiltinFunction, value);
		invoke('write_table_assignment', arena, metadata, table, ValueTag.BuiltinFunction, value, 0, 0, 0, 0, pendingIgnored);
		assert.equal(memory.readRamRecordByte(table + GC_COLOR_OFFSET), 3, 'no edge, no rescan');
		byte(table + GC_COLOR_OFFSET, 2);
		oracle.gc.writeTableAssignment(table, ValueTag.Table, value);
		invoke('write_table_assignment', arena, metadata, table, ValueTag.Table, value, 0, 0, 0, 0, 0);
		assert.equal(memory.readRamRecordByte(value + GC_COLOR_OFFSET), 0, 'only a black owner admits the barrier');

		phase(GcPhase.MarkAgain);
		byte(cell + GC_COLOR_OFFSET, 3);
		word(cell + UPVALUE_NEXT, 0x819ab2ef);
		writeClosedValueReference(oracle, cell, ValueTag.Table, value);
		invoke('write_closed_value', arena, metadata, cell, ValueTag.Table, value, 0);
		assert.equal(memory.readRamRecordWord(cell + UPVALUE_NEXT), 0x819ab2ef);
		phase(GcPhase.Mark);
		writeBlackClosedValueReference(oracle, cell, ValueTag.Table, value);
		invoke('write_black_closed_value', arena, metadata, cell, ValueTag.Table, value, 0);
		assert.equal(memory.readRamRecordWord(cell + UPVALUE_NEXT), 0x311);
		oracle.gc.writeBarrier(cell, UPVALUE_NEXT);
		invoke('write_barrier', cell, UPVALUE_NEXT, 0);
		byte(cell + GC_COLOR_OFFSET, 0x8b);
		oracle.gc.writeBarrier(cell, UPVALUE_NEXT);
		invoke('write_barrier', cell, UPVALUE_NEXT, 0);
		assert.equal(memory.readRamRecordByte(cell + GC_COLOR_OFFSET), 0x8a);
	});

	test(`BLua closed store preserves native write order and interrupted String credit at O${optLevel}`, t => {
		const { cpu, memory, oracle, management, arena, control, metadata, add, word, byte, begin, grant, finish, phase, compare } = fixture(optLevel);
		const cell = add(target => {
			const address = target.luaHeap.allocateRecord(UPVALUE_HEAP_BYTES, true, 0, 0);
			initialize(target.memory, address, target.gc.white());
			target.gc.publishObject(address);
			return address;
		}) & UPVALUE_ADDRESS_MASK;
		const value = add(target => target.stringPool.intern('new closed-cell String'));
		const mark = (value + 1) & (MAIN_RAM_SIZE - 1);
		const latch = management + HEAP_STRING_MARK_WORK_OFFSET, work = control + EPOCH_WORK;
		const next = cell + UPVALUE_NEXT, color = cell + GC_COLOR_OFFSET, changed = control + GC_CHANGED_HEAD;
		const wordLane = cell + UPVALUE_VALUE_WORD, tagLane = cell + UPVALUE_VALUE_TAG;
		const addresses = new Set([mark, latch, work, next, color, changed, wordLane, tagLane]);
		type Write = [offset: number, width: number, value: number];
		function watch(mem: typeof memory): Write[] {
			const trace: Write[] = [];
			const writeWord = mem.writeRamRecordWord.bind(mem), writeByte = mem.writeRamRecordByte.bind(mem);
			t.mock.method(mem, 'writeRamRecordWord', (address: number, data: number) => {
				writeWord(address, data);
				const offset = address & RAM_RECORD_WORD_MASK;
				if (addresses.has(offset)) trace.push([offset, 4, mem.readRamRecordWord(offset)]);
			});
			t.mock.method(mem, 'writeRamRecordByte', (address: number, data: number) => {
				writeByte(address, data);
				const offset = address & (MAIN_RAM_SIZE - 1);
				if (addresses.has(offset)) trace.push([offset, 1, mem.readRamRecordByte(offset)]);
			});
			return trace;
		}
		const actual = watch(memory), expected = watch(oracle.memory);
		const valueWrites: Write[] = [[wordLane, 4, value], [tagLane, 1, ValueTag.String]];
		const cases: { phase: GcPhase; pending: number; barrier: Write[]; stop: number }[] = [
			{ phase: GcPhase.Mark, pending: 2, barrier: [[next, 4, 0x311], [color, 1, 2], [changed, 4, indexOfRecord(cell)]], stop: 1 },
			{ phase: GcPhase.MarkAgain, pending: 2, barrier: [[mark, 1, 1], [latch, 4, 3], [latch, 4, 0], [work, 4, 20]], stop: 2 },
			{ phase: GcPhase.MarkAgain, pending: 0xffffffff, barrier: [[mark, 1, 1], [latch, 4, 0]], stop: 1 },
		];
		for (const { phase: current, pending, barrier, stop } of cases) {
			phase(current);
			byte(color, 3);
			word(next, 0x819ab2ef);
			word(latch, pending);
			word(work, 17);
			byte(mark, 0x74);
			word(wordLane, 73);
			byte(tagLane, ValueTag.Integer);
			actual.length = expected.length = 0;
			storeUpvalueReference(oracle, cell, ValueTag.String, value);
			assert.deepEqual(expected, [...barrier, ...valueWrites]);

			begin('store_closed_value', arena, metadata, cell, ValueTag.String, value, 1);
			for (let i = 0; i < 1024 && actual.length < stop; ++i) grant(1);
			assert.ok(cpu.heapServiceActive(), 'the accepted activation can stop between its writes');
			assert.deepEqual(actual, expected.slice(0, stop));
			assert.equal(memory.readRamRecordWord(wordLane), 73);
			assert.equal(memory.readRamRecordByte(tagLane), ValueTag.Integer);
			const saved = captureCpuCheckpoint(cpu);
			const finished = finish(1);
			assert.deepEqual(actual, expected);
			compare('closed store after firmware return');
			restoreCpuCheckpoint(cpu, saved);
			actual.length = 0;
			assert.deepEqual(finish(1), finished);
			assert.deepEqual(actual, expected.slice(stop));
			compare('closed store after replay');
		}
	});

	test(`BLua moved entries clear the suspended cursor before requeue and resume at O${optLevel}`, () => {
		const { cpu, memory, oracle, control, add, word, byte, begin, grant, finish, invoke, compare } = fixture(optLevel);
		const trace = add(target => createReferenceTable(target)), mode = add(target => createReferenceTable(target));
		byte(trace + GC_COLOR_OFFSET, 0x9b);
		word(control + GC_TRACE_RECORD, trace);
		word(control + GC_TRACE_RECORD + 4, 0x742);
		word(control + GC_MODE_META, mode);
		word(control + GC_MODE_META + 4, 0x861);
		word(control + MODE_REMAINING, 0x44);
		word(control + GC_CHANGED_HEAD, 0x177);
		oracle.gc.tableEntriesMoved(cpu.rootThread.address);
		invoke('table_entries_moved', cpu.rootThread.address, 0);
		oracle.gc.tableEntriesMoved(mode);
		begin('table_entries_moved', mode, 0);
		for (let i = 0; i < 128 && memory.readRamRecordWord(control + GC_TRACE_RECORD) !== 0; ++i) grant(1);
		assert.equal(cpu.heapServiceActive(), true);
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD), 0);
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_RECORD + 4), 0x742, 'pair publication is ordered');
		assert.equal(memory.readRamRecordWord(control + GC_CHANGED_HEAD), 0x177);
		const checkpoint = captureCpuCheckpoint(cpu);
		const finished = finish(1);
		assert.equal(memory.readRamRecordWord(control + GC_CHANGED_HEAD), indexOfRecord(trace), 'the old Trace owner is requeued');
		compare('moved mode owner');
		restoreCpuCheckpoint(cpu, checkpoint);
		assert.deepEqual(finish(1), finished);
		compare('replayed moved mode owner');
	});
}
