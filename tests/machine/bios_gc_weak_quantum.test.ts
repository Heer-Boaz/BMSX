import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_MODE_META, GC_MODE_NODE, GC_TRACE_CURSOR, GC_TRACE_RECORD, GC_VISIT_COUNT, GC_VISIT_HEADER_BYTE, GC_VISIT_MEMBER, GC_VISIT_TAIL, GC_WEAK_VISITS } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_COLOR_OFFSET, GC_GRAY_INDEX_MASK, GC_RECORD_LINK, GC_RECORD_MASK, GC_RECORD_SHIFT } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { TableHeader } from '../../machine/ts/machine/cpu/table';
import { ValueTag, hashCanonicalTableKey, valuePayload, valueString } from '../../machine/ts/machine/cpu/value';
import { HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_TRACE_QUANTUM_OFFSET, HEAP_SERVICE_VALUE_COUNT, HeapServiceTraceField } from '../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';

const QUANTUM = 'kernel/gc_weak_quantum', PROBE = 'test/gc_weak_quantum', entrySource = "return 'kv'";
const probeSource = `module<const>
local quantum<const> = require('${QUANTUM}')
local invoke<const> = function(control, arena, metadata, mode_key, new_index, limit, pending, narrow, result)
	local work<const>, carry<const> = quantum.clear_weak_quantum(control, arena, metadata, mode_key, new_index, limit, pending, narrow)
	local output<const>: *u32 = ${RAM_BASE} + result
	*output = carry
	return work
end
return { invoke = invoke }
`;
const modules = [
	...['kernel/dlmalloc', 'kernel/gc_control', 'kernel/gc_strings', 'kernel/gc_mark', 'kernel/gc_table_mode',
		'kernel/string_record', 'kernel/gc_weak_mode', 'kernel/gc_weak_table', QUANTUM]
		.map(path => ({ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') })),
	{ path: PROBE, source: probeSource },
].map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path) }));
const CURSOR_SHIFT = 20, MODE_PENDING = 4 << CURSOR_SHIFT, MODE_REMAINING = GC_MODE_NODE + 4;
const indexOfRecord = (address: number) => (address & GC_RECORD_MASK) >>> GC_RECORD_SHIFT;

function fixture(optLevel: 0 | 3) {
	const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	const { slotName } = object.sections.rodata.moduleExports.find(entry => entry.path === PROBE && entry.exportPathKey === 'invoke')!;
	const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[slotName]);
	const stepSlot = object.sections.rodata.moduleExports.find(entry => entry.path === QUANTUM && entry.exportPathKey === 'clear_weak_step')!.slotName;
	const step = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[stepSlot]);
	assert.ok(index >= 0 && step >= 0);
	const { valueSlots, frames } = deriveBlua32FixedStack(linked.image, [index, step]);
	assert.ok(valueSlots <= HEAP_SERVICE_VALUE_COUNT && frames <= HEAP_SERVICE_FRAME_COUNT, `pinned stack: ${valueSlots} values, ${frames} frames`);
	const { cpu, memory } = createTestSystemCpu(linked), oracle = createTestSystemCpu(linked).cpu;
	assert.equal(cpu.runUntilDepth(0, 1024), RunResult.Halted);
	assert.equal(oracle.runUntilDepth(0, 1024), RunResult.Halted);
	const management = cpu.heapAllocator.managementOffset(), arena = cpu.heapAllocator.allocatorStateOffset();
	const control = management + HEAP_GC_CONTROL_OFFSET, metadata = management + HEAP_STRING_METADATA_OFFSET;
	const quantum = management + HEAP_SERVICE_TRACE_QUANTUM_OFFSET;
	const floor = memory.ramBusEnd() - RAM_BASE, output = management + HEAP_SERVICE_THREAD_OFFSET - 4;
	const modeKey = cpu.gc['modeKey'], newIndex = valuePayload(cpu.gc.tables.newIndexKey);
	assert.equal(modeKey, oracle.gc['modeKey']);
	function compare(label: string) {
		const actual = memory.ramData().subarray(floor, output), expected = oracle.memory.ramData().subarray(floor, output);
		if (Buffer.compare(actual, expected) === 0) return;
		const offset = actual.findIndex((byte, i) => byte !== expected[i]);
		assert.equal(actual[offset], expected[offset], `${label}: RAM 0x${(floor + offset).toString(16)}`);
	}
	function word(address: number, value: number) {
		memory.writeRamRecordWord(address, value);
		oracle.memory.writeRamRecordWord(address, value);
	}
	function byte(address: number, value: number) {
		memory.writeRamRecordByte(address, value);
		oracle.memory.writeRamRecordByte(address, value);
	}
	function add(create: (target: typeof cpu) => number) {
		const address = create(cpu);
		assert.notEqual(address, 0);
		assert.equal(create(oracle), address);
		return address;
	}
	function string(text: string) {
		const id = add(target => target.stringPool.intern(text));
		byte(id + 1, 0x94);
		return id;
	}
	function pendingString(id: number) {
		cpu.stringPool.markReachable(id);
		oracle.stringPool.markReachable(id);
	}
	function table(array: number, hash: number) {
		const record = add(target => target.createTable(array, hash));
		const arrayBase = cpu.gc.tables.arrayAddress(record), hashBase = cpu.gc.tables.hashAddress(record);
		assert.equal(cpu.gc.tables.arrayCapacity(record), array);
		assert.equal(cpu.gc.tables.hashSize(record), hash);
		function arraySlot(slot: number, tag: ValueTag, payload: number) {
			word(arrayBase + 4 * slot, payload);
			byte(arrayBase + 4 * array + slot, tag);
		}
		function hashSlot(slot: number, tag: ValueTag, payload: number) {
			word(hashBase + 4 * slot, payload);
			byte(hashBase + 8 * hash + slot, tag);
		}
		function node(slot: number, keyTag: ValueTag, keyWord: number, tag: ValueTag, payload: number, next: number) {
			hashSlot(slot, keyTag, keyWord);
			hashSlot(slot + hash, tag, payload);
			if (hash <= 128) byte(hashBase + 10 * hash + slot, next);
			else word(hashBase + 10 * hash + 4 * slot, next);
		}
		const home = hashCanonicalTableKey(valueString(modeKey)) & (hash - 1);
		return { record, arrayBase, hashBase, arraySlot, node, home };
	}
	function enqueue(address: number) {
		cpu.gc['appendVisit'](GC_WEAK_VISITS, address);
		oracle.gc['appendVisit'](GC_WEAK_VISITS, address);
	}
	function frontier() {
		return [memory.readRamRecordWord(control + GC_TRACE_RECORD), memory.readRamRecordWord(control + GC_TRACE_CURSOR)];
	}
	function modeCursor() {
		return [memory.readRamRecordWord(control + GC_MODE_META), memory.readRamRecordWord(control + GC_MODE_NODE),
			memory.readRamRecordWord(control + MODE_REMAINING)];
	}
	function visits() {
		return [memory.readRamRecordWord(control + GC_WEAK_VISITS), memory.readRamRecordWord(control + GC_WEAK_VISITS + GC_VISIT_TAIL),
			memory.readRamRecordWord(control + GC_WEAK_VISITS + GC_VISIT_COUNT)];
	}
	function list(head: number, tail: number, count: number) {
		word(control + GC_WEAK_VISITS, head);
		word(control + GC_WEAK_VISITS + GC_VISIT_TAIL, tail);
		word(control + GC_WEAK_VISITS + GC_VISIT_COUNT, count);
	}
	function begin(limit: number, narrow = 0) {
		const work = oracle.gc['clearWeakQuantum'](limit);
		const pending = oracle.stringPool.takeMarkWork();
		assert.ok(cpu.beginHeapService(linked.image.functions[index].address,
			[control, arena, metadata, modeKey, newIndex, limit, cpu.stringPool.takeMarkWork(), narrow, output]));
		return [work, pending];
	}
	function beginStep(prefix: number, limit: number, atomic: number, policy: number) {
		word(quantum + HeapServiceTraceField.Work, prefix);
		word(quantum + HeapServiceTraceField.Limit, limit);
		word(quantum + HeapServiceTraceField.Atomic, atomic);
		word(quantum + HeapServiceTraceField.PendingStringWork, cpu.stringPool.takeMarkWork());
		word(quantum + HeapServiceTraceField.MirrorPolicy, policy);
		const work = prefix + oracle.gc['clearWeakQuantum'](limit - prefix);
		const pending = oracle.stringPool.takeMarkWork();
		oracle.memory.writeRamRecordWord(quantum + HeapServiceTraceField.PendingStringWork, pending);
		assert.ok(cpu.beginHeapService(linked.image.functions[step].address, [control, arena, metadata, quantum, modeKey, newIndex, 0]));
		return [work, pending];
	}
	function quantumWords() {
		return [HeapServiceTraceField.Work, HeapServiceTraceField.Limit, HeapServiceTraceField.Atomic,
			HeapServiceTraceField.PendingStringWork, HeapServiceTraceField.MirrorPolicy].map(field => memory.readRamRecordWord(quantum + field));
	}
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		assert.ok(cpu.instructionBudgetRemaining < cycles);
		return cycles - cpu.instructionBudgetRemaining;
	}
	function finish(cycles = 64) {
		let elapsed = 0;
		for (let i = 0; i < 8192 && cpu.heapServiceActive(); ++i) elapsed += grant(cycles);
		assert.equal(cpu.heapServiceActive(), false);
		return { result: [cpu.heapServiceResult(), memory.readRamRecordWord(output)], elapsed };
	}
	function check(limit: number, expected: number[]) {
		assert.deepEqual(begin(limit), expected);
		assert.deepEqual(finish().result, expected);
		compare(`weak quantum ${limit}`);
	}
	word(control, 0x0000e503); // Atomic phase, raw white bit 1.
	word(metadata + 0x0c, 0xa5a5a501);
	return { cpu, oracle, memory, control, modeKey, compare, word, byte, add, table, string, pendingString,
		enqueue, frontier, modeCursor, visits, list, begin, beginStep, quantumWords, grant, finish, check };
}

for (const optLevel of [0, 3] as const) {
	test(`BLua weak step owns the pinned prefix and String carry fields at O${optLevel}`, () => {
		const { memory, control, compare, word, table, string, pendingString, enqueue, frontier, beginStep, quantumWords, finish } = fixture(optLevel);
		const receiver = table(2, 0);
		const retained = string('ABI weak table edge');
		receiver.arraySlot(0, ValueTag.String, retained);
		enqueue(receiver.record);
		pendingString(string('ABI carry past detach'));
		assert.deepEqual(beginStep(4, 5, 0xcafecafe, 0xfe), [5, 1]);
		assert.equal(finish().result[0], 5);
		assert.deepEqual(quantumWords(), [4, 5, 0xcafecafe, 1, 0xfe]);
		assert.deepEqual(frontier(), [receiver.record, MODE_PENDING], 'only the residual one word was available');
		compare('ABI carry retained');
		const mode = (0xa02 << CURSOR_SHIFT) >>> 0;
		word(control + GC_TRACE_CURSOR, mode);
		pendingString(string('ABI carry drained by span'));
		assert.deepEqual(beginStep(2, 3, 0x5aa5a55a, 0xfe), [5, 0]);
		assert.equal(finish().result[0], 5);
		assert.deepEqual(quantumWords(), [2, 3, 0x5aa5a55a, 0, 0xfe]);
		assert.deepEqual(frontier(), [receiver.record, (mode | 1) >>> 0], 'the argument, not host MirrorPolicy, selects width');
		assert.equal(memory.readRamRecordByte(retained + 1), 1);
		compare('ABI carry drained');
	});

	test(`BLua weak quantum drains one visit, resumes mode and scans both storage ranges at O${optLevel}`, () => {
		const { cpu, memory, modeKey, compare, word, byte, add, table, string, pendingString, enqueue, frontier,
			modeCursor, visits, begin, grant, finish, check } = fixture(optLevel);
		const first = table(2, 2), second = table(0, 0), meta = table(0, 4), dead = table(0, 0);
		const alive = add(target => target.rootThread.address);
		const arrayEdge = string('surviving array'), removed = string('removed along with weak key'), hashEdge = string('surviving key');
		const fullMode = cpu.stringPool.find('kv')!;
		assert.ok(fullMode > 0 && fullMode < RAM_BASE);
		const next = (meta.home + 1) & 3;
		meta.node(meta.home, ValueTag.Integer, modeKey, ValueTag.True, 0, next);
		meta.node(next, ValueTag.String, modeKey, ValueTag.String, fullMode, -1);
		word(first.record + TableHeader.Metatable, meta.record);
		byte(dead.record + GC_COLOR_OFFSET, 0xf1);
		byte(alive + GC_COLOR_OFFSET, 0xe3);
		first.arraySlot(0, ValueTag.Table, dead.record);
		first.arraySlot(1, ValueTag.String, arrayEdge);
		first.node(0, ValueTag.Table, dead.record, ValueTag.String, removed, -1);
		first.node(1, ValueTag.String, hashEdge, ValueTag.Thread, alive, -1);
		word(first.record + GC_RECORD_LINK, 0x54321);
		enqueue(first.record);
		enqueue(second.record);
		pendingString(string('pending at detach'));
		const expected = begin(1);
		assert.deepEqual(expected, [1, 1], 'visit, not mode or entry work');
		for (let i = 0; i < 2048 && frontier()[1] !== MODE_PENDING; ++i) grant(1);
		assert.equal(cpu.heapServiceActive(), true);
		assert.deepEqual(frontier(), [first.record, MODE_PENDING]);
		assert.deepEqual(visits(), [indexOfRecord(first.record), indexOfRecord(second.record), 2]);
		assert.equal(memory.readRamRecordByte(first.record + GC_VISIT_HEADER_BYTE) & GC_VISIT_MEMBER, 0);
		assert.equal(memory.readRamRecordWord(first.record + GC_RECORD_LINK), 0x54321 & GC_GRAY_INDEX_MASK);
		const checkpoint = captureCpuCheckpoint(cpu);
		const finished = finish(1);
		assert.deepEqual(finished.result, expected);
		assert.deepEqual(visits(), [indexOfRecord(second.record), indexOfRecord(second.record), 1]);
		compare('detached weak visit');
		restoreCpuCheckpoint(cpu, checkpoint);
		assert.deepEqual(finish(1), finished);
		compare('replayed detach');
		check(1, [1, 0]);
		assert.deepEqual(frontier(), [first.record, MODE_PENDING]);
		assert.deepEqual(modeCursor(), [meta.record, next, 3]);
		pendingString(string('pending during mode resolution'));
		check(1, [1, 1]);
		assert.deepEqual(frontier(), [first.record, 3 << CURSOR_SHIFT]);
		assert.deepEqual(modeCursor(), [0, 0, 0]);
		check(1, [1, 0]);
		assert.equal(memory.readRamRecordWord(first.arrayBase), 0);
		assert.equal(memory.readRamRecordByte(first.arrayBase + 8), ValueTag.Nil);
		check(1, [2, 0]);
		assert.equal(memory.readRamRecordByte(arrayEdge + 1), 1);
		assert.deepEqual(frontier(), [first.record, (3 << CURSOR_SHIFT) | 2]);
		check(1, [2, 0]);
		assert.equal(memory.readRamRecordByte(first.hashBase + 16), ValueTag.Nil);
		assert.equal(memory.readRamRecordByte(first.hashBase + 18), ValueTag.DeadKey);
		assert.equal(memory.readRamRecordByte(removed + 1), 0x94);
		check(9, [4, 0]); // surviving hash pair + String mark, then the empty Table visit
		assert.equal(memory.readRamRecordByte(hashEdge + 1), 1);
		assert.equal(memory.readRamRecordByte(second.record + GC_VISIT_HEADER_BYTE) & GC_VISIT_MEMBER, 0);
		assert.deepEqual(frontier(), [0, 0]);
		assert.deepEqual(visits(), [0, 0, 0]);
	});

	test(`BLua weak quantum honors masked head, count, membership, kind and issuance gates at O${optLevel}`, () => {
		const { memory, word, byte, add, table, list, frontier, visits, check } = fixture(optLevel);
		const { record } = table(0, 0), thread = add(target => target.rootThread.address);
		const unissued = RAM_BASE + 0x20;
		const tail = 0x70000031;
		list(0xf0000000, tail, 7);
		check(0, [0, 0]);
		check(9, [0, 0]);
		assert.deepEqual(visits(), [0xf0000000, tail, 7], 'masked empty head touches no list words');
		list(0xc0000000 | indexOfRecord(record), tail, 0xfff80000);
		check(9, [0, 0]);
		assert.deepEqual(visits(), [0, 0, 0], 'nonempty head with zero masked count is retired');
		byte(unissued, ValueTag.Table);
		byte(unissued + GC_VISIT_HEADER_BYTE, GC_VISIT_MEMBER);
		byte(thread + GC_VISIT_HEADER_BYTE, GC_VISIT_MEMBER);
		for (const address of [record, thread, unissued]) {
			const meta = memory.readRamRecordByte(address + GC_VISIT_HEADER_BYTE);
			word(address + GC_RECORD_LINK, 0xffff1234);
			list(indexOfRecord(address), tail, 4);
			check(9, [0, 0]);
			assert.deepEqual(visits(), [0, 0, 0]);
			assert.deepEqual(frontier(), [0, 0]);
			assert.equal(memory.readRamRecordByte(address + GC_VISIT_HEADER_BYTE), meta);
			assert.equal(memory.readRamRecordWord(address + GC_RECORD_LINK), 0xffff1234);
		}
	});

	test(`BLua weak cursor preserves the originating mode width at O${optLevel}`, () => {
		const { memory, oracle, control, word, byte, table, begin, finish, check, compare, frontier } = fixture(optLevel);
		const receiver = table(2, 0), dead = table(0, 0);
		byte(dead.record + GC_COLOR_OFFSET, 0x91);
		const rawCursor = (0xa02 << CURSOR_SHIFT) >>> 0;
		for (const narrow of [0, 1]) {
			receiver.arraySlot(0, ValueTag.Table, dead.record);
			word(control + GC_TRACE_RECORD, receiver.record);
			word(control + GC_TRACE_CURSOR, rawCursor);
			if (!narrow) {
				check(1, [1, 0]);
				assert.deepEqual(frontier(), [receiver.record, (rawCursor | 1) >>> 0]);
			} else {
				assert.deepEqual(begin(1, narrow), [1, 0]);
				assert.deepEqual(finish().result, [1, 0]);
				const cppCursor = (2 << CURSOR_SHIFT) | 1; // mapped native u8 cast, not a C++ execution oracle
				assert.deepEqual(frontier(), [receiver.record, cppCursor]);
				assert.equal(oracle.memory.readRamRecordWord(control + GC_TRACE_CURSOR), (rawCursor | 1) >>> 0);
				oracle.memory.writeRamRecordWord(control + GC_TRACE_CURSOR, cppCursor);
				compare('native mirror differs only in saved mode width');
			}
			assert.equal(memory.readRamRecordWord(receiver.arrayBase), 0);
		}
	});
}
