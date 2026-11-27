import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import { setReferenceGlobal } from '../helpers/global_bank_reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_LAST_EPOCH_WORK, GC_ROOT_CURSOR, GC_TRACE_HEAD, GcPhase, GC_DIAGNOSTIC_OFFSET, GcDiagnosticField } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_GRAY_INDEX_MASK } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { valueInteger, valueNil, valueString, valueTable } from '../../machine/ts/machine/cpu/value';
import { CPU_FIXED_FRAME_COUNT, CPU_FIXED_VALUE_COUNT, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_ROOT_BANKS_OFFSET, GC_TRACE_CONTEXT_OFFSET, GcTraceContextField } from '../helpers/firmware_heap_layout';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { compileTestSystemWithHeap, createTestHeapServiceCpu } from '../helpers/heap_service_system';

const MODULE = 'kernel/gc_mark_quantum';
const entrySource = 'halt_until_irq';
const modules = [
	'dlmalloc', 'gc_control', 'gc_strings', 'word_arithmetic', 'gc_pace', 'heap_admission', 'gc_epoch',
	'gc_mark', 'gc_capture_trace', 'gc_thread_trace', 'gc_table_head', 'gc_table_mode', 'gc_weak_mode', 'gc_table_trace',
	'string_record', 'gc_trace', 'gc_root_banks', 'gc_remark', 'gc_mark_quantum',
].map(name => {
	const path = `kernel/${name}`, source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});

function fixture(optLevel: 0 | 3) {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	const exported = object.sections.rodata.moduleExports.find(entry => entry.path === MODULE && entry.exportPathKey === 'mark_quantum');
	assert.ok(exported);
	const fn = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[exported.slotName]);
	assert.ok(fn >= 0);
	const { frames, valueSlots } = deriveBlua32FixedStack(linked.image, [fn]);
	assert.ok(frames <= CPU_FIXED_FRAME_COUNT && valueSlots <= CPU_FIXED_VALUE_COUNT, `pinned stack: ${frames} frames, ${valueSlots} slots`);
	const { cpu, memory } = createTestHeapServiceCpu(linked), oracle = createTestHeapServiceCpu(linked).cpu;
	const management = cpu.heapAllocator.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
	const metadata = management + HEAP_STRING_METADATA_OFFSET, context = management + GC_TRACE_CONTEXT_OFFSET;
	const head = management + GC_DIAGNOSTIC_OFFSET, roots = management + GC_ROOT_BANKS_OFFSET;
	const epochWork = control + GC_LAST_EPOCH_WORK - 4;
	const first = memory.ramBusEnd() - RAM_BASE;
	for (const target of [cpu, oracle]) {
		runGuestToHalt(target, 10_000);
		const live = createReferenceTable(target, 16, 0), child = createReferenceTable(target, 8, 0);
		setReferenceGlobal(target, nativeHeapReference(target).stringPool.intern('mark-quantum live root'), valueTable(live));
		nativeHeapReference(target).gc.tables.set(live, valueInteger(1), valueTable(child));
		nativeHeapReference(target).gc.tables.set(child, valueInteger(8), valueString(nativeHeapReference(target).stringPool.intern('mark-quantum nested String')));
		target.publishHeapRemarkHead();
		target.publishHeapRootBanks();
	}

	function begin(limit: number) {
		memory.writeRamRecordWord(context + GcTraceContextField.Limit, limit);
		memory.writeRamRecordWord(context + GcTraceContextField.PendingStringWork, nativeHeapReference(cpu).stringPool.takeMarkWork());
		assert.ok(cpu.beginHeapService(linked.image.functions[fn].address,
			[control, cpu.heapAllocator.allocatorStateOffset(), metadata, head, roots, context,
				cpu.gc.diagnosticWord(GcDiagnosticField.Mode), cpu.heapAllocator.capacityBytes(), 0]));
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
		return [cpu.heapServiceResult(), cycles];
	}
	function compare() {
		const actual = memory.ramData().subarray(first, roots), want = oracle.memory.ramData().subarray(first, roots);
		if (Buffer.compare(actual, want) === 0) return;
		const diff = actual.findIndex((byte, index) => byte !== want[index]);
		assert.equal(actual[diff], want[diff], `first GC heap mismatch: 0x${(first + diff).toString(16)}`);
	}
	function reference(limit: number) {
		return nativeHeapReference(oracle).gc.step(valueNil(), valueNil(), valueNil(), 0, false, limit);
	}

	return { cpu, oracle, memory, control, epochWork, context, begin, grant, finish, compare, reference };
}

for (const optLevel of [0, 3] as const) {
	test(`One resident quantum executes the original major mark through Atomic admission at O${optLevel}`, () => {
		const f = fixture(optLevel);
		const limit = 4096, want = f.reference(limit);
		assert.equal(f.oracle.gc.phase(), GcPhase.Atomic);
		assert.ok(want > 0 && want < limit);
		f.begin(limit);
		for (let i = 0; i < 65536 && f.cpu.gc.phase() !== GcPhase.MarkAgain; ++i) f.grant(1);
		assert.equal(f.cpu.gc.phase(), GcPhase.MarkAgain);
		assert.ok(f.cpu.heapServiceActive(), 'remark and MarkAgain run in the same resident activation');
		assert.equal(f.memory.readRamRecordWord(f.control + GC_ROOT_CURSOR), 0);
		assert.equal(f.memory.readRamRecordWord(f.epochWork), 0, 'accounting does not precede completion of the source quantum');
		const middle = captureCpuCheckpoint(f.cpu);
		const finished = f.finish();
		assert.equal(f.cpu.gc.phase(), GcPhase.Atomic);
		assert.equal(finished[0], want);
		assert.equal(f.memory.readRamRecordWord(f.epochWork), want);
		f.compare();
		restoreCpuCheckpoint(f.cpu, middle);
		assert.deepEqual(f.finish(), finished);
		f.compare();
	});

	test(`Major mark resumes roots and drains pre-existing String credit before tracing at O${optLevel}`, () => {
		const f = fixture(optLevel);
		for (let i = 0; i < 256 && (f.memory.readRamRecordWord(f.control + GC_ROOT_CURSOR) !== 0
			|| (f.memory.readRamRecordWord(f.control + GC_TRACE_HEAD) & GC_GRAY_INDEX_MASK) === 0); ++i) {
			const limit = 1, want = f.reference(limit);
			f.begin(limit);
			assert.equal(f.finish()[0], want);
			f.compare();
		}
		assert.equal(f.cpu.gc.phase(), GcPhase.Mark);
		assert.equal(f.memory.readRamRecordWord(f.control + GC_ROOT_CURSOR), 0);
		const head = f.memory.readRamRecordWord(f.control + GC_TRACE_HEAD);
		assert.notEqual(head & GC_GRAY_INDEX_MASK, 0);
		// Source stepWork drains pending String work up front even with
		// no bank cursor. This can fill the allowance without popping gray.
		for (const cpu of [f.cpu, f.oracle]) nativeHeapReference(cpu).stringPool.resumeMarkWork(2);
		const want = f.reference(1);
		f.begin(1);
		assert.equal(f.finish()[0], want);
		assert.equal(want, 2);
		assert.equal(f.memory.readRamRecordWord(f.control + GC_TRACE_HEAD), head);
		assert.equal(f.memory.readRamRecordWord(f.context + GcTraceContextField.PendingStringWork), 0);
		f.compare();
	});
}

test('The major mark map names the pinned native decisions and the String latch boundary', () => {
	const basis = '04c10f896545d453bd50fe27ccb619b269966607';
	const pins = [
		['C', 'machine/cpp/machine/cpu/gc_heap.cpp'], ['H', 'machine/cpp/machine/cpu/gc_heap.h'],
		['S', 'machine/cpp/machine/cpu/string_pool.cpp'], ['O', 'machine/cpp/machine/cpu/gc_object.h'],
		['R', 'machine/cpp/machine/cpu/cpu.cpp'], ['M', 'machine/ts/spec/bmsx/memory_map.ts'],
	] as const;
	const source = new Map<string, { lines: string[]; covered: Set<number> }>(pins.map(([key, path]) => [
		key, { lines: execFileSync('git', ['show', `${basis}:${path}`], { encoding: 'utf8' }).split('\n'), covered: new Set() },
	]));
	const port = readFileSync('machine/bios/kernel/gc_mark_quantum.lua', 'utf8');
	assert.ok(port.includes(`-- Source basis: ${basis}.\n`));
	const body = port.split('\nreturn {')[0].split('\n');
	for (const [index, line] of body.entries()) {
		if (/^\s*(?:$|--|module<const>$|struct \w+$|end$)/.test(line)) continue;
		const origin = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(origin, `gc_mark_quantum.lua:${index + 1}: missing origin`);
		for (const entry of origin[1].trim().split(/\s+/)) {
			const [key, ranges] = entry.split(':');
			const file = source.get(key);
			assert.ok(file, `unknown pinned source ${key}`);
			for (const interval of ranges.split(',')) {
				const [first, last = first] = interval.split('-').map(Number);
				assert.ok(first > 0 && last >= first && last <= file.lines.length, `invalid source range ${entry}`);
				for (let n = first; n <= last; ++n) file.covered.add(n);
			}
		}
	}
	const native = source.get('C')!;
	for (const [first, last] of [[677, 678], [681, 684], [1072, 1082], [1092, 1093], [1104, 1108],
		[1123, 1129], [1135, 1135], [1138, 1141], [1154, 1158], [1187, 1192], [1197, 1199], [1252, 1258]]) {
		for (let line = first; line <= last; ++line) {
			const text = native.lines[line - 1].trim();
			if (/^(?:$|\/\/|[{}]$)/.test(text)) continue;
			assert.ok(native.covered.has(line), `unmapped C:${line}: ${text}`);
		}
	}
});
