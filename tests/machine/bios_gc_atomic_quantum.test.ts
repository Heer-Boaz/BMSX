import { setReferenceGlobal } from '../helpers/global_bank_reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_LAST_EPOCH_WORK, GC_REMARK_VISIT_STATE, GC_TRACE_CURSOR, GC_TRACE_RECORD, GcPhase, GcDiagnosticField } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_GRAY_INDEX_BITS } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { ValueTag, valueInteger, valueString, valueTable, valueTag } from '../../machine/ts/machine/cpu/value';
import { CPU_FIXED_FRAME_COUNT, CPU_FIXED_VALUE_COUNT, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_ROOT_BANKS_OFFSET, GC_TRACE_CONTEXT_OFFSET, GcTraceContextField } from '../helpers/firmware_heap_layout';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { compileTestSystemWithHeap, createTestHeapServiceCpu } from '../helpers/heap_service_system';

const MODULE = 'kernel/gc_step', entrySource = 'return 11, 17, 23';
const modules = [
	'dlmalloc', 'gc_control', 'gc_strings', 'word_arithmetic', 'gc_pace', 'heap_admission', 'gc_epoch', 'gc_runtime_layout',
	'gc_mark', 'gc_capture_trace', 'gc_thread_trace', 'gc_table_head', 'gc_table_mode', 'gc_weak_mode', 'gc_table_trace',
	'string_record', 'gc_trace', 'gc_root_banks', 'gc_remark', 'gc_weak_table', 'gc_weak_quantum', 'gc_atomic_quantum',
].map(name => {
	const path = `kernel/${name}`, source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});
const clearWeak = 5 << GC_GRAY_INDEX_BITS;
const cursorBits = GC_GRAY_INDEX_BITS + 1;
const arraySlots = 16;

function fixture(optLevel: 0 | 3) {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	const exported = object.sections.rodata.moduleExports.find(entry => entry.path === MODULE && entry.exportPathKey === 'step');
	assert.ok(exported);
	const fn = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[exported.slotName]);
	assert.ok(fn >= 0);
	const { frames, valueSlots } = deriveBlua32FixedStack(linked.image, [fn]);
	assert.ok(frames <= CPU_FIXED_FRAME_COUNT && valueSlots <= CPU_FIXED_VALUE_COUNT, `pinned stack: ${frames} frames, ${valueSlots} slots`);
	const { cpu, memory } = createTestHeapServiceCpu(linked), oracle = createTestHeapServiceCpu(linked).cpu;
	const management = cpu.heapAllocator.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
	const context = management + GC_TRACE_CONTEXT_OFFSET;
	const roots = management + GC_ROOT_BANKS_OFFSET, first = memory.ramBusEnd() - RAM_BASE;
	const beforeWork = control + GC_LAST_EPOCH_WORK - 4;
	const records: number[][] = [];
	for (const target of [cpu, oracle]) {
		runGuestToHalt(target, 10_000);
		const { gc, stringPool } = target, modeKey = gc.diagnosticWord(GcDiagnosticField.Mode);
		const weak = target.createTable(arraySlots, 0), meta = target.createTable(0, 2);
		const firstDead = target.createTable(0, 0), secondDead = target.createTable(0, 0), retained = target.createTable(0, 0);
		gc.tables.set(meta, valueString(modeKey), valueString(stringPool.intern('v')));
		gc.tables.setMetatableAddress(weak, meta);
		gc.tables.set(weak, valueInteger(1), valueTable(firstDead));
		gc.tables.set(weak, valueInteger(2), valueTable(secondDead));
		gc.tables.set(weak, valueInteger(3), valueTable(retained));
		setReferenceGlobal(target, stringPool.intern('atomic weak table'), valueTable(weak));
		setReferenceGlobal(target, stringPool.intern('atomic strong value'), valueTable(retained));
		for (let i = 0; i < 64 && gc.phase() !== GcPhase.Atomic; ++i) gc.step();
		assert.equal(gc.phase(), GcPhase.Atomic);
		target.publishHeapRemarkHead();
		target.publishHeapRootBanks();
		records.push([weak, gc.tables.arrayAddress(weak), firstDead, secondDead, retained]);
	}
	assert.deepEqual(records[0], records[1]);
	const [weak, array, firstDead, secondDead, retained] = records[0];
	function begin(limit: number) {
		memory.writeRamRecordWord(context + GcTraceContextField.PendingStringWork, cpu.stringPool.takeMarkWork());
		assert.ok(cpu.beginHeapService(linked.image.functions[fn].address, [management, limit, 0, 0, 0]));
	}
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		const paid = cycles - cpu.instructionBudgetRemaining;
		assert.ok(paid > 0);
		return paid;
	}
	function finish() {
		let cycles = 0;
		for (let i = 0; i < 512 && cpu.heapServiceActive(); ++i) cycles += grant(512);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		cpu.stringPool.resumeMarkWork(memory.readRamRecordWord(context + GcTraceContextField.PendingStringWork));
		return [cpu.heapServiceResult(), cycles];
	}
	function compare() {
		const actual = memory.ramData().subarray(first, roots), want = oracle.memory.ramData().subarray(first, roots);
		if (Buffer.compare(actual, want) === 0) return;
		const diff = actual.findIndex((byte, index) => byte !== want[index]);
		assert.equal(actual[diff], want[diff], `first GC heap mismatch: 0x${(first + diff).toString(16)}`);
	}
	return { cpu, oracle, memory, control, context, beforeWork, weak, array, firstDead, secondDead, retained, begin, grant, finish, compare };
}

for (const optLevel of [0, 3] as const) {
	test(`One stopped guest Atomic quantum clears real weak values, then flips white and enters Sweep at O${optLevel}`, () => {
		const f = fixture(optLevel), limit = 4096;
		const initialWork = f.memory.readRamRecordWord(f.beforeWork), white = f.cpu.gc.white();
		const want = f.oracle.gc.stepFinalMark(limit);
		assert.equal(f.oracle.gc.phase(), GcPhase.Sweep);
		f.begin(limit);
		const tags = f.array + 4 * arraySlots;
		for (let i = 0; i < 65536 && f.memory.readRamRecordByte(tags) !== ValueTag.Nil; ++i) f.grant(1);
		assert.ok(f.cpu.heapServiceActive());
		assert.equal(f.memory.readRamRecordByte(tags), ValueTag.Nil);
		assert.equal(f.memory.readRamRecordByte(tags + 1), ValueTag.Table);
		assert.equal(f.memory.readRamRecordWord(f.control + GC_REMARK_VISIT_STATE), clearWeak);
		assert.equal(f.cpu.gc.phase(), GcPhase.Atomic);
		assert.equal(f.cpu.gc.white(), white);
		assert.equal(f.memory.readRamRecordWord(f.beforeWork), initialWork);
		const stopped = captureCpuCheckpoint(f.cpu);
		const finished = f.finish();
		assert.equal(finished[0], want);
		assert.equal(f.cpu.gc.phase(), GcPhase.Sweep);
		assert.equal(f.cpu.gc.white(), white ^ 1);
		assert.equal(f.memory.readRamRecordWord(f.beforeWork), initialWork + want);
		for (let slot = 1; slot <= 2; ++slot) assert.equal(valueTag(f.cpu.gc.tables.get(f.weak, valueInteger(slot))), ValueTag.Nil);
		assert.equal(f.cpu.gc.tables.get(f.weak, valueInteger(3)), valueTable(f.retained));
		for (const dead of [f.firstDead, f.secondDead])
			assert.equal(f.cpu.gc.tableRecordAddress(dead), dead, 'weak clear does not reclaim its referent');
		f.compare();
		restoreCpuCheckpoint(f.cpu, stopped);
		assert.deepEqual(f.finish(), finished);
		f.compare();
	});

	test(`Stopped guest Atomic quanta keep the native frontier and policy work at allowance one at O${optLevel}`, () => {
		const f = fixture(optLevel), white = f.cpu.gc.white();
		const stages = new Set<number>();
		for (let i = 0; i < 256 && f.cpu.gc.phase() === GcPhase.Atomic; ++i) {
			const want = f.oracle.gc.stepFinalMark(1);
			f.begin(1);
			assert.equal(f.finish()[0], want);
			f.compare();
			stages.add(f.memory.readRamRecordWord(f.control + GC_REMARK_VISIT_STATE) >>> GC_GRAY_INDEX_BITS);
			if (f.cpu.gc.phase() === GcPhase.Atomic) assert.equal(f.cpu.gc.white(), white);
		}
		assert.equal(f.cpu.gc.phase(), GcPhase.Sweep);
		assert.ok(stages.has(3) && stages.has(4) && stages.has(5), `separate Atomic continuations: ${[...stages].join(',')}`);
	});

	test(`Atomic weak resume narrows the saved cursor exactly as the C++ source at O${optLevel}`, () => {
		const f = fixture(optLevel);
		// A suspended weak-value table with high saved mode bits. C++
		// narrows mode to u8 before republishing the advanced cursor.
		f.memory.writeRamRecordWord(f.control + GC_REMARK_VISIT_STATE, clearWeak);
		f.memory.writeRamRecordWord(f.control + GC_TRACE_RECORD, f.weak);
		f.memory.writeRamRecordWord(f.control + GC_TRACE_CURSOR, 0x102 << cursorBits);
		f.begin(1);
		assert.equal(f.finish()[0], 1);
		assert.equal(f.memory.readRamRecordWord(f.control + GC_TRACE_RECORD), f.weak);
		assert.equal(f.memory.readRamRecordWord(f.control + GC_TRACE_CURSOR), (2 << cursorBits) | 1);
		assert.equal(f.cpu.gc.phase(), GcPhase.Atomic);
	});
}

test('The Atomic source map pins native gates, transport and weak retirement', () => {
	const basis = '027fe97a6495926028a4cea6ef8cd15af8f5d191';
	const pins = [
		['C', 'machine/cpp/machine/cpu/gc_heap.cpp'], ['H', 'machine/cpp/machine/cpu/gc_heap.h'],
		['S', 'machine/cpp/machine/cpu/string_pool.cpp'], ['O', 'machine/cpp/machine/cpu/gc_object.h'],
		['A', 'machine/cpp/machine/cpu/heap_allocator.cpp'],
	] as const;
	const sources = new Map<string, { lines: string[]; covered: Set<number> }>(pins.map(([key, path]) => [
		key, { lines: execFileSync('git', ['show', `${basis}:${path}`], { encoding: 'utf8' }).split('\n'), covered: new Set() },
	]));
	const port = readFileSync('machine/bios/kernel/gc_atomic_quantum.lua', 'utf8');
	assert.ok(port.includes(`-- Source basis: ${basis}.\n`));
	for (const [index, line] of port.split('\nreturn {')[0].split('\n').entries()) {
		if (/^\s*(?:$|--|module<const>$|struct \w+$|end$)/.test(line)) continue;
		const origin = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(origin, `gc_atomic_quantum.lua:${index + 1}: missing origin`);
		for (const item of origin[1].trim().split(/\s+/)) {
			const [key, ranges] = item.split(':');
			const file = sources.get(key);
			assert.ok(file, `unknown pinned source ${key}`);
			for (const interval of ranges.split(',')) {
				const [first, last = first] = interval.split('-').map(Number);
				assert.ok(first > 0 && last >= first && last <= file.lines.length, `invalid source range ${item}`);
				for (let n = first; n <= last; ++n) file.covered.add(n);
			}
		}
	}
	const native = sources.get('C')!;
	for (const [first, last] of [[717, 720], [725, 726], [742, 743], [748, 749], [751, 751],
		[759, 761], [764, 768], [784, 784], [787, 795]]) {
		for (let line = first; line <= last; ++line) {
			const text = native.lines[line - 1].trim();
			if (/^(?:$|\/\/|[{}]$)/.test(text)) continue;
			assert.ok(native.covered.has(line), `unmapped C:${line}: ${text}`);
		}
	}
});
