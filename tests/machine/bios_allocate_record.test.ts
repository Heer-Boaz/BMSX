import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CLOSURE_PROTOTYPE_ADDRESS, closureRecordBytes } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_OBJECT_PREFIX } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { LuaAllocationMode } from '../../machine/ts/machine/cpu/lua_heap';
import { TableHeader, TableRecords } from '../../machine/ts/machine/cpu/table';
import { ValueTag, valueNil } from '../../machine/ts/machine/cpu/value';
import { LUA_FAULT_REASON_INVALID_ARGUMENT, LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../machine/ts/spec/blua32/cop0';
import {
	HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_ROOT_BANKS_OFFSET, HEAP_SERVICE_VALUE_COUNT, HeapServiceRecordKind as Kind, HeapServiceRecordStage as Mode,
} from '../../machine/ts/spec/bmsx/heap_service';
import { HEAP_PAGE_SIZE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';

const modulePath = 'kernel/allocate_record', sourcePath = `machine/bios/${modulePath}.lua`;
const nativeBasis = '027fe97a6495926028a4cea6ef8cd15af8f5d191';
const entrySource = 'halt_until_irq', headOffset = 0x6c;
const gateProbe = `module<const>
local gate<const> = require('kernel/bios_create_table')
local probe<const> = function(management, mode, array_tag, array, hash_tag, hash)
	local status<const>, tag<const>, word<const> = gate.create_table(management, 0, mode, array_tag, array, hash_tag, hash)
	return status | (tag << 28) | word
end
return { probe = probe }`;

function fixture(optLevel: 0 | 3) {
	const modules = [
		'dlmalloc', 'dlmalloc_record', 'gc_runtime_layout', 'gc_control', 'gc_strings', 'word_arithmetic', 'gc_pace', 'heap_admission', 'gc_epoch',
		'gc_mark', 'gc_capture_trace', 'gc_thread_trace', 'gc_table_head', 'gc_table_mode', 'gc_weak_mode', 'gc_table_trace', 'string_record',
		'gc_trace', 'gc_root_banks', 'gc_remark', 'gc_weak_quantum', 'gc_weak_table', 'gc_mark_quantum', 'gc_atomic_quantum', 'gc_thread_compact',
		'gc_objects', 'gc_sweep_quantum', 'gc_step', 'closure_create', 'table_create', 'allocate_record', 'bios_create_table',
	].map(name => {
		const path = `kernel/${name}`, source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
		return { path, source, chunk: parseLuaChunk(source, path) };
	});
	modules.push({ path: 'test/gate_probe', source: gateProbe, chunk: parseLuaChunk(gateProbe, 'test/gate_probe') });
	const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	const symbol = object.sections.rodata.moduleExports.find(entry => entry.path === modulePath && entry.exportPathKey === 'allocate_record')!;
	const root = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[symbol.slotName]);
	assert.ok(root >= 0);
	const probe = object.sections.rodata.moduleExports.find(entry => entry.path === 'test/gate_probe' && entry.exportPathKey === 'probe')!;
	const gate = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[probe.slotName]);
	assert.ok(gate >= 0);
	const { frames, valueSlots } = deriveBlua32FixedStack(linked.image, [root, gate]);
	assert.ok(frames <= HEAP_SERVICE_FRAME_COUNT && valueSlots <= HEAP_SERVICE_VALUE_COUNT, `pinned stack: ${frames} frames, ${valueSlots} values`);
	const { cpu, memory } = createTestSystemCpu(linked), oracle = createTestSystemCpu(linked).cpu;
	for (const target of [cpu, oracle]) assert.equal(target.runUntilDepth(0, 1024), RunResult.Halted);
	cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
	const management = cpu.heapAllocator.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
	const prototype = linked.image.functions[root].address;
	function begin(kind: Kind, operand0: number, operand1: number, mode: Mode, sourceCycles = 0) {
		assert.ok(cpu.beginHeapService(prototype, [management, kind, operand0, operand1, mode, sourceCycles]));
	}
	function callGate(arrayTag: number, array: number, hashTag: number, hash: number) {
		assert.ok(cpu.beginHeapService(linked.image.functions[gate].address, [management, Mode.Direct, arrayTag, array, hashTag, hash]));
		finish();
		return cpu.heapServiceResult();
	}
	function grant(budget: number): number {
		assert.equal(cpu.runUntilDepth(0, budget), RunResult.Yielded);
		const spent = budget - cpu.instructionBudgetRemaining;
		assert.ok(spent > 0);
		return spent;
	}
	function finish() {
		let cycles = 0;
		for (let n = 0; n < 512 && cpu.heapServiceActive(); ++n) cycles += grant(1024);
		assert.equal(cpu.heapServiceActive(), false);
		return cycles;
	}
	function compare() {
		// Root and sweep transport are not mirrored in the native oracle.
		const from = memory.ramBusEnd() - RAM_BASE, to = management + HEAP_SERVICE_ROOT_BANKS_OFFSET;
		const actual = memory.ramData().subarray(from, to), expected = oracle.memory.ramData().subarray(from, to);
		if (Buffer.compare(actual, expected) === 0) return;
		const index = actual.findIndex((word, i) => word !== expected[i]);
		assert.equal(actual[index], expected[index], `owned RAM differs at 0x${(from + index).toString(16)}`);
	}
	return { cpu, oracle, memory, control, prototype, head: () => memory.readRamRecordWord(control + headOffset),
		begin, grant, finish, compare, callGate };
}

function exhaust(f: ReturnType<typeof fixture>) {
	const arena = f.cpu.heapAllocator;
	while (arena.allocate(HEAP_PAGE_SIZE - 8, true)) { /* keep external backing blocks live */ }
	while (arena.allocate(16, true)) { /* exhaust the remaining small fits */ }
}

for (const optLevel of [0, 3] as const) {
	test(`The guest table entry returns tagged success and faults without host table construction at O${optLevel}`, () => {
		const f = fixture(optLevel), { cpu } = f;
		const before = f.head();
		const word = f.callGate(ValueTag.Integer, 5, ValueTag.Integer, 9);
		const address = word & 0x0fff_ffff;
		assert.equal(word >>> 28, ValueTag.Table);
		assert.equal(f.head(), address);
		assert.notEqual(address, before);
		assert.equal(cpu.gc.tables.arrayCapacity(address), 5);
		assert.equal(cpu.gc.tables.hashSize(address), 16);

		assert.equal(f.callGate(ValueTag.String, 1, ValueTag.Integer, 2), LUA_FAULT_REASON_INVALID_ARGUMENT + 1);
		assert.equal(f.callGate(ValueTag.Integer, 0x8000, ValueTag.Integer, 2), LUA_FAULT_REASON_INVALID_ARGUMENT + 1);
		assert.equal(f.head(), address);
		exhaust(f);
		assert.equal(f.callGate(ValueTag.Integer, 31, ValueTag.Integer, 129), LUA_FAULT_REASON_OUT_OF_MEMORY + 1);
		assert.equal(cpu.gc.phase(), GcPhase.Pause);
	});

	test(`BIOS direct and scheduled records own their refused reservation, sweep and retry at O${optLevel}`, () => {
		const f = fixture(optLevel), { cpu, memory, oracle } = f;
		const array = 31, hash = 129, capacity = TableRecords.hashCapacity(hash);
		const deadText = 'reclaim before table reservation '.repeat(144);
		const dead = cpu.stringPool.intern(deadText);
		exhaust(f);
		for (let n = 0; n < 4096 && cpu.gc.phase() !== GcPhase.Strings; ++n)
			cpu.gc.step(valueNil(), valueNil(), valueNil(), 0, false, 1);
		assert.equal(cpu.gc.phase(), GcPhase.Strings);
		assert.equal(cpu.stringPool.find(deadText), dead);
		const initial = captureCpuCheckpoint(cpu);
		restoreCpuCheckpoint(oracle, initial);
		assert.equal(oracle.luaHeap.allocateRecord(TableRecords.HEADER_BYTES, true, array * 5, TableHeader.ArrayStorage,
			valueNil(), valueNil(), valueNil(), TableRecords.HEADER_CHARGE + TableRecords.allocationCharge(array, capacity),
			LuaAllocationMode.Retry, TableRecords.hashStorageBytes(capacity), TableHeader.HashStorage), 0);
		while (oracle.gc.active()) oracle.gc.step();
		const address = oracle.createTable(array, hash);
		assert.ok(address);
		for (const mode of [Mode.Direct, Mode.Scheduled]) {
			restoreCpuCheckpoint(cpu, initial);
			const previous = f.head(), occupied = cpu.luaHeap.usedBytes();
			f.begin(Kind.Table, array, hash, mode);
			for (let n = 0; n < 16384 && memory.readRamRecordByte(dead) !== 0; ++n) f.grant(1);
			assert.equal(memory.readRamRecordByte(dead), 0, 'real recovery frees the disposable String');
			assert.ok(cpu.heapServiceActive(), 'physical refusal and reclamation do not retire the request');
			assert.equal(f.head(), previous, 'new Table is not published during the sweep');
			assert.equal(cpu.luaHeap.usedBytes(), occupied, 'the released kind byte precedes returning its logical charge');
			const halfway = captureCpuCheckpoint(cpu);
			const spent = f.finish();
			assert.equal(cpu.heapServiceResult(), address - RAM_BASE);
			assert.equal(cpu.gc.phase(), GcPhase.Pause);
			f.compare();
			restoreCpuCheckpoint(cpu, halfway);
			assert.equal(f.finish(), spent);
			assert.equal(cpu.heapServiceResult(), address - RAM_BASE);
			f.compare();
		}
	});

	test(`BIOS canonical Closure and terminal RetryFresh use their original admission conditions at O${optLevel}`, () => {
		const f = fixture(optLevel), { cpu, memory } = f;
		const charge = cpu.luaHeap.usedBytes(), previous = f.head();
		f.begin(Kind.CanonicalClosure, f.prototype, -1, Mode.Direct);
		f.finish();
		const address = RAM_BASE + cpu.heapServiceResult();
		assert.equal(f.head(), address);
		assert.notEqual(f.head(), previous);
		assert.equal(memory.readRamRecordByte(address), ValueTag.Closure);
		assert.equal(memory.readRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS), f.prototype);
		assert.ok(cpu.heapAllocator.issuedObjectStart(address - RAM_BASE - GC_OBJECT_PREFIX));
		assert.equal(cpu.luaHeap.usedBytes(), charge + closureRecordBytes(0, false));

		exhaust(f);
		const physical = cpu.heapAllocator.occupiedBytes(), logical = cpu.luaHeap.usedBytes();
		f.begin(Kind.Table, 4, 8, Mode.RetryFresh, 2048);
		f.finish();
		assert.equal(cpu.heapServiceResult(), 0);
		assert.equal(f.head(), address);
		assert.equal(cpu.gc.phase(), GcPhase.Pause, 'terminal RetryFresh has no additional epoch');
		assert.equal(cpu.heapAllocator.occupiedBytes(), physical);
		assert.equal(cpu.luaHeap.usedBytes(), logical);
	});

	test(`BIOS direct terminal OOM finishes a current epoch and one fresh epoch at O${optLevel}`, () => {
		const f = fixture(optLevel), { cpu } = f;
		exhaust(f);
		for (let n = 0; n < 4096 && cpu.gc.phase() !== GcPhase.Strings; ++n)
			cpu.gc.step(valueNil(), valueNil(), valueNil(), 0, false, 1);
		assert.equal(cpu.gc.phase(), GcPhase.Strings);
		const white = cpu.gc.white();
		f.begin(Kind.Table, 4, 129, Mode.Direct);
		f.finish();
		assert.equal(cpu.heapServiceResult(), 0, 'the fresh epoch cannot supply an adequate backing');
		assert.equal(cpu.gc.phase(), GcPhase.Pause);
		assert.equal(cpu.gc.white(), white ^ 1, 'only the additional fresh epoch flips the white mark');
		f.begin(Kind.Table, 4, 129, Mode.RetryCurrent);
		f.finish();
		assert.equal(cpu.heapServiceResult(), 0);
		assert.equal(cpu.gc.phase(), GcPhase.Pause);
		assert.equal(cpu.gc.white(), white, 'RetryCurrent refusal runs one fresh epoch before exhausting');
	});

	test(`BIOS charges logical assist to the original work allowance, not elapsed CPU cycles at O${optLevel}`, () => {
		const f = fixture(optLevel), { cpu } = f;
		const logical = cpu.luaHeap.usedBytes(), charge = TableRecords.HEADER_CHARGE;
		cpu.luaHeap.setCollectionTarget(logical);
		const initial = captureCpuCheckpoint(cpu);
		f.begin(Kind.Table, 0, 0, Mode.Scheduled, 2);
		const noAssist = f.finish();
		assert.equal(cpu.gc.phase(), GcPhase.Pause);
		assert.equal(cpu.luaHeap.collectionTarget(), logical);
		assert.equal(cpu.luaHeap.usedBytes(), logical + charge);
		restoreCpuCheckpoint(cpu, initial);
		f.begin(Kind.Table, 0, 0, Mode.Scheduled, 3);
		assert.ok(f.finish() > noAssist);
		assert.equal(cpu.gc.phase(), GcPhase.Mark);
		assert.ok(cpu.gc.epochWork() > 0);
		assert.equal(cpu.luaHeap.collectionTarget(), logical + 2 * cpu.gc.epochWork());
		assert.equal(cpu.luaHeap.usedBytes(), logical + charge);
	});
}

const pins = [
	['T', 'machine/ts/machine/cpu/cpu.ts', 'a87b074b0239334eb04874f6e123c7858ef018cf89e2a92a5e952ba3070f3237'],
	['C', 'machine/cpp/machine/cpu/cpu_heap_record.inl', '04c1252d518bdc9c1dac342fcd1c926c6b5d51dc90722f88669f93184de24bb1'],
	['L', 'machine/cpp/machine/cpu/lua_heap.cpp', '0fb5c13cffa84c99fecf4530dd85dc60452274382db02f30cb394b0768d6c0b5'],
	['A', 'machine/cpp/machine/cpu/cpu_table.cpp', 'ed0f14b7f90c940f0158c9311787b129577756405aeea09c95b4599fcae40101'],
	['G', 'machine/cpp/machine/cpu/gc_heap.cpp', '642cfe734d09e6ff9137cf072d003b978aed8773db642c435616d145ed9c953d'],
	['S', 'machine/ts/spec/bmsx/heap_service.ts', 'bc482465da3c8ce3fd1f82417a618446394c5a7327a19ec6af858d50c2f35eba'],
	['I', 'machine/ts/spec/blua32/instruction_format.ts', 'e00226cca919687ff4d602bfa9864b3e1ec7104940196cda3c2fde7a43ebaefa'],
] as const;

test('record policy maps its original admission, refusal and exact retry sources', () => {
	const source = readFileSync(sourcePath, 'utf8');
	assert.match(source, new RegExp(`-- Source basis: ${nativeBasis}\\.`));
	const refs = new Map(pins.map(([key, file, sum]) => {
		const text = execFileSync('git', ['show', `${nativeBasis}:${file}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(text).digest('hex'), sum, file);
		return [key as string, { lines: text.split('\n'), covered: new Set<number>() }];
	}));
	for (const [index, line] of source.slice(0, source.lastIndexOf('\nreturn {')).split('\n').entries()) {
		if (/^\s*(?:$|--|module<const>$|end$)/.test(line)) continue;
		const origin = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(origin, `${sourcePath}:${index + 1}: missing origin`);
		for (const entry of origin[1].trim().split(/\s+/)) {
			const [key, spans] = entry.split(':'), ref = refs.get(key);
			assert.ok(ref, entry);
			for (const span of spans.split(',')) {
				const [first, last = first] = span.split('-').map(Number);
				assert.ok(first > 0 && last >= first && last <= ref.lines.length, entry);
				for (let n = first; n <= last; ++n) ref.covered.add(n);
			}
		}
	}
	for (const [key, slices] of [
		['T', [[801, 810], [826, 827], [832, 832], [843, 849], [903, 909], [933, 934], [970, 980]]],
		['C', [[5, 14], [35, 36], [43, 43], [54, 59], [118, 125], [134, 142], [210, 220]]],
		['L', [[103, 107], [145, 153], [161, 169]]],
		['G', [[1216, 1218], [1222, 1222], [1228, 1229]]],
	] as const) {
		const ref = refs.get(key)!;
		for (const [first, last] of slices) for (let n = first; n <= last; ++n) {
			if (/^\s*(?:$|\/\/|[{}]$)/.test(ref.lines[n - 1])) continue;
			assert.ok(ref.covered.has(n), `${key}:${n}: ${ref.lines[n - 1]}`);
		}
	}
});
