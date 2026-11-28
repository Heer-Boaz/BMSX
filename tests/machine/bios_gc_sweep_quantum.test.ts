import { GcPhase } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type CPU } from '../../machine/ts/machine/cpu/cpu';
import { GC_OBJECT_PREFIX } from '../../toolchain/ts/firmware/stock_object_layout';
import { valueNil, valueString, valueTable } from '../../machine/ts/machine/cpu/value';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_WORKSPACE_END, HEAP_GC_CONTROL_OFFSET } from '../helpers/firmware_heap_layout';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { firmwareProbeResult, grantFirmwareProbe, issueFirmwareProbe, linkFirmwareProbe } from '../helpers/ordinary_firmware_probe';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';

const MODULE = 'kernel/gc_sweep_quantum';
const basis = '027fe97a6495926028a4cea6ef8cd15af8f5d191';
const modules = ['kernel/dlmalloc', 'kernel/dlmalloc_record', 'kernel/gc_control', 'kernel/gc_pace', 'kernel/word_arithmetic',
	'kernel/gc_strings', 'kernel/gc_thread_compact', 'kernel/gc_objects', 'kernel/heap_admission', 'kernel/gc_epoch',
	'kernel/gc_runtime_layout', MODULE].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8').replaceAll('\r\n', '\n');
	return { path, source, chunk: parseLuaChunk(source, path) };
});
const objectCount = 0x70, sweepLink = 0x74;
const liveText = 'fused sweep-alive', deadText = 'fused sweep-garbage';

function fixture(optLevel: 0 | 3) {
	const linked = linkFirmwareProbe(optLevel, modules, [{ path: MODULE, member: 'sweep_quantum', arity: 4 }]);
	const { cpu, memory } = createTestHeapServiceCpu(linked), oracle = createTestHeapServiceCpu(linked).cpu;
	for (const target of [cpu, oracle]) runGuestToHalt(target, 10_000);
	const state = nativeHeapReference(cpu).heapAllocator.managementOffset(), control = state + HEAP_GC_CONTROL_OFFSET;
	const floor = memory.ramBusEnd() - RAM_BASE, last = state + GC_WORKSPACE_END;
	function same<T>(action: (target: CPU) => T): T {
		const result = action(cpu);
		assert.deepEqual(action(oracle), result);
		return result;
	}
	const [keep, live, dead, deadArray, deadHash] = same(target => {
		const { gc, luaHeap, stringPool } = nativeHeapReference(target);
		luaHeap.setCollectionTarget(luaHeap.capacity());
		const keep = createReferenceTable(target, 2, 0), live = stringPool.intern(liveText);
		const dead = stringPool.intern(deadText), deadArray = createReferenceTable(target, 3, 0), deadHash = createReferenceTable(target, 0, 8);
		for (let n = 0; n < 4096 && gc.phase() !== GcPhase.Sweep; ++n)
			gc.step(valueTable(keep), valueString(live), valueNil(), 0, false, 1);
		assert.equal(gc.phase(), GcPhase.Sweep);
		return [keep, live, dead, deadArray, deadHash];
	});
	const count = () => memory.readRamRecordWord(control + objectCount);
	const nativeCount = () => oracle.memory.readRamRecordWord(control + objectCount);
	const notices: number[] = [], nativeNotices: number[] = [];
	for (const [target, trace] of [[cpu, notices], [oracle, nativeNotices]] as const) {
		for (const address of [deadArray, deadHash]) target.memory.watchRamByte(address - RAM_BASE);
		target.memory.onRamWrite(offset => {
			const address = RAM_BASE + offset;
			if ((address === deadArray || address === deadHash) && target.memory.readRamRecordByte(offset) === 0
				&& !trace.includes(address)) trace.push(address);
		});
	}
	function compare() {
		const actual = memory.ramData().subarray(floor, last), expected = oracle.memory.ramData().subarray(floor, last);
		if (Buffer.compare(actual, expected) === 0) return;
		const mismatch = actual.findIndex((value, index) => value !== expected[index]);
		assert.equal(actual[mismatch], expected[mismatch], `private RAM differs at 0x${(floor + mismatch).toString(16)}`);
	}
	function begin(limit: number) {
		const expected = nativeHeapReference(oracle).gc.step(valueNil(), valueNil(), valueNil(), 0, false, limit);
		issueFirmwareProbe(cpu, [state, limit, 0, 0]);
		return expected;
	}
	function grant(cycles: number) {
		const spent = grantFirmwareProbe(cpu, cycles);
		assert.ok(spent > 0);
		return spent;
	}
	function finish(expected: number) {
		let spent = 0;
		for (let i = 0; i < 128 && !cpu.isHaltedUntilIrq(); ++i) spent += grant(512);
		assert.equal(firmwareProbeResult(cpu), expected);
		assert.deepEqual(notices, nativeNotices, 'derived notices are emitted once in retirement order');
		compare();
		return spent;
	}
	return { cpu, memory, control, keep, live, dead, deadArray, deadHash, count, nativeCount, notices, begin, grant, finish };
}

for (const opt of [0, 3] as const) {
	test(`fused sweep keeps the original allowance and updates pace once across Object→String at O${opt}`, () => {
		const f = fixture(opt), { cpu, memory } = f;
		assert.equal(f.begin(0), 0);
		f.finish(0);
		assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Sweep);
		const count = f.count(), charged = nativeHeapReference(cpu).luaHeap.usedBytes(), paceBefore = nativeHeapReference(cpu).gc.epochWork();
		const work = f.begin(12);
		assert.equal(work, 12);
		for (let n = 0; n < 8192 && memory.readRamRecordByte(f.deadHash) !== 0; ++n) f.grant(1);
		assert.ok(!cpu.isHaltedUntilIrq(), 'the kind write does not retire the fused root');
		assert.equal(memory.readRamRecordByte(f.deadHash), 0);
		assert.equal(nativeHeapReference(cpu).heapAllocator.issuedObjectStart(f.deadHash - RAM_BASE - GC_OBJECT_PREFIX), true);
		assert.equal(f.count(), count, 'the count still belongs to the live object quantum');
		assert.equal(nativeHeapReference(cpu).gc.epochWork(), paceBefore);
		assert.ok(nativeHeapReference(cpu).luaHeap.usedBytes() < charged, 'the Table already returned both backing allocations');
		assert.deepEqual(f.notices, [f.deadHash]);
		const notice = captureCpuCheckpoint(cpu);
		assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Sweep);
		for (let n = 0; n < 8192 && nativeHeapReference(cpu).gc.phase() === GcPhase.Sweep; ++n) f.grant(1);
		assert.ok(!cpu.isHaltedUntilIrq(), 'the same root owns both phases');
		assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Strings);
		assert.equal(f.count(), f.nativeCount());
		assert.ok(f.count() <= count - 2);
		assert.equal(nativeHeapReference(cpu).gc.epochWork(), paceBefore, 'object continuation does not account a second time');
		const handoff = captureCpuCheckpoint(cpu);
		const tail = f.finish(work);
		assert.equal(nativeHeapReference(cpu).gc.epochWork(), paceBefore + work);
		restoreCpuCheckpoint(cpu, handoff);
		assert.equal(f.finish(work), tail);
		restoreCpuCheckpoint(cpu, notice);
		f.notices.length = 1;
		assert.ok(f.finish(work) > tail);
		const rest = f.begin(4096);
		f.finish(rest);
		assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Pause);
		assert.equal(nativeHeapReference(cpu).stringPool.find(deadText), undefined);
		assert.equal(nativeHeapReference(cpu).stringPool.find(liveText), f.live);
		assert.equal(nativeHeapReference(cpu).gc.tableRecordAddress(f.keep), f.keep);
		assert.equal(nativeHeapReference(cpu).gc.tableRecordAddress(f.deadArray), 0);
	});

	test(`object exhaustion at exactly the grant defers String entry until the next quantum at O${opt}`, () => {
		const f = fixture(opt), { cpu, memory, control } = f;
		const limit = f.count();
		assert.equal(f.begin(limit), limit);
		f.finish(limit);
		assert.equal(memory.readRamRecordWord(control + sweepLink), 0);
		assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Sweep);
		assert.equal(nativeHeapReference(cpu).stringPool.find(deadText), f.dead);
		f.finish(f.begin(1));
		assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Strings);
	});
}

const pins = [
	['T', 'machine/ts/machine/cpu/gc_heap.ts', '6e4a6f52041f90fe008b9bc48352f82c5b6aa2fa9f017486d20246a6b002015e'],
	['C', 'machine/cpp/machine/cpu/gc_heap.cpp', '642cfe734d09e6ff9137cf072d003b978aed8773db642c435616d145ed9c953d'],
] as const;
test('fused reclamation maps the object quantum, residual String work, and the original pace retirement', () => {
	const source = modules.find(module => module.path === MODULE)!.source;
	assert.ok(source.includes(`-- Source basis: ${basis}.`));
	const refs = new Map(pins.map(([key, file, sum]) => {
		const text = execFileSync('git', ['show', `${basis}:${file}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(text).digest('hex'), sum, file);
		return [key as string, { lines: text.split('\n'), covered: new Set<number>() }];
	}));
	for (const [index, line] of source.slice(0, source.lastIndexOf('\nreturn {')).split('\n').entries()) {
		if (/^\s*(?:$|--|module<const>$|struct \w+$|end$)/.test(line)) continue;
		const origin = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(origin, `${MODULE}:${index + 1}: missing origin`);
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
	for (const [key, ranges] of [
		['T', [[992, 1016], [1081, 1082], [1087, 1088], [1320, 1325], [1327, 1327], [1331, 1332], [1364, 1367], [1384, 1387]]],
		['C', [[1027, 1033], [1072, 1082], [1166, 1167], [1175, 1176], [1438, 1443], [1462, 1465]]],
	] as const) {
		const ref = refs.get(key)!;
		for (const [first, last] of ranges) for (let n = first; n <= last; ++n) {
			if (/^\s*(?:$|\/\/|[{}]$)/.test(ref.lines[n - 1])) continue;
			assert.ok(ref.covered.has(n), `${key}:${n}: ${ref.lines[n - 1]}`);
		}
	}
});
