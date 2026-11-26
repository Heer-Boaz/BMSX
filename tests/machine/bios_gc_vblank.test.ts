import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GcPhase, GC_LAST_EPOCH_WORK } from '../../machine/ts/machine/cpu/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { GC_STEP_WORDS } from '../../machine/ts/machine/cpu/lua_heap';
import { valueNil } from '../../machine/ts/machine/cpu/value';
import { HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_VALUE_COUNT } from '../../machine/ts/spec/bmsx/heap_service';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { compileTestSystemWithHeap } from '../helpers/heap_service_system';

const MODULE = 'kernel/gc_vblank', entrySource = 'halt_until_irq';
const basis = '04c10f896545d453bd50fe27ccb619b269966607';
const modules = ['kernel/dlmalloc', 'kernel/gc_control', 'kernel/word_arithmetic', 'kernel/gc_pace', 'kernel/heap_admission', MODULE].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8').replaceAll('\r\n', '\n');
	return { path, source, chunk: parseLuaChunk(source, path) };
});
const epochWork = GC_LAST_EPOCH_WORK - 4, sample = GC_LAST_EPOCH_WORK + 4, assist = GC_LAST_EPOCH_WORK + 8, fullEpochs = 0x8c;

function fixture(optLevel: 0 | 3) {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	const symbol = object.sections.rodata.moduleExports.find(entry => entry.path === MODULE && entry.exportPathKey === 'admit_vblank_collection');
	assert.ok(symbol);
	const root = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[symbol.slotName]);
	assert.ok(root >= 0);
	const { frames, valueSlots } = deriveBlua32FixedStack(linked.image, [root]);
	assert.ok(frames <= HEAP_SERVICE_FRAME_COUNT && valueSlots <= HEAP_SERVICE_VALUE_COUNT, `pinned stack: ${frames} frames, ${valueSlots} values`);
	const { cpu, memory } = createTestSystemCpu(linked), oracle = createTestSystemCpu(linked).cpu;
	for (const target of [cpu, oracle]) {
		runGuestToHalt(target, 10_000);
		assert.ok(target.heapAllocator.allocate(1024 * 1024, true));
	}
	const arena = cpu.heapAllocator, control = arena.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	const occupied = arena.occupiedBytes(), free = arena.unoccupiedBytes();
	assert.equal(oracle.heapAllocator.occupiedBytes(), occupied);
	function seed(phase: number, sampled: number, credit: number, done: number, last: number, epochs: number) {
		for (const target of [cpu, oracle]) {
			target.memory.writeRamRecordByte(control, phase);
			target.memory.writeRamRecordWord(control + sample, sampled);
			target.memory.writeRamRecordWord(control + assist, credit);
			target.memory.writeRamRecordPair(control + epochWork, done, last);
			target.memory.writeRamRecordByte(control + fullEpochs, epochs);
		}
	}
	function begin(waiting: boolean, rebuilding: number) {
		assert.ok(cpu.beginHeapService(linked.image.functions[root].address, [arena.allocatorStateOffset(), +waiting, rebuilding]));
	}
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		const spent = cycles - cpu.instructionBudgetRemaining;
		assert.ok(spent > 0);
		return spent;
	}
	function finish(expected: number) {
		let spent = 0;
		for (let i = 0; i < 128 && cpu.heapServiceActive(); ++i) spent += grant(256);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.heapServiceResult(), expected);
		assert.equal(arena.occupiedBytes(), occupied);
		return spent;
	}
	const lanes = (target: CPU) => [target.memory.readRamRecordWord(control + sample), target.memory.readRamRecordWord(control + assist)];
	return { cpu, oracle, occupied, free, seed, begin, grant, finish, lanes };
}

for (const opt of [0, 3] as const) {
	test(`BIOS VBlank preserves native pressure ordering and work allowance at O${opt}`, t => {
		const f = fixture(opt), { cpu, oracle, occupied, free } = f;
		let allowance = 0;
		const nativeStep = t.mock.method(oracle.gc, 'step', (...args: Parameters<CPU['gc']['step']>) => {
			assert.deepEqual(args.slice(0, 5), [valueNil(), valueNil(), valueNil(), 0, false]);
			allowance = args[5]!;
			return 0;
		});
		const edge = occupied - (free >>> 2);
		assert.equal(free & 3, 0);
		assert.ok(edge > 1);
		for (const [phase, sampled, credit, done, last, epochs, waiting, rebuilding, expected, wantSample, wantCredit] of [
			[GcPhase.Mark, 4, 0, 0, 0, 0, true, 8, 0, 4, 0], // rebuild excludes the sample
			[GcPhase.Mark, 5, 0, 0, 0, 2, true, 0, 0, 5, 0], // explicit GC excludes the sample
			[GcPhase.Atomic, 3, 7, 0, 0, 0, true, 0, 0, occupied, 7], // atomic records physical growth but owns its own quantum
			[GcPhase.Mark, occupied, 0, 0, 0xffffffff, 0, true, 0, 0, occupied, 0],
			[GcPhase.Mark, 0xffffffff, 0, 0, 0xffffffff, 0, true, 0, 0, occupied, 0], // unsigned previous occupancy
			[GcPhase.Mark, edge + 1, 0, 0, GC_STEP_WORDS, 0, true, 0, 0, occupied, 0], // just above projected pressure
			[GcPhase.Mark, edge, 0, 0, GC_STEP_WORDS, 0, true, 0, 4 * GC_STEP_WORDS, occupied, 1], // equality starts assist
			[GcPhase.MarkAgain, edge, 0, 0, GC_STEP_WORDS, 0, false, 0, GC_STEP_WORDS, occupied, 1],
			[GcPhase.MarkAgain, occupied, 9, 0, 0, 0, true, 0, 4 * GC_STEP_WORDS, occupied, 9], // existing assist stays latched
			[GcPhase.Strings, occupied, 1, 0, 0, 0, true, 0, GC_STEP_WORDS, occupied, 1],
			[6, occupied, 1, 0, 0, 0, true, 0, GC_STEP_WORDS, occupied, 1], // unused phase inputs select Pause
			[GcPhase.Pause, occupied - 4096, 0, 0, 0xffffffff, 0, true, 0, GC_STEP_WORDS, occupied, 1], // demand * quanta exceeds u32
			[GcPhase.Pause, occupied - 4096, 0, 0xffffffff, 0, 0, true, 0, 0, occupied, 0], // no unfinished epoch work
		] as const) {
			f.seed(phase, sampled, credit, done, last, epochs);
			if (waiting) oracle.haltUntilIrq(); else oracle.clearHaltUntilIrq();
			assert.equal(oracle.isHaltedUntilIrq(), waiting);
			oracle.tableRebuild.record = rebuilding;
			const before = nativeStep.mock.callCount();
			allowance = 0;
			oracle.gc.assistPhysicalPressureAtTick();
			assert.equal(nativeStep.mock.callCount() - before, +(expected !== 0));
			assert.equal(allowance, expected, `native decision in phase ${phase}`);
			f.begin(waiting, rebuilding);
			f.finish(expected);
			assert.deepEqual(f.lanes(oracle), [wantSample, wantCredit]);
			assert.deepEqual(f.lanes(cpu), f.lanes(oracle));
		}
	});

	test(`BIOS VBlank can rewind after sampling before arming physical assist at O${opt}`, () => {
		const f = fixture(opt), { cpu, occupied } = f;
		const previous = occupied - 4096;
		f.seed(GcPhase.Mark, previous, 0, 0, 0xffffffff, 0);
		f.begin(true, 0);
		for (let n = 0; n < 4096 && f.lanes(cpu)[0] === previous; ++n) f.grant(1);
		assert.ok(cpu.heapServiceActive());
		assert.deepEqual(f.lanes(cpu), [occupied, 0]);
		const checkpoint = captureCpuCheckpoint(cpu), elapsed = f.finish(4 * GC_STEP_WORDS);
		assert.deepEqual(f.lanes(cpu), [occupied, 1]);
		restoreCpuCheckpoint(cpu, checkpoint);
		assert.equal(f.finish(4 * GC_STEP_WORDS), elapsed);
		assert.deepEqual(f.lanes(cpu), [occupied, 1]);
	});
}

const pins = [
	['T', 'machine/ts/machine/cpu/gc_heap.ts', '6e4a6f52041f90fe008b9bc48352f82c5b6aa2fa9f017486d20246a6b002015e'],
	['C', 'machine/cpp/machine/cpu/gc_heap.cpp', '642cfe734d09e6ff9137cf072d003b978aed8773db642c435616d145ed9c953d'],
	['H', 'machine/cpp/machine/cpu/gc_heap.h', 'd69a5574b8596c374075b78d41d95db6acb5e3e24db555e8d860b807ba46fffc'],
	['L', 'machine/ts/machine/cpu/lua_heap.ts', '9fcad1e20049b69a9f89bc69bad1495fdda8034214903dd1f8d140cc845041de'],
	['A', 'machine/ts/machine/cpu/heap_allocator.ts', '79309f418c20016b037b26fae01b28c891c72a2ed155ba1f375d7bc11f6d42f1'],
	['B', 'machine/cpp/machine/cpu/heap_allocator.h', '6d9ee691ce53d51eaf652a5904544ed3ecdd5352ec6c552a065f8a2d47d95d12'],
	['D', 'machine/cpp/machine/cpu/heap_allocator.cpp', 'aea53d9b2fecb8ae6d17abda4987b08e2af8a4fdf9a8424c49e10fc84f9eb7a5'],
	['M', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0'],
] as const;
test('VBlank admission maps the pinned native decisions and separates the collection call boundary', () => {
	const source = modules.find(module => module.path === MODULE)!.source;
	assert.ok(source.includes(`-- Source basis: ${basis}.`));
	const references = new Map(pins.map(([key, file, sum]) => {
		const text = execFileSync('git', ['show', `${basis}:${file}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(text).digest('hex'), sum, file);
		return [key as string, { lines: text.split('\n'), covered: new Set<number>() }];
	}));
	for (const [i, line] of source.slice(0, source.lastIndexOf('\nreturn {')).split('\n').entries()) {
		if (/^\s*(?:$|--|module<const>$|end$)/.test(line)) continue;
		const origin = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(origin, `${MODULE}:${i + 1}: missing origin`);
		for (const entry of origin[1].trim().split(/\s+/)) {
			const [key, spans] = entry.split(':'), ref = references.get(key);
			assert.ok(ref, entry);
			for (const span of spans.split(',')) {
				const [first, last = first] = span.split('-').map(Number);
				assert.ok(first > 0 && last >= first && last <= ref.lines.length, entry);
				for (let n = first; n <= last; ++n) ref.covered.add(n);
			}
		}
	}
	for (const [key, first, last] of [['T', 889, 910], ['C', 929, 953]] as const) {
		const ref = references.get(key)!;
		for (let line = first; line <= last; ++line) {
			if (/^\s*(?:$|\/\/|[{}]$)/.test(ref.lines[line - 1])) continue;
			assert.ok(ref.covered.has(line), `${key}:${line}: ${ref.lines[line - 1]}`);
		}
	}
});
