import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { GC_REMARK_VISIT_STATE, GC_ROOT_CURSOR, GC_TRACE_HEAD, GcPhase, GcRootBank, GC_DIAGNOSTIC_OFFSET } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_COLOR_OFFSET, GC_GRAY_INDEX_BITS, GC_GRAY_INDEX_MASK, GC_RECORD_LINK, GC_RECORD_MASK, GC_RECORD_SHIFT } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { ValueTag, valuePayload, valueString, valueTable, valueTag, type Value } from '../../machine/ts/machine/cpu/value';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { firmwareProbeResult, grantFirmwareProbe, issueFirmwareProbe, linkFirmwareProbe } from '../helpers/ordinary_firmware_probe';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';

const path = 'kernel/gc_operand_roots';
const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');

function fixture(optLevel: 0 | 3) {
	const linked = linkFirmwareProbe(optLevel, [{ path, source, chunk: parseLuaChunk(source, path) }], [{ path, member: 'mark_operand_roots', arity: 5 }]);
	const { cpu, memory } = createTestHeapServiceCpu(linked), oracle = createTestHeapServiceCpu(linked).cpu;
	const management = cpu.heapAllocator.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
	const arena = cpu.heapAllocator.allocatorStateOffset(), metadata = management + HEAP_STRING_METADATA_OFFSET;
	// The fixture borrows the shape of a parked root-head triple. It does not
	// set HasPendingAssignment or exercise the distinct parked-root path.
	const operands = management + GC_DIAGNOSTIC_OFFSET + 52;
	const floor = memory.ramBusEnd() - RAM_BASE;
	for (const target of [cpu, oracle]) runGuestToHalt(target, 10_000);

	function add(create: (target: typeof cpu) => number): number {
		const address = create(cpu);
		assert.equal(create(oracle), address);
		return address;
	}
	function publish(receiver: number, key: Value, value: Value) {
		for (const target of [cpu, oracle]) {
			const words = [receiver, valueTag(key), valuePayload(key), valueTag(value), valuePayload(value)];
			for (let i = 0; i < words.length; ++i) target.memory.writeRamRecordWord(operands + 4 * i, words[i]);
		}
	}
	function begin() {
		issueFirmwareProbe(cpu, [control, arena, metadata, operands, 0]);
	}
	function grant(cycles: number) {
		const paid = grantFirmwareProbe(cpu, cycles);
		assert.ok(paid > 0);
		return paid;
	}
	function finish() {
		let cycles = 0;
		for (let i = 0; i < 64 && !cpu.isHaltedUntilIrq(); ++i) cycles += grant(128);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		return [firmwareProbeResult(cpu), cycles];
	}
	function compare() {
		const actual = memory.ramData().subarray(floor, management + GC_DIAGNOSTIC_OFFSET);
		const expected = oracle.memory.ramData().subarray(floor, management + GC_DIAGNOSTIC_OFFSET);
		if (Buffer.compare(actual, expected) === 0) return;
		const diff = actual.findIndex((byte, index) => byte !== expected[index]);
		assert.equal(actual[diff], expected[diff], `first GC heap mismatch at 0x${(floor + diff).toString(16)}`);
	}
	return { cpu, memory, oracle, control, add, publish, begin, grant, finish, compare };
}

for (const optLevel of [0, 3] as const) {
	test(`Scoped Table operand roots follow the source major-remark suffix even at its work limit at O${optLevel}`, () => {
		const f = fixture(optLevel), receiver = f.add(cpu => createReferenceTable(cpu));
		const key = f.add(cpu => createReferenceTable(cpu)), value = f.add(cpu => createReferenceTable(cpu));
		const index = (address: number) => (address & GC_RECORD_MASK) >>> GC_RECORD_SHIFT;
		const cursor = GcRootBank.SystemConstants << (GC_GRAY_INDEX_BITS + 1);
		const write = (offset: number, word: number) => {
			for (const cpu of [f.cpu, f.oracle]) cpu.memory.writeRamRecordWord(f.control + offset, word);
		};
		write(GC_ROOT_CURSOR, cursor);
		f.publish(receiver, valueTable(key), valueTable(value));
		const limit = 13;
		assert.equal(nativeHeapReference(f.oracle).gc['remarkRoots'](valueTable(receiver), valueTable(key), valueTable(value), limit, limit, false), limit);
		f.begin();
		for (let i = 0; i < 4096 && f.memory.readRamRecordWord(f.control + GC_TRACE_HEAD) !== index(receiver); ++i) f.grant(1);
		assert.ok(!f.cpu.isHaltedUntilIrq());
		assert.equal(f.memory.readRamRecordWord(f.control + GC_TRACE_HEAD), index(receiver));
		assert.equal(f.memory.readRamRecordByte(receiver + GC_COLOR_OFFSET), 2);
		assert.equal(f.memory.readRamRecordByte(key + GC_COLOR_OFFSET), f.cpu.gc.white());
		assert.equal(f.memory.readRamRecordByte(value + GC_COLOR_OFFSET), f.cpu.gc.white());
		const stopped = captureCpuCheckpoint(f.cpu);
		const retired = f.finish();
		assert.equal(retired[0], 0, 'gray enqueues do not charge String work');
		assert.equal(f.memory.readRamRecordWord(f.control + GC_TRACE_HEAD), index(value));
		assert.equal(f.memory.readRamRecordWord(value + GC_RECORD_LINK) & GC_GRAY_INDEX_MASK, index(key));
		assert.equal(f.memory.readRamRecordWord(key + GC_RECORD_LINK) & GC_GRAY_INDEX_MASK, index(receiver));
		assert.equal(f.memory.readRamRecordWord(f.control + GC_ROOT_CURSOR), cursor);
		f.compare();
		restoreCpuCheckpoint(f.cpu, stopped);
		assert.deepEqual(f.finish(), retired);
		f.compare();
	});

	test(`Scoped Atomic operand suffix matches native explicit roots before its work cutoff at O${optLevel}`, () => {
		const f = fixture(optLevel), receiver = f.add(cpu => createReferenceTable(cpu));
		const key = f.add(cpu => nativeHeapReference(cpu).stringPool.intern('pending own Table assignment key'));
		const value = f.add(cpu => nativeHeapReference(cpu).stringPool.intern('pending own Table assignment value'));
		const cursor = GcRootBank.SystemConstants << (GC_GRAY_INDEX_BITS + 1);
		for (const cpu of [f.cpu, f.oracle]) {
			nativeHeapReference(cpu).stringPool.beginReachabilityEpoch();
			cpu.memory.writeRamRecordByte(f.control, GcPhase.Atomic);
			cpu.memory.writeRamRecordWord(f.control + GC_REMARK_VISIT_STATE, 3 << GC_GRAY_INDEX_BITS); // Roots
			cpu.memory.writeRamRecordWord(f.control + GC_ROOT_CURSOR, cursor);
		}
		f.publish(receiver, valueString(key), valueString(value));
		const want = nativeHeapReference(f.oracle).gc['finalMarkWork'](valueTable(receiver), valueString(key), valueString(value), true, 1);
		assert.equal(want, 2, 'the work cutoff follows both String marks');
		f.begin();
		assert.equal(f.finish()[0], want);
		assert.equal(f.memory.readRamRecordWord(f.control + GC_ROOT_CURSOR), cursor);
		f.compare();

		// A retry of the same roots does not double-credit their String
		// colors; the source prefix obtains its existing incoming work.
		nativeHeapReference(f.oracle).stringPool.resumeMarkWork(1);
		assert.equal(nativeHeapReference(f.oracle).gc['finalMarkWork'](valueTable(receiver), valueString(key), valueString(value), true, 1), 1);
		f.begin();
		assert.equal(f.finish()[0], 0);
		f.compare();
	});
}

test('The scoped operand leaf maps each operation to its pinned source, separately from parked roots', () => {
	const commit = /^-- Source basis: ([0-9a-f]{40})\.$/m.exec(source)![1];
	const coroutineBasis = /^-- Scoped CoroutineCreate basis: ([0-9a-f]{40})\.$/m.exec(source)![1];
	const detachedBasis = /^-- Detached frame basis: ([0-9a-f]{40})\.$/m.exec(source)![1];
	const borrowedBasis = /^-- Borrowed String basis: ([0-9a-f]{40})\.$/m.exec(source)![1];
	const copyBasis = /^-- Table copy basis: ([0-9a-f]{40})\.$/m.exec(source)![1];
	const bases: Record<string, string> = {
		T: 'machine/ts/machine/cpu/gc_heap.ts',
		C: 'machine/cpp/machine/cpu/gc_heap.cpp',
		H: 'machine/cpp/machine/cpu/gc_heap.h',
		A: 'machine/ts/machine/cpu/table.ts',
		B: 'machine/cpp/machine/cpu/table.cpp',
		V: 'machine/ts/machine/cpu/value.ts',
		W: 'machine/cpp/machine/cpu/value.h',
		S: 'machine/ts/machine/cpu/string_pool.ts',
		R: 'machine/cpp/machine/cpu/string_pool.cpp',
		M: 'machine/ts/spec/bmsx/memory_map.ts',
		E: 'machine/ts/machine/cpu/gc_heap.ts', F: 'machine/cpp/machine/cpu/gc_heap.cpp',
		L: 'machine/ts/machine/cpu/lua_heap.ts', N: 'machine/cpp/machine/cpu/lua_heap.cpp',
		P: 'machine/cpp/machine/cpu/table.cpp', Q: 'machine/ts/machine/cpu/table.ts',
		D: 'machine/cpp/machine/cpu/cpu.cpp', I: 'machine/cpp/machine/cpu/cpu_table.cpp',
		J: 'machine/cpp/machine/cpu/gc_heap.cpp', X: 'machine/ts/machine/cpu/cpu.ts',
		Y: 'machine/ts/machine/cpu/gc_heap.ts', U: 'machine/cpp/machine/cpu/call_state.h',
		K: 'machine/cpp/spec/bmsx/heap_service.h', Z: 'machine/ts/machine/cpu/string_pool.ts',
	};
	const lines = Object.fromEntries(Object.entries(bases).map(([key, path]) =>
		[key, execFileSync('git', ['show', `${key === 'Z' ? borrowedBasis : 'PQ'.includes(key) ? copyBasis : 'EFLN'.includes(key) ? coroutineBasis : 'DIJXYUK'.includes(key) ? detachedBasis : commit}:${path}`], { encoding: 'utf8' }).trimEnd().split('\n')]));
	const covered: Record<string, Set<number>> = Object.fromEntries(Object.keys(lines).map(key => [key, new Set()]));
	for (const line of source.split('\n')) {
		const text = line.trim();
		if (!text || /^(--|module<const>|end$|struct |return \{)/.test(text)) continue;
		const spans = [...text.matchAll(/\b([A-Z]):([0-9,-]+)/g)];
		assert.ok(spans.length > 0, `unmapped source operation: ${text}`);
		for (const [, label, locations] of spans) for (const location of locations.split(',')) {
			const [first, last = first] = location.split('-').map(Number);
			assert.ok(first >= 1 && last >= first && last <= lines[label].length, `${label}:${location}`);
			for (let index = first; index <= last; ++index) covered[label].add(index);
		}
	}
	for (const [label, boundaries] of [
		['D', [3259, 3260]], ['I', [15, 16, 18, 19, 20]], ['J', [727, 729, 730, 1032, 1033]],
		['X', [604, 605, 606, 610, 611, 612, 5395]], ['Y', [675, 678, 679, 964, 965]],
		['U', [41, 42, 124]], ['K', [84]],
	] as const) {
		for (const line of boundaries) assert.ok(covered[label].has(line), `unmapped detached scope source ${label}:${line}`);
	}
	for (const [label, boundaries] of [['T', [656, 657, 710, 711, 1060, 1061]], ['C', [677, 678, 734, 735, 1136, 1137]]] as const) {
		for (const line of boundaries) {
			assert.ok(covered[label].has(line), `missing source suffix ${label}:${line}`);
			assert.match(lines[label][line - 1], /markValue.*markValue.*markValue|takeMarkWork/);
		}
	}
});
