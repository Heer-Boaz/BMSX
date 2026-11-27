import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_LAST_EPOCH_WORK, GC_ROOT_CURSOR, GC_TRACE_RECORD, GC_WEAK_VISITS, GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { HEAP_GC_CONTROL_OFFSET, HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import {
	HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_VALUE_COUNT,
} from '../../machine/ts/spec/bmsx/heap_service';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { compileTestSystemWithHeap, createTestHeapServiceCpu } from '../helpers/heap_service_system';

const EPOCH = 'kernel/gc_epoch', entrySource = 'halt_until_irq';
const basis = '04c10f896545d453bd50fe27ccb619b269966607';
const names = ['begin_mark', 'begin_initial_banks', 'finish_step', 'finish_atomic_collection', 'begin_strings', 'finish_strings'] as const;
const modules = ['kernel/dlmalloc', 'kernel/dlmalloc_record', 'kernel/gc_control', 'kernel/gc_strings', 'kernel/word_arithmetic',
	'kernel/gc_pace', 'kernel/heap_admission', EPOCH].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});

for (const optLevel of [0, 3] as const) test(`BIOS epoch transitions preserve collector cursors and native pacing at O${optLevel}`, () => {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const image = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	const indices = names.map(name => {
		const symbol = object.sections.rodata.moduleExports.find(entry => entry.path === EPOCH && entry.exportPathKey === name)!;
		const index = image.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[symbol.slotName]);
		assert.ok(index >= 0, name);
		return index;
	});
	const { frames, valueSlots } = deriveBlua32FixedStack(image.image, indices);
	assert.ok(frames <= HEAP_SERVICE_FRAME_COUNT && valueSlots <= HEAP_SERVICE_VALUE_COUNT);
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
		const end = management + HEAP_SERVICE_THREAD_OFFSET;
		assert.deepEqual(memory.ramData().subarray(management, end), oracle.memory.ramData().subarray(management, end));
	}
	function begin(name: typeof names[number], args: number[]) {
		assert.ok(cpu.beginHeapService(image.image.functions[indices[names.indexOf(name)]].address, args));
	}
	function finish(expected: number) {
		let spent = 0;
		for (let i = 0; i < 4096 && cpu.heapServiceActive(); ++i) {
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
			const paid = 1 - cpu.instructionBudgetRemaining;
			assert.ok(paid > 0);
			spent += paid;
		}
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.heapServiceResult(), expected);
		compare();
		return spent;
	}
	function invoke(name: typeof names[number], args: number[], expected = 0) {
		begin(name, args);
		finish(expected);
	}
	oracle.gc['setPhase'](GcPhase.Mark);
	oracle.stringPool.beginReachabilityEpoch();
	invoke('begin_mark', [control, metadata], 1);
	invoke('begin_mark', [control, metadata]);

	const occupied = cpu.heapAllocator.occupiedBytes();
	oracle.gc['beginInitialBanks']();
	begin('begin_initial_banks', [control, state, capacity]);
	for (let i = 0; i < 128 && memory.readRamRecordWord(control + GC_ROOT_CURSOR) === 0; ++i) {
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
	}
	assert.notEqual(memory.readRamRecordWord(control + GC_ROOT_CURSOR), 0);
	assert.equal(cpu.heapServiceActive(), true);
	const checkpoint = captureCpuCheckpoint(cpu);
	const cycles = finish(0);
	restoreCpuCheckpoint(cpu, checkpoint);
	assert.equal(finish(0), cycles);

	assert.ok(same(target => target.heapAllocator.allocate(512, true)));
	const after = oracle.gc['finishStepWork'](occupied, 207);
	invoke('finish_step', [control, state, occupied, 207], after);

	const table = same(target => target.createTable());
	same(target => target.gc['setPhase'](GcPhase.Atomic));
	const args = [control, state, metadata, capacity, 19];
	same(target => target.memory.writeRamRecordWord(control + GC_TRACE_RECORD, table));
	invoke('finish_atomic_collection', args, oracle.gc['finishAtomicCollection'](19));
	assert.equal(cpu.gc.phase(), GcPhase.Atomic);
	same(target => {
		target.memory.writeRamRecordWord(control + GC_TRACE_RECORD, 0);
		target.memory.writeRamRecordWord(control + GC_WEAK_VISITS, 1);
	});
	invoke('finish_atomic_collection', args, oracle.gc['finishAtomicCollection'](19));
	assert.equal(cpu.gc.phase(), GcPhase.Atomic);
	same(target => target.memory.writeRamRecordWord(control + GC_WEAK_VISITS, 0));
	const white = cpu.gc.white();
	invoke('finish_atomic_collection', args, oracle.gc['finishAtomicCollection'](19));
	assert.equal(cpu.gc.white(), white ^ 1);
	assert.equal(cpu.gc.phase(), GcPhase.Sweep);

	oracle.gc['beginStrings']();
	invoke('begin_strings', [control, metadata]);
	oracle.gc['finishStrings']();
	invoke('finish_strings', [control, metadata, state]);
	assert.equal(cpu.gc.phase(), GcPhase.Strings);
	for (let i = 0; i < 128 && cpu.stringPool.sweeping(); ++i) same(target => target.stringPool.sweepStep(4096));
	assert.equal(cpu.stringPool.sweeping(), false);
	oracle.gc['finishStrings']();
	invoke('finish_strings', [control, metadata, state]);
	assert.equal(cpu.gc.phase(), GcPhase.Pause);
	invoke('finish_step', [control, state, occupied, 1], oracle.gc['finishStepWork'](occupied, 1));
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
