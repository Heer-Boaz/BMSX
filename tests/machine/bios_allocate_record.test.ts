import { GcPhase } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CLOSURE_PROTOTYPE_ADDRESS, closureRecordBytes } from '../../machine/ts/machine/cpu/closure';
import { GC_OBJECT_PREFIX } from '../../toolchain/ts/firmware/stock_object_layout';
import { LuaAllocationMode } from '../helpers/native_heap/lua_heap';
import { TableHeader, TableRecords } from '../../machine/ts/machine/cpu/table';
import { ValueTag, valueNil } from '../../machine/ts/machine/cpu/value';
import { HEAP_PAGE_SIZE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_ROOT_BANKS_OFFSET, HEAP_GC_CONTROL_OFFSET } from '../helpers/firmware_heap_layout';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { firmwareProbeResult, grantFirmwareProbe, issueFirmwareProbe, linkFirmwareProbe } from '../helpers/ordinary_firmware_probe';

const enum Kind { Table, CanonicalClosure }
const enum Mode { Direct = 1, Scheduled, RetryCurrent, RetryFresh }
const modulePath = 'kernel/allocate_record', sourcePath = `machine/bios/${modulePath}.lua`;
const nativeBasis = '027fe97a6495926028a4cea6ef8cd15af8f5d191';
const headOffset = 0x6c;
function fixture(optLevel: 0 | 3) {
	const linked = linkFirmwareProbe(optLevel, [], [
		{ path: modulePath, member: 'allocate_record', arity: 6 },
	]);
	const { cpu, memory } = createTestHeapServiceCpu(linked), oracle = createTestHeapServiceCpu(linked).cpu;
	const management = nativeHeapReference(cpu).heapAllocator.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
	for (const target of [cpu, oracle]) {
		runGuestToHalt(target, 10_000);
		target.memory.writeRamRecordWord(management + GC_ROOT_BANKS_OFFSET, target.rootThread.address);
	}
	nativeHeapReference(cpu).luaHeap.setCollectionTarget(nativeHeapReference(cpu).luaHeap.capacity());
	const prototype = linked.vectors.startupFunctionAddress;
	function begin(kind: Kind, operand0: number, operand1: number, mode: Mode, sourceCycles = 0) {
		issueFirmwareProbe(cpu, [management, kind, operand0, operand1, mode, sourceCycles]);
	}
	function grant(budget: number): number {
		const spent = grantFirmwareProbe(cpu, budget);
		assert.ok(spent > 0);
		return spent;
	}
	function finish() {
		let cycles = 0;
		for (let n = 0; n < 512 && !cpu.isHaltedUntilIrq(); ++n) cycles += grant(1024);
		assert.ok(cpu.isHaltedUntilIrq());
		return cycles;
	}
	function compare() {
		// Root and sweep transport are not mirrored in the native oracle.
		const from = memory.ramBusEnd() - RAM_BASE, to = management + GC_ROOT_BANKS_OFFSET;
		const actual = memory.ramData().subarray(from, to), expected = oracle.memory.ramData().subarray(from, to);
		if (Buffer.compare(actual, expected) === 0) return;
		const index = actual.findIndex((word, i) => word !== expected[i]);
		assert.equal(actual[index], expected[index], `owned RAM differs at 0x${(from + index).toString(16)}`);
	}
	return { cpu, oracle, memory, control, prototype, head: () => memory.readRamRecordWord(control + headOffset),
		begin, grant, finish, compare };
}

function exhaust(f: ReturnType<typeof fixture>) {
	const arena = nativeHeapReference(f.cpu).heapAllocator;
	while (arena.allocate(HEAP_PAGE_SIZE - 8, true)) { /* keep external backing blocks live */ }
	while (arena.allocate(16, true)) { /* exhaust the remaining small fits */ }
}

for (const optLevel of [0, 3] as const) {
	test(`BIOS direct and scheduled records own their refused reservation, sweep and retry at O${optLevel}`, () => {
		const f = fixture(optLevel), { cpu, memory, oracle } = f;
		const array = 31, hash = 129, capacity = TableRecords.hashCapacity(hash);
		const deadText = 'reclaim before table reservation '.repeat(144);
		const dead = nativeHeapReference(cpu).stringPool.intern(deadText);
		exhaust(f);
		for (let n = 0; n < 4096 && nativeHeapReference(cpu).gc.phase() !== GcPhase.Strings; ++n)
			nativeHeapReference(cpu).gc.step(valueNil(), valueNil(), valueNil(), 0, false, 1);
		assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Strings);
		assert.equal(nativeHeapReference(cpu).stringPool.find(deadText), dead);
		const initial = captureCpuCheckpoint(cpu);
		restoreCpuCheckpoint(oracle, initial);
		assert.equal(nativeHeapReference(oracle).luaHeap.allocateRecord(TableRecords.HEADER_BYTES, true, array * 5, TableHeader.ArrayStorage,
			valueNil(), valueNil(), valueNil(), TableRecords.HEADER_CHARGE + TableRecords.allocationCharge(array, capacity),
			LuaAllocationMode.Retry, TableRecords.hashStorageBytes(capacity), TableHeader.HashStorage), 0);
		while (nativeHeapReference(oracle).gc.active()) nativeHeapReference(oracle).gc.step();
		const address = createReferenceTable(oracle, array, hash);
		assert.ok(address);
		for (const mode of [Mode.Direct, Mode.Scheduled]) {
			restoreCpuCheckpoint(cpu, initial);
			const previous = f.head(), occupied = nativeHeapReference(cpu).luaHeap.usedBytes();
			f.begin(Kind.Table, array, hash, mode);
			for (let n = 0; n < 16384 && memory.readRamRecordByte(dead) !== 0; ++n) f.grant(1);
			assert.equal(memory.readRamRecordByte(dead), 0, 'real recovery frees the disposable String');
			assert.ok(cpu.fixedInterruptActive(), 'physical refusal and reclamation do not retire the request');
			assert.equal(f.head(), previous, 'new Table is not published during the sweep');
			assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), occupied, 'the released kind byte precedes returning its logical charge');
			const halfway = captureCpuCheckpoint(cpu);
			const spent = f.finish();
			assert.equal(firmwareProbeResult(cpu), address - RAM_BASE);
			assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Pause);
			f.compare();
			restoreCpuCheckpoint(cpu, halfway);
			assert.equal(f.finish(), spent);
			assert.equal(firmwareProbeResult(cpu), address - RAM_BASE);
			f.compare();
		}
	});

	test(`BIOS canonical Closure and terminal RetryFresh use their original admission conditions at O${optLevel}`, () => {
		const f = fixture(optLevel), { cpu, memory } = f;
		const charge = nativeHeapReference(cpu).luaHeap.usedBytes(), previous = f.head();
		f.begin(Kind.CanonicalClosure, f.prototype, -1, Mode.Direct);
		f.finish();
		const address = RAM_BASE + firmwareProbeResult(cpu);
		assert.equal(f.head(), address);
		assert.notEqual(f.head(), previous);
		assert.equal(memory.readRamRecordByte(address), ValueTag.Closure);
		assert.equal(memory.readRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS), f.prototype);
		assert.ok(nativeHeapReference(cpu).heapAllocator.issuedObjectStart(address - RAM_BASE - GC_OBJECT_PREFIX));
		assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), charge + closureRecordBytes(0, false));

		exhaust(f);
		const physical = nativeHeapReference(cpu).heapAllocator.occupiedBytes(), logical = nativeHeapReference(cpu).luaHeap.usedBytes();
		f.begin(Kind.Table, 4, 8, Mode.RetryFresh, 2048);
		f.finish();
		assert.equal(firmwareProbeResult(cpu), 0);
		assert.equal(f.head(), address);
		assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Pause, 'terminal RetryFresh has no additional epoch');
		assert.equal(nativeHeapReference(cpu).heapAllocator.occupiedBytes(), physical);
		assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), logical);
	});

	test(`BIOS direct terminal OOM finishes a current epoch and one fresh epoch at O${optLevel}`, () => {
		const f = fixture(optLevel), { cpu } = f;
		exhaust(f);
		for (let n = 0; n < 4096 && nativeHeapReference(cpu).gc.phase() !== GcPhase.Strings; ++n)
			nativeHeapReference(cpu).gc.step(valueNil(), valueNil(), valueNil(), 0, false, 1);
		assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Strings);
		const white = nativeHeapReference(cpu).gc.white();
		f.begin(Kind.Table, 4, 129, Mode.Direct);
		f.finish();
		assert.equal(firmwareProbeResult(cpu), 0, 'the fresh epoch cannot supply an adequate backing');
		assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Pause);
		assert.equal(nativeHeapReference(cpu).gc.white(), white ^ 1, 'only the additional fresh epoch flips the white mark');
		f.begin(Kind.Table, 4, 129, Mode.RetryCurrent);
		f.finish();
		assert.equal(firmwareProbeResult(cpu), 0);
		assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Pause);
		assert.equal(nativeHeapReference(cpu).gc.white(), white, 'RetryCurrent refusal runs one fresh epoch before exhausting');
	});

	test(`BIOS charges logical assist to the original work allowance, not elapsed CPU cycles at O${optLevel}`, () => {
		const f = fixture(optLevel), { cpu } = f;
		const logical = nativeHeapReference(cpu).luaHeap.usedBytes(), charge = TableRecords.HEADER_CHARGE;
		nativeHeapReference(cpu).luaHeap.setCollectionTarget(logical);
		const initial = captureCpuCheckpoint(cpu);
		f.begin(Kind.Table, 0, 0, Mode.Scheduled, 2);
		const noAssist = f.finish();
		assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Pause);
		assert.equal(nativeHeapReference(cpu).luaHeap.collectionTarget(), logical);
		assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), logical + charge);
		restoreCpuCheckpoint(cpu, initial);
		f.begin(Kind.Table, 0, 0, Mode.Scheduled, 3);
		assert.ok(f.finish() > noAssist);
		assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Mark);
		assert.ok(nativeHeapReference(cpu).gc.epochWork() > 0);
		assert.equal(nativeHeapReference(cpu).luaHeap.collectionTarget(), logical + 2 * nativeHeapReference(cpu).gc.epochWork());
		assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), logical + charge);
	});
}

const copyBasis = '8cf6e61b2b8207a31ae7be9c7acb095910ff2793';
const pins = [
	['T', 'machine/ts/machine/cpu/cpu.ts', 'a87b074b0239334eb04874f6e123c7858ef018cf89e2a92a5e952ba3070f3237'],
	['C', 'machine/cpp/machine/cpu/cpu_heap_record.inl', '04c1252d518bdc9c1dac342fcd1c926c6b5d51dc90722f88669f93184de24bb1'],
	['L', 'machine/cpp/machine/cpu/lua_heap.cpp', '0fb5c13cffa84c99fecf4530dd85dc60452274382db02f30cb394b0768d6c0b5'],
	['A', 'machine/cpp/machine/cpu/cpu_table.cpp', 'ed0f14b7f90c940f0158c9311787b129577756405aeea09c95b4599fcae40101'],
	['G', 'machine/cpp/machine/cpu/gc_heap.cpp', '642cfe734d09e6ff9137cf072d003b978aed8773db642c435616d145ed9c953d'],
	['S', 'machine/ts/spec/bmsx/heap_service.ts', 'bc482465da3c8ce3fd1f82417a618446394c5a7327a19ec6af858d50c2f35eba'],
	['I', 'machine/ts/spec/blua32/instruction_format.ts', 'e00226cca919687ff4d602bfa9864b3e1ec7104940196cda3c2fde7a43ebaefa'],
	['B', 'machine/cpp/machine/cpu/table.cpp', 'a86cc7968f0dc250348f79e74d3fc8f1b4979fd51b48ff13176587f46bea26bc'],
	['J', 'machine/ts/machine/cpu/table.ts', '2efe7b0a10f355bb40683bb59cab15a58f0515ee7307e431e86af2fdd336c978'],
] as const;

test('record policy maps its original admission, refusal and exact retry sources', () => {
	const source = readFileSync(sourcePath, 'utf8');
	assert.match(source, new RegExp(`-- Source basis: ${nativeBasis}\\.`));
	const refs = new Map(pins.map(([key, file, sum]) => {
		const basis = key === 'B' || key === 'J' ? copyBasis : nativeBasis;
		const text = execFileSync('git', ['show', `${basis}:${file}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
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
