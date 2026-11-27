import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_CHANGED_HEAD, GC_REMARK_VISIT_INDEX, GC_REMARK_VISIT_STATE, GC_ROOT_CURSOR, GC_THREAD_VISITS, GC_TRACE_HEAD, GC_VISIT_COUNT, GC_VISIT_HEADER_BYTE, GC_VISIT_MEMBER, GC_VISIT_TAIL, GC_WEAK_VISITS, GcRootBank, GcDiagnosticField, GC_DIAGNOSTIC_OFFSET } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_COLOR_OFFSET, GC_GRAY_INDEX_BITS, GC_GRAY_INDEX_MASK, GC_RECORD_LINK, GC_RECORD_MASK, GC_RECORD_SHIFT } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { ValueTag, valuePayload, valueString, valueTable, valueTag } from '../../machine/ts/machine/cpu/value';
import { LUA_FAULT_REASON_INDEX_NAN } from '../../machine/ts/spec/blua32/cop0';
import { CPU_FIXED_FRAME_COUNT, CPU_FIXED_VALUE_COUNT, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_WORKSPACE_END } from '../helpers/firmware_heap_layout';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { compileTestSystemWithHeap, createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { allocateThreadRecordReference } from '../helpers/thread_allocation_reference';

const MODULE = 'kernel/gc_remark', entrySource = 'halt_until_irq';
const modules = ['kernel/dlmalloc', 'kernel/gc_control', 'kernel/gc_strings', 'kernel/gc_mark', MODULE].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});
const THREADS = 1 << GC_GRAY_INDEX_BITS, WEAK = 2 << GC_GRAY_INDEX_BITS, ROOTS = 3 << GC_GRAY_INDEX_BITS;
const BEFORE_CURSOR = 0x00100004, CONSTANTS = GcRootBank.SystemConstants << (GC_GRAY_INDEX_BITS + 1);
const index = (address: number) => (address & GC_RECORD_MASK) >>> GC_RECORD_SHIFT;

function fixture(optLevel: 0 | 3) {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	const { slotName } = object.sections.rodata.moduleExports.find(entry => entry.path === MODULE && entry.exportPathKey === 'remark_visits')!;
	const fn = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[slotName]);
	assert.ok(fn >= 0);
	const entry = linked.image.functions[fn].address;
	const { frames, valueSlots } = deriveBlua32FixedStack(linked.image, [fn]);
	assert.ok(frames <= CPU_FIXED_FRAME_COUNT && valueSlots <= CPU_FIXED_VALUE_COUNT, `pinned stack: ${frames} frames, ${valueSlots} values`);
	const { cpu, memory } = createTestHeapServiceCpu(linked), oracle = createTestHeapServiceCpu(linked).cpu;
	for (const target of [cpu, oracle]) runGuestToHalt(target, 10_000);
	const management = cpu.heapAllocator.managementOffset(), arena = cpu.heapAllocator.allocatorStateOffset();
	const control = management + HEAP_GC_CONTROL_OFFSET, metadata = management + HEAP_STRING_METADATA_OFFSET;
	const floor = memory.ramBusEnd() - RAM_BASE, last = management + GC_WORKSPACE_END;
	function same<T>(make: (target: CPU) => T) {
		const actual = make(cpu);
		assert.deepEqual(make(oracle), actual);
		return actual;
	}
	const put = (field: number, word: number) => same(t => t.memory.writeRamRecordWord(control + field, word));
	const get = (field: number) => memory.readRamRecordWord(control + field);
	const thread = () => same(t => allocateThreadRecordReference(t, 0));
	const table = () => same(t => createReferenceTable(t, 0, 0));
	const [t0, t1, t2] = [thread(), thread(), thread()];
	const [w0, w1, w2, staleTrace, changed, stringIndex, receiver, value] = Array.from({ length: 8 }, table);
	const string = (text: string) => same(t => t.stringPool.intern(text));
	const left = string('comparison left'), right = string('comparison right'), key = string('pending SETT key');
	const mode = same(t => t.gc.diagnosticWord(GcDiagnosticField.Mode));
	const descriptor = same(t => {
		const base = t.heapAllocator.allocate(72 + 4 * (LUA_FAULT_REASON_INDEX_NAN + 1), true);
		assert.ok(base);
		const faultBase = base + 72, ram = t.memory;
		const originalFaults = t.gc.diagnosticWord(GcDiagnosticField.FaultIds);
		for (let reason = 0; reason <= LUA_FAULT_REASON_INDEX_NAN; ++reason)
			ram.writeRamRecordWord(faultBase + reason * 4, ram.readRamRecordWord(originalFaults + reason * 4));
		const fields = [
			9, mode, t.gc.diagnosticWord(GcDiagnosticField.Index), t.gc.diagnosticWord(GcDiagnosticField.NewIndex), t.gc.diagnosticWord(GcDiagnosticField.Length), t.gc.diagnosticWord(GcDiagnosticField.Error),
			faultBase, valueTag(valueTable(stringIndex)), stringIndex, 1, left, right, 1, receiver,
			valueTag(valueString(key)), key, valueTag(valueTable(value)), value,
		];
		for (const [slot, word] of fields.entries()) ram.writeRamRecordWord(base + slot * 4, word);
		const remark = management + GC_DIAGNOSTIC_OFFSET;
		ram.writeRamRecordWord(remark + GcDiagnosticField.StringIndexTag, ValueTag.Table);
		ram.writeRamRecordWord(remark + GcDiagnosticField.StringIndexWord, stringIndex);
		t['stringComparison'].left = left;
		t['stringComparison'].right = right;
		t['stringComparison'].remaining = 1;
		for (const [list, records] of [[GC_THREAD_VISITS, [t0, t1, t2]], [GC_WEAK_VISITS, [w0, w1, w2]]] as const) {
			for (const record of records) {
				ram.writeRamRecordByte(record + GC_VISIT_HEADER_BYTE, 0x80);
				t.gc['appendVisit'](list, record);
			}
		}
		for (const record of [t0, t2, w0, w2]) ram.writeRamRecordByte(record + GC_COLOR_OFFSET, 0xa3);
		for (const record of [t1, w1]) ram.writeRamRecordByte(record + GC_COLOR_OFFSET, 0xa2);
		ram.writeRamRecordByte(changed + GC_COLOR_OFFSET, 2);
		t.stringPool.beginReachabilityEpoch();
		t.stringPool.resumeMarkWork(9);
		return base;
	});
	put(GC_TRACE_HEAD, index(staleTrace));
	put(GC_CHANGED_HEAD, index(changed));
	put(GC_REMARK_VISIT_STATE, THREADS);
	put(GC_ROOT_CURSOR, BEFORE_CURSOR);

	function compare(label: string) {
		const actual = memory.ramData().subarray(floor, last), expected = oracle.memory.ramData().subarray(floor, last);
		if (Buffer.compare(actual, expected) === 0) return;
		const offset = actual.findIndex((byte, i) => byte !== expected[i]);
		assert.equal(actual[offset], expected[offset], `${label}: RAM 0x${(floor + offset).toString(16)}`);
	}
	function begin(allowance: number, replaceColor = 0) {
		assert.ok(cpu.beginHeapService(entry, [control, arena, metadata, descriptor - RAM_BASE, allowance, replaceColor]));
	}
	function grant(budget: number) {
		assert.equal(cpu.runUntilDepth(0, budget), RunResult.Yielded);
		const spent = budget - cpu.instructionBudgetRemaining;
		assert.ok(spent > 0);
		return spent;
	}
	function finish() {
		let cycles = 0;
		for (let i = 0; i < 32 && cpu.heapServiceActive(); ++i) cycles += grant(512);
		// This isolated call borrows the work latch as a descriptor word.
		// Return it before comparing the native collector's physical latch.
		cpu.stringPool.resumeMarkWork(memory.readRamRecordWord(descriptor));
		return cycles;
	}
	function verify(allowance: number) {
		const stage = control + GC_REMARK_VISIT_STATE;
		const before = oracle.memory.readRamRecordWord(stage);
		const expected = oracle.gc['remarkVisits'](allowance);
		if (before !== ROOTS && oracle.memory.readRamRecordWord(stage) === ROOTS) {
			// The old native rule is retained only on this reference side.
			oracle.gc.markValue(valueTable(receiver));
			oracle.gc.markValue(valueString(key));
			oracle.gc.markValue(valueTable(value));
		}
		const carry = oracle.stringPool.takeMarkWork();
		oracle.stringPool.resumeMarkWork(carry);
		oracle.memory.writeRamRecordWord(descriptor, carry);
		assert.equal(cpu.heapServiceResult(), expected);
		compare(`allowance=${allowance}`);
		return expected;
	}
	function step(allowance: number) {
		begin(allowance);
		finish();
		return verify(allowance);
	}
	const marked = (id: number) => (memory.readRamRecordByte(id + 1) & 1) === (memory.readRamRecordWord(metadata + 12) & 1);
	return { cpu, memory, get, put, begin, grant, finish, verify, step, compare, marked, descriptor, mode, left, right, key,
		t0, t1, t2, w0, w1, w2, staleTrace, changed, stringIndex, receiver, value };
}

for (const optLevel of [0, 3] as const) {
	test(`BLua remark drains Threads and resumes weak visits before transferring Changed at O${optLevel}`, () => {
		const f = fixture(optLevel);
		assert.equal(f.step(1), 1);
		assert.equal(f.get(GC_THREAD_VISITS), index(f.t1));
		assert.equal(f.get(GC_THREAD_VISITS + GC_VISIT_COUNT), 2);
		assert.equal(f.memory.readRamRecordByte(f.t0 + GC_VISIT_HEADER_BYTE), 0x80);
		assert.equal(f.memory.readRamRecordByte(f.t0 + GC_COLOR_OFFSET), 0xa2);
		assert.equal(f.memory.readRamRecordWord(f.t0 + GC_RECORD_LINK), index(f.changed));
		assert.equal(f.step(2), 2);
		assert.equal(f.get(GC_THREAD_VISITS), 0);
		assert.equal(f.get(GC_THREAD_VISITS + GC_VISIT_TAIL), 0);
		assert.equal(f.get(GC_THREAD_VISITS + GC_VISIT_COUNT), 0);
		assert.equal(f.get(GC_REMARK_VISIT_INDEX), index(f.w0));
		assert.equal(f.get(GC_REMARK_VISIT_STATE), WEAK | 3);
		assert.equal(f.step(2), 2);
		assert.equal(f.get(GC_REMARK_VISIT_INDEX), index(f.w2));
		assert.equal(f.get(GC_REMARK_VISIT_STATE), WEAK | 1);
		assert.equal(f.get(GC_WEAK_VISITS), index(f.w0));
		assert.equal(f.get(GC_WEAK_VISITS + GC_VISIT_COUNT), 3);
		assert.equal(f.memory.readRamRecordByte(f.w0 + GC_VISIT_HEADER_BYTE) & GC_VISIT_MEMBER, GC_VISIT_MEMBER);
		assert.equal(f.step(1), 1);
		assert.equal(f.get(GC_REMARK_VISIT_STATE), WEAK);
		assert.equal(f.get(GC_TRACE_HEAD), index(f.staleTrace));
		assert.equal(f.get(GC_ROOT_CURSOR), BEFORE_CURSOR);
		assert.equal(f.step(0), 0);
		assert.equal(f.get(GC_REMARK_VISIT_STATE), WEAK);
		assert.equal(f.marked(f.mode), false);

		f.put(GC_CHANGED_HEAD, 0x81000000 | index(f.w2));
		assert.equal(f.step(1), 0);
		assert.equal(f.get(GC_REMARK_VISIT_STATE), ROOTS);
		assert.equal(f.get(GC_CHANGED_HEAD), 0);
		assert.equal(f.get(GC_TRACE_HEAD), index(f.value));
		assert.equal(f.memory.readRamRecordWord(f.value + GC_RECORD_LINK) & GC_GRAY_INDEX_MASK, index(f.receiver));
		assert.equal(f.memory.readRamRecordWord(f.receiver + GC_RECORD_LINK) & GC_GRAY_INDEX_MASK, index(f.stringIndex));
		assert.equal(f.memory.readRamRecordWord(f.stringIndex + GC_RECORD_LINK) & GC_GRAY_INDEX_MASK, index(f.w2));
		assert.ok([f.mode, f.left, f.right, f.key].every(f.marked));
		assert.ok(f.memory.readRamRecordWord(f.descriptor) > 9, 'root-head String work remains separate from the visit count');
		assert.equal(f.get(GC_ROOT_CURSOR), CONSTANTS);
	});

	test(`BLua remark resumes between the paired queue stores and before root cursor publication at O${optLevel}`, () => {
		const f = fixture(optLevel);
		assert.equal(f.step(6), 6);
		assert.equal(f.get(GC_REMARK_VISIT_STATE), WEAK);
		f.begin(1);
		for (let i = 0; i < 512 && f.get(GC_TRACE_HEAD) !== index(f.w2); ++i) f.grant(1);
		assert.ok(f.cpu.heapServiceActive());
		assert.equal(f.get(GC_TRACE_HEAD), index(f.w2));
		assert.equal(f.get(GC_CHANGED_HEAD), index(f.w2));
		assert.equal(f.get(GC_REMARK_VISIT_STATE), WEAK);
		const betweenHeads = captureCpuCheckpoint(f.cpu);
		let elapsed = 0;
		for (let i = 0; i < 512 && !f.marked(f.mode); ++i) elapsed += f.grant(1);
		assert.ok(f.cpu.heapServiceActive());
		assert.ok(f.marked(f.mode));
		assert.equal(f.get(GC_CHANGED_HEAD), 0);
		assert.equal(f.get(GC_REMARK_VISIT_STATE), ROOTS);
		assert.equal(f.get(GC_ROOT_CURSOR), BEFORE_CURSOR);
		const betweenRoots = captureCpuCheckpoint(f.cpu);
		const tail = f.finish();
		assert.equal(f.verify(1), 0);
		restoreCpuCheckpoint(f.cpu, betweenHeads);
		assert.equal(f.finish(), elapsed + tail);
		f.compare('rewind in the queue pair');
		restoreCpuCheckpoint(f.cpu, betweenRoots);
		assert.equal(f.finish(), tail);
		f.compare('rewind within ordered head roots');
	});
	test(`BLua remark keeps the originating C++ color and mode-root policies at O${optLevel}`, () => {
		const f = fixture(optLevel);
		f.begin(7, 1);
		f.finish();
		assert.equal(f.cpu.heapServiceResult(), 6);
		assert.equal(f.get(GC_REMARK_VISIT_STATE), ROOTS);
		assert.equal(f.get(GC_ROOT_CURSOR), CONSTANTS);
		assert.equal(f.memory.readRamRecordByte(f.t0 + GC_COLOR_OFFSET), 2);
		assert.equal(f.memory.readRamRecordByte(f.w0 + GC_COLOR_OFFSET), 2);
		assert.equal(f.marked(f.mode), false, 'C++ marks this String at epoch start, not here');
		assert.ok([f.left, f.right, f.key].every(f.marked));
	});

}
