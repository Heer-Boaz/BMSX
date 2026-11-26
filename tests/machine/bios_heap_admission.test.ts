import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { LUA_OUT_OF_MEMORY_SIGNAL } from '../../machine/ts/machine/cpu/errors';
import { GcPhase, GC_PACE_PAID, GC_WORK_WORD_CYCLES } from '../../machine/ts/machine/cpu/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { GC_STEP_WORDS, LuaAllocationRecovery } from '../../machine/ts/machine/cpu/lua_heap';
import { HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_VALUE_COUNT } from '../../machine/ts/spec/bmsx/heap_service';
import { HEAP_PAGE_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';

const MODULE = 'kernel/heap_admission', entrySource = 'halt_until_irq';
const basis = '04c10f896545d453bd50fe27ccb619b269966607';
const modules = ['kernel/dlmalloc', 'kernel/gc_control', 'kernel/gc_pace', 'kernel/word_arithmetic', MODULE].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8').replaceAll('\r\n', '\n');
	return { path, source, chunk: parseLuaChunk(source, path) };
});
const names = ['heap_capacity', 'allocation_debt', 'logical_fits', 'logical_assist_pressure', 'logical_assist_allowance',
	'limit_assist_allowance', 'spend_assist_allowance', 'credit_logical_assist', 'finish_collection', 'reservation_assist_allowance', 'begin_allocation_recovery'] as const;
type Entry = typeof names[number];

function fixture(optLevel: 0 | 3) {
	const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const linked = linkTestSystemBlua32(compiled), obj = encodeCompiledProgramObject(compiled);
	const roots = new Map(names.map(name => {
		const symbol = obj.sections.rodata.moduleExports.find(value => value.path === MODULE && value.exportPathKey === name);
		assert.ok(symbol);
		const index = linked.symbols.metadata.functionIds.indexOf(obj.link.symbols.exportProtoIdBySlot[symbol.slotName]);
		assert.ok(index >= 0, name);
		return [name, index];
	}));
	const { frames, valueSlots } = deriveBlua32FixedStack(linked.image, [...roots.values()]);
	assert.ok(frames <= HEAP_SERVICE_FRAME_COUNT && valueSlots <= HEAP_SERVICE_VALUE_COUNT, `pinned stack: ${frames} frames, ${valueSlots} values`);
	const { cpu, memory } = createTestSystemCpu(linked), oracle = createTestSystemCpu(linked).cpu;
	for (const target of [cpu, oracle]) assert.equal(target.runUntilDepth(0, 1024), RunResult.Halted);
	const arena = cpu.heapAllocator, control = arena.managementOffset() + HEAP_GC_CONTROL_OFFSET, state = arena.allocatorStateOffset();
	const pace = control + GC_PACE_PAID - 12;
	function same(action: (target: CPU) => void) {
		action(cpu); action(oracle);
	}
	function phase(value: number) { same(target => target.memory.writeRamRecordByte(control, value)); }
	function begin(name: Entry, ...args: number[]) {
		assert.ok(cpu.beginHeapService(linked.image.functions[roots.get(name)!].address, args));
	}
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		const spent = cycles - cpu.instructionBudgetRemaining;
		assert.ok(spent > 0);
		return spent;
	}
	function finish() {
		let spent = 0;
		for (let i = 0; i < 128 && cpu.heapServiceActive(); ++i) spent += grant(128);
		assert.equal(cpu.heapServiceActive(), false);
		return spent;
	}
	function call(name: Entry, ...args: number[]) {
		begin(name, ...args); finish();
		return cpu.heapServiceResult() | 0;
	}
	function setPace(words: readonly number[]) {
		same(target => words.forEach((word, index) => target.memory.writeRamRecordWord(pace + 4 * index, word)));
	}
	return { cpu, arena, oracle, memory, control, state, pace, same, phase, begin, grant, finish, call, setPace };
}

function nativeUnsignedAllowance(after: number, capacity: number, cycles: number,
	[basis, estimate, runway, paid, payAt]: readonly [number, number, number, number, number]) {
	if (after < payAt && after < capacity) return -1;
	if (after >= capacity) return Math.min(GC_STEP_WORDS, Math.trunc(cycles / GC_WORK_WORD_CYCLES));
	const product = BigInt.asUintN(64, BigInt(after - (basis | 0)) * BigInt(estimate));
	const due = BigInt.asUintN(64, product / BigInt(runway) - BigInt(paid));
	return Math.min(GC_STEP_WORDS, Math.trunc(cycles / GC_WORK_WORD_CYCLES), Number(due));
}

for (const opt of [0, 3] as const) {
	test(`firmware admission preserves logical debt, pressure, quota and target credit at O${opt}`, () => {
		const f = fixture(opt), { arena, cpu, oracle, state, call, phase, same } = f;
		const native = oracle.luaHeap, heap = cpu.luaHeap, occupied = heap.occupiedOffset;
		assert.equal(call('heap_capacity', state), native.capacity());
		const nextFloor = arena.floorAddress() + HEAP_PAGE_SIZE;
		same(target => { assert.ok(target.heapAllocator.setFloor(nextFloor)); });
		const capacity = native.capacity(), edge = capacity - (capacity >>> 3);
		assert.equal(call('heap_capacity', state), capacity);
		const used = 930, threshold = 1024;
		same(target => {
			target.memory.writeRamRecordWord(occupied, used);
			target.luaHeap.setCollectionTarget(threshold);
		});
		for (const p of [GcPhase.Pause, GcPhase.Mark, GcPhase.MarkAgain, GcPhase.Atomic, GcPhase.Sweep, GcPhase.Strings, 6, 7]) {
			phase(p);
			for (const amount of [94, 95, edge - used, edge - used + 1, capacity - used, capacity - used + 1, 0xffffffff]) {
				assert.equal(call('allocation_debt', state, amount), native.allocationDebt(amount));
				assert.equal(call('logical_fits', state, amount), +(used + amount <= capacity));
				assert.equal(call('logical_assist_pressure', state, amount), +native.logicalAssistPressure(amount));
			}
		}
		for (const [debt, pressure] of [[1, 0], [1023, 0], [1025, 0], [8193, 0], [7, 1]] as const)
			assert.equal(call('logical_assist_allowance', debt, pressure), native.logicalAssistAllowance(debt, pressure !== 0));
		for (const [budget, work] of [[-1, 0], [2, 0], [2, 1], [3, 1], [1024, 341], [1024, 342], [12287, 0xffffffff]] as const) {
			assert.equal(call('limit_assist_allowance', GC_STEP_WORDS, budget), Math.max(0, Math.min(GC_STEP_WORDS, Math.trunc(budget / GC_WORK_WORD_CYCLES))));
			assert.equal(call('spend_assist_allowance', budget, work), Math.max(0, budget - GC_WORK_WORD_CYCLES * work));
		}
		for (const [p, amount, debt, pressure, work] of [
			[GcPhase.Pause, 500, 100, 0, 512], [GcPhase.Mark, 500, 100, 0, 0], [GcPhase.Mark, 600, 300, 0, 512],
			[GcPhase.Mark, 1, capacity, 0, 1], [GcPhase.Strings, 512, 100, 1, 65], [GcPhase.Sweep, 512, 100, 1, 8192],
			[GcPhase.MarkAgain, 0xffffffff, 0xffffffff, 0, 0xffffffff],
		] as const) {
			phase(p);
			same(target => target.luaHeap.setCollectionTarget(threshold));
			native.creditLogicalAssist(amount, debt, pressure !== 0, work);
			call('credit_logical_assist', state, amount, debt, pressure, work);
			assert.equal(heap.collectionTarget(), native.collectionTarget());
			assert.equal(heap.usedBytes(), used);
		}
		for (const live of [0, 557862, edge - 256, edge + 1, capacity + 1, 0x80000000, 0xffffff7f, 0xffffffff]) {
			same(target => target.memory.writeRamRecordWord(occupied, live));
			native.finishCollection();
			call('finish_collection', state);
			assert.equal(heap.collectionTarget(), native.collectionTarget());
			assert.equal(heap.usedBytes(), live);
		}
	});

	test(`firmware reservation allowance preserves C++ wide signed growth and exact recovery tokens at O${opt}`, () => {
		const f = fixture(opt), { cpu, arena, oracle, state, call, phase, setPace } = f;
		const capacity = arena.capacityBytes(), requested = 64, after = arena.occupiedBytes() + requested;
		const budget = 3 * GC_STEP_WORDS;
		phase(GcPhase.Mark);
		const cases = [
			[after - 100, 80, 8, 512, after + 1], // before pay-at
			[after - 100, 80, 8, 512, after], // ordinary work
			[after - 100, 80, 8, 1000, after], // admitted zero-word call
			[after - 100, 80, 8, 1001, after], // u64 subtraction underflows
			[after + 1, 1, 0xffffffff, 0xffffffff, after], // negative growth, still only two due words
			[after - 0x80000000, 0xffffffff, 0x7fffffff, 0xffffffff, after], // high word cancels after subtracting paid
			[after - 0x80000000, 0xff012345, 3, 0xffffffff, after], // genuine wide result
			[after, 0, 7, 0, after],
		] as const;
		for (const [i, words] of cases.entries()) {
			setPace(words);
			const expected = nativeUnsignedAllowance(after, capacity, budget, words);
			assert.equal(call('reservation_assist_allowance', state, requested, budget), expected, String(words));
			if (i < 3) assert.equal(expected, oracle.gc.reservationAssistAllowance(requested) ?? -1);
			if (i === 3) assert.equal(oracle.gc.reservationAssistAllowance(requested), -1, 'prior TS is signed here');
			if (i === 4 || i === 5) assert.equal(expected, 2);
		}
		setPace(cases[5]);
		f.begin('reservation_assist_allowance', state, requested, budget);
		f.grant(128);
		assert.equal(cpu.heapServiceActive(), true, 'widened division can be interrupted');
		const checkpoint = captureCpuCheckpoint(cpu), remaining = f.finish();
		assert.equal(cpu.heapServiceResult(), 2);
		restoreCpuCheckpoint(cpu, checkpoint);
		assert.equal(f.finish(), remaining);
		assert.equal(cpu.heapServiceResult(), 2);
		assert.equal(call('reservation_assist_allowance', state, 0xffffffff, budget), GC_STEP_WORDS, 'wide occupied + requested reaches capacity');
		assert.equal(call('reservation_assist_allowance', state, capacity - arena.occupiedBytes(), 3), 1, 'physical-capacity edge lends one work unit');
		assert.equal(call('reservation_assist_allowance', state, capacity, 2), -1, 'unavailable policy grant is not a zero-word assist');
		for (const p of [GcPhase.Pause, GcPhase.Mark, GcPhase.Atomic, GcPhase.Strings, 6, 7]) {
			phase(p);
			if (p === GcPhase.Pause || p === GcPhase.Atomic || p >= 6)
				assert.equal(call('reservation_assist_allowance', state, capacity, budget), -1);
			for (const token of [LuaAllocationRecovery.CurrentOrFresh, LuaAllocationRecovery.Fresh, LuaAllocationRecovery.Exhausted]) {
				const result = call('begin_allocation_recovery', state, token);
				if (token === LuaAllocationRecovery.Exhausted) {
					assert.throws(() => oracle.gc.beginAllocationRecovery(token), reason => reason === LUA_OUT_OF_MEMORY_SIGNAL);
					assert.equal(result, -1);
				} else assert.equal(result, oracle.gc.beginAllocationRecovery(token));
			}
		}
	});
}

const pins = [
	['T', 'machine/ts/machine/cpu/lua_heap.ts', '9fcad1e20049b69a9f89bc69bad1495fdda8034214903dd1f8d140cc845041de'],
	['G', 'machine/ts/machine/cpu/gc_heap.ts', '6e4a6f52041f90fe008b9bc48352f82c5b6aa2fa9f017486d20246a6b002015e'],
	['A', 'machine/ts/machine/cpu/heap_allocator.ts', '79309f418c20016b037b26fae01b28c891c72a2ed155ba1f375d7bc11f6d42f1'],
	['X', 'machine/ts/machine/cpu/cpu.ts', 'a87b074b0239334eb04874f6e123c7858ef018cf89e2a92a5e952ba3070f3237'],
	['C', 'machine/cpp/machine/cpu/lua_heap.cpp', '0fb5c13cffa84c99fecf4530dd85dc60452274382db02f30cb394b0768d6c0b5'],
	['H', 'machine/cpp/machine/cpu/lua_heap.h', 'a94411b9ec1a8fe80a9bbee9ded60f6061fb6179d65ebb168f200585d6cb7964'],
	['K', 'machine/cpp/machine/cpu/gc_heap.cpp', '642cfe734d09e6ff9137cf072d003b978aed8773db642c435616d145ed9c953d'],
	['J', 'machine/cpp/machine/cpu/gc_heap.h', 'd69a5574b8596c374075b78d41d95db6acb5e3e24db555e8d860b807ba46fffc'],
	['D', 'machine/cpp/machine/cpu/heap_allocator.cpp', 'aea53d9b2fecb8ae6d17abda4987b08e2af8a4fdf9a8424c49e10fc84f9eb7a5'],
	['B', 'machine/cpp/machine/cpu/heap_allocator.h', '6d9ee691ce53d51eaf652a5904544ed3ecdd5352ec6c552a065f8a2d47d95d12'],
	['Y', 'machine/cpp/machine/cpu/cpu.cpp', '7a841489626f90a5b2678eb6f41453796180ba1385d28abc88c6e1c1ce6d9e5b'],
	['M', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0'],
] as const;

test('firmware admission pins each source decision without moving a native collector loop', () => {
	const source = modules.find(module => module.path === MODULE)!.source;
	assert.ok(source.includes(`-- Source basis: ${basis}.`));
	const references = new Map(pins.map(([key, file, sum]) => {
		const text = execFileSync('git', ['show', `${basis}:${file}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(text).digest('hex'), sum, file);
		return [key as string, { lines: text.split('\n'), covered: new Set<number>() }];
	}));
	for (const [i, line] of source.slice(0, source.lastIndexOf('\nreturn {')).split('\n').entries()) {
		if (/^\s*(?:$|--|module<const>$|struct \w+$|end$)/.test(line)) continue;
		const origin = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(origin, `${MODULE}:${i + 1}: missing origin`);
		for (const entry of origin[1].trim().split(/\s+/)) {
			const [key, spans] = entry.split(':'), reference = references.get(key);
			assert.ok(reference, entry);
			for (const span of spans.split(',')) {
				const [first, last = first] = span.split('-').map(Number);
				assert.ok(first > 0 && last >= first && last <= reference.lines.length, entry);
				for (let n = first; n <= last; ++n) reference.covered.add(n);
			}
		}
	}
	for (const [key, first, last, excluded] of [
		['T', 42, 70, []], ['C', 41, 69, []], ['G', 934, 948, []], ['K', 986, 999, []],
		['T', 314, 319, []], ['C', 324, 329, []],
		['G', 1111, 1117, [1115]], ['K', 1215, 1223, [1219, 1220, 1221]],
	] as const) {
		const reference = references.get(key)!;
		for (let index = first; index <= last; ++index) {
			if (/^\s*(?:$|\/\/|[{}]$)/.test(reference.lines[index - 1]) || (excluded as readonly number[]).includes(index)) continue;
			assert.ok(reference.covered.has(index), `${key}:${index}: ${reference.lines[index - 1]}`);
		}
	}
});
