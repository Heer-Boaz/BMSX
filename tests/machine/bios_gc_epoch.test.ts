import { GC_LAST_EPOCH_WORK, GC_ROOT_CURSOR, GC_TRACE_RECORD, GC_WEAK_VISITS, GcPhase } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type CPU } from '../../machine/ts/machine/cpu/cpu';
import { HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { GC_WORKSPACE_END, HEAP_GC_CONTROL_OFFSET } from '../helpers/firmware_heap_layout';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { firmwareProbeResult, grantFirmwareProbe, issueFirmwareProbe, linkFirmwareProbe } from '../helpers/ordinary_firmware_probe';

const EPOCH = 'kernel/gc_epoch';
const basis = '04c10f896545d453bd50fe27ccb619b269966607';
const leaves = [
	{ path: EPOCH, member: 'begin_mark', arity: 2 },
	{ path: EPOCH, member: 'begin_initial_banks', arity: 3, result: false },
	{ path: EPOCH, member: 'finish_step', arity: 4 },
	{ path: EPOCH, member: 'finish_atomic_collection', arity: 5 },
	{ path: EPOCH, member: 'begin_strings', arity: 2, result: false },
	{ path: EPOCH, member: 'finish_strings', arity: 3, result: false },
] as const;
const modules = ['kernel/dlmalloc', 'kernel/dlmalloc_record', 'kernel/gc_control', 'kernel/gc_strings', 'kernel/word_arithmetic',
	'kernel/gc_pace', 'kernel/heap_admission', EPOCH].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});

for (const optLevel of [0, 3] as const) test(`BIOS epoch transitions preserve collector cursors and native pacing at O${optLevel}`, () => {
	const image = linkFirmwareProbe(optLevel, modules, leaves);
	const { cpu, memory } = createTestHeapServiceCpu(image);
	const oracle = createTestHeapServiceCpu(image).cpu;
	for (const target of [cpu, oracle]) runGuestToHalt(target, 10_000);
	const management = cpu.heapAllocator.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
	const metadata = management + HEAP_STRING_METADATA_OFFSET, state = cpu.heapAllocator.allocatorStateOffset();
	const capacity = cpu.heapAllocator.capacityBytes();
	function same<T>(action: (target: CPU) => T) {
		const value = action(cpu);
		assert.deepEqual(action(oracle), value);
		return value;
	}
	function compare() {
		const end = management + GC_WORKSPACE_END;
		assert.deepEqual(memory.ramData().subarray(management, end), oracle.memory.ramData().subarray(management, end));
	}
	function begin(name: typeof leaves[number]['member'], args: number[]) {
		issueFirmwareProbe(cpu, args, leaves.findIndex(leaf => leaf.member === name));
	}
	function finish(expected: number) {
		let spent = 0;
		for (let i = 0; i < 4096 && !cpu.isHaltedUntilIrq(); ++i) {
			const paid = grantFirmwareProbe(cpu, 1);
			assert.ok(paid > 0);
			spent += paid;
		}
		assert.equal(firmwareProbeResult(cpu), expected);
		compare();
		return spent;
	}
	function invoke(name: typeof leaves[number]['member'], args: number[], expected = 0) {
		begin(name, args);
		finish(expected);
	}
	nativeHeapReference(oracle).gc['setPhase'](GcPhase.Mark);
	nativeHeapReference(oracle).stringPool.beginReachabilityEpoch();
	invoke('begin_mark', [control, metadata], 1);
	invoke('begin_mark', [control, metadata]);

	const occupied = cpu.heapAllocator.occupiedBytes();
	nativeHeapReference(oracle).gc['beginInitialBanks']();
	begin('begin_initial_banks', [control, state, capacity]);
	for (let i = 0; i < 128 && memory.readRamRecordWord(control + GC_ROOT_CURSOR) === 0; ++i) {
		grantFirmwareProbe(cpu, 1);
	}
	assert.notEqual(memory.readRamRecordWord(control + GC_ROOT_CURSOR), 0);
	assert.ok(cpu.fixedInterruptActive());
	const checkpoint = captureCpuCheckpoint(cpu);
	const cycles = finish(0);
	restoreCpuCheckpoint(cpu, checkpoint);
	assert.equal(finish(0), cycles);

	assert.ok(same(target => nativeHeapReference(target).heapAllocator.allocate(512, true)));
	const after = nativeHeapReference(oracle).gc['finishStepWork'](occupied, 207);
	invoke('finish_step', [control, state, occupied, 207], after);

	const table = same(target => createReferenceTable(target));
	same(target => nativeHeapReference(target).gc['setPhase'](GcPhase.Atomic));
	const args = [control, state, metadata, capacity, 19];
	same(target => target.memory.writeRamRecordWord(control + GC_TRACE_RECORD, table));
	invoke('finish_atomic_collection', args, nativeHeapReference(oracle).gc['finishAtomicCollection'](19));
	assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Atomic);
	same(target => {
		target.memory.writeRamRecordWord(control + GC_TRACE_RECORD, 0);
		target.memory.writeRamRecordWord(control + GC_WEAK_VISITS, 1);
	});
	invoke('finish_atomic_collection', args, nativeHeapReference(oracle).gc['finishAtomicCollection'](19));
	assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Atomic);
	same(target => target.memory.writeRamRecordWord(control + GC_WEAK_VISITS, 0));
	const white = nativeHeapReference(cpu).gc.white();
	invoke('finish_atomic_collection', args, nativeHeapReference(oracle).gc['finishAtomicCollection'](19));
	assert.equal(nativeHeapReference(cpu).gc.white(), white ^ 1);
	assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Sweep);

	nativeHeapReference(oracle).gc['beginStrings']();
	invoke('begin_strings', [control, metadata]);
	nativeHeapReference(oracle).gc['finishStrings']();
	invoke('finish_strings', [control, metadata, state]);
	assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Strings);
	for (let i = 0; i < 128 && nativeHeapReference(cpu).stringPool.sweeping(); ++i) same(target => nativeHeapReference(target).stringPool.sweepStep(4096));
	assert.equal(nativeHeapReference(cpu).stringPool.sweeping(), false);
	nativeHeapReference(oracle).gc['finishStrings']();
	invoke('finish_strings', [control, metadata, state]);
	assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Pause);
	invoke('finish_step', [control, state, occupied, 1], nativeHeapReference(oracle).gc['finishStepWork'](occupied, 1));
	assert.equal(memory.readRamRecordWord(control + GC_LAST_EPOCH_WORK), 208);
});

test('epoch code maps to frozen native control flow, not host collector callbacks', () => {
	const pinned = [
		['T', 'machine/ts/machine/cpu/gc_heap.ts', '6e4a6f52041f90fe008b9bc48352f82c5b6aa2fa9f017486d20246a6b002015e'],
		['C', 'machine/cpp/machine/cpu/gc_heap.cpp', '642cfe734d09e6ff9137cf072d003b978aed8773db642c435616d145ed9c953d'],
		['H', 'machine/cpp/machine/cpu/gc_heap.h'], ['L', 'machine/ts/machine/cpu/lua_heap.ts'], ['B', 'machine/cpp/machine/cpu/lua_heap.cpp'],
		['A', 'machine/ts/machine/cpu/heap_allocator.ts'], ['N', 'machine/cpp/machine/cpu/heap_allocator.cpp'],
		['S', 'machine/ts/machine/cpu/string_pool.ts'], ['R', 'machine/cpp/machine/cpu/string_pool.cpp'], ['M', 'machine/ts/spec/bmsx/memory_map.ts'],
	] as const;
	const references = new Map(pinned.map(([name, path, expected]) => {
		const raw = execFileSync('git', ['show', `${basis}:${path}`], { encoding: 'utf8' });
		if (expected) assert.equal(createHash('sha256').update(raw).digest('hex'), expected, path);
		return [name as string, { lines: raw.split('\n'), covered: new Set<number>() }];
	}));
	const source = modules.find(module => module.path === EPOCH)!.source;
	assert.ok(source.includes(`Source basis: ${basis}.`));
	for (const [i, line] of source.slice(0, source.lastIndexOf('\nreturn {')).split('\n').entries()) {
		if (/^\s*(?:$|--|module<const>$|end$)/.test(line)) continue;
		const origin = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(origin, `gc_epoch.lua:${i + 1}: missing source for ${line.trim()}`);
		for (const part of origin[1].trim().split(/\s+/)) {
			const [name, ranges] = part.split(':'), reference = references.get(name)!;
			for (const range of ranges.split(',')) {
				const [first, last = first] = range.split('-').map(Number);
				assert.ok(first >= 1 && first <= last && last <= reference.lines.length, part);
				for (let n = first; n <= last; ++n) reference.covered.add(n);
			}
		}
	}
	for (const [name, ranges] of [
		['T', [[762, 770], [993, 1002], [1006, 1008], [1012, 1014], [1151, 1155]]],
		['C', [[788, 795], [1073, 1082], [1203, 1205], [1209, 1211], [1253, 1257]]],
	] as const) {
		const reference = references.get(name)!;
		for (const [first, last] of ranges) for (let n = first; n <= last; ++n) {
			if (/^\s*(?:\/\/|[{}]$)/.test(reference.lines[n - 1])) continue;
			assert.ok(reference.covered.has(n), `${name}:${n}: ${reference.lines[n - 1]}`);
		}
	}
});
