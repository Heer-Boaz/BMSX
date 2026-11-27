import { advanceTableRebuildReference, TableRebuildReference } from '../helpers/table_rebuild_reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_CHANGED_HEAD, GC_MODE_META, GC_TRACE_RECORD, GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_RECORD_MASK, GC_RECORD_SHIFT } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { TableHeader, TableRecords } from '../../machine/ts/machine/cpu/table';
import { ValueTag, hashCanonicalTableKey, valueInteger, valuePayload, valueString, valueTag } from '../../machine/ts/machine/cpu/value';
import { HeapServiceRemarkHeadField, HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_VALUE_COUNT } from '../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { StructTypes } from '../../toolchain/ts/lua/static/struct_types';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';
import { compileTestSystemWithHeap, createTestHeapServiceCpu } from '../helpers/heap_service_system';

const MODULE = 'kernel/table_prepare_rebuild', port = `machine/bios/${MODULE}.lua`, entrySource = 'halt_until_irq';
const basis = 'edfe988ff624b541b9162691b5d8bdae295b70bc';
const modules = ['kernel/dlmalloc', 'kernel/dlmalloc_record', 'kernel/gc_control', 'kernel/table_create', 'kernel/table_reinsert', 'kernel/table_assignment', MODULE].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8').replaceAll('\r\n', '\n');
	return { path, source, chunk: parseLuaChunk(source, path) };
});
const fields = ['source', 'count', 'storage', 'capacity', 'array_storage', 'array_slots', 'array_cleared', 'cleared',
	'key_tag', 'key_word', 'value_tag', 'value_word', 'homes', 'cursor', 'free', 'collisions'] as const;
const dirty = 0x9d;

function fixture(optLevel: 0 | 3) {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	const roots = ['prepare_table_rebuild', 'place_table_rebuild', 'publish_table_rebuild'].map(operation => {
		const symbol = object.sections.rodata.moduleExports.find(entry => entry.path === MODULE && entry.exportPathKey === operation);
		assert.ok(symbol);
		const root = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[symbol.slotName]);
		assert.ok(root >= 0);
		return root;
	});
	const { frames, valueSlots } = deriveBlua32FixedStack(linked.image, roots);
	assert.ok(frames <= HEAP_SERVICE_FRAME_COUNT && valueSlots <= HEAP_SERVICE_VALUE_COUNT, `pinned stack: ${frames} frames, ${valueSlots} values`);
	const { cpu, memory } = createTestHeapServiceCpu(linked), oracle = createTestHeapServiceCpu(linked).cpu;
	for (const target of [cpu, oracle]) runGuestToHalt(target, 10_000);
	const first = memory.ramBusEnd() - RAM_BASE, last = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_THREAD_OFFSET;
	function same<T>(action: (target: CPU) => T): T {
		const result = action(cpu);
		assert.deepEqual(action(oracle), result);
		return result;
	}
	const jobOffset = same(target => target.heapAllocator.allocate(64, true) - RAM_BASE);
	assert.ok(jobOffset > 0);
	function seed(job: TableRebuildReference): void {
		const words = [job.source, job.count, job.storage, job.capacity, job.arrayStorage, job.arraySlots, job.arrayCleared, job.cleared,
			valueTag(job.key), valuePayload(job.key), valueTag(job.value), valuePayload(job.value),
			job.homes, job.cursor, job.free, job.collisions];
		same(target => words.forEach((word, index) => target.memory.writeRamRecordWord(jobOffset + index * 4, word)));
	}
	function begin(job: TableRebuildReference, allowance: number, placement = false) {
		const expected = advanceTableRebuildReference(oracle.gc, job, allowance);
		assert.notEqual(job.record, 0, 'the policy grant stops before native publication');
		if (!placement) assert.equal(job.homes, 0, 'the prepare grants do not reach placement');
		const oracleMemory = oracle.memory;
		oracleMemory.writeRamRecordPair(jobOffset + 24, job.arrayCleared, job.cleared);
		oracleMemory.writeRamRecordPair(jobOffset + 48, job.homes, job.cursor);
		oracleMemory.writeRamRecordPair(jobOffset + 56, job.free, job.collisions);
		assert.ok(cpu.beginHeapService(linked.image.functions[roots[placement ? 1 : 0]].address, [job.record, jobOffset, allowance]));
		return expected;
	}
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		const used = cycles - cpu.instructionBudgetRemaining;
		assert.ok(used > 0);
		return used;
	}
	function retire(expected: number) {
		let spent = 0;
		for (let i = 0; i < 512 && cpu.heapServiceActive(); ++i) spent += grant(256);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.heapServiceResult() | 0, expected);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		return spent;
	}
	function compare() {
		const actual = memory.ramData().subarray(first, last), native = oracle.memory.ramData().subarray(first, last);
		if (Buffer.compare(actual, native) !== 0) {
			const mismatch = actual.findIndex((value, i) => value !== native[i]);
			assert.equal(actual[mismatch], native[mismatch], `private RAM differs at 0x${(first + mismatch).toString(16)}`);
		}
	}
	function finish(expected: number) {
		const spent = retire(expected);
		compare();
		return spent;
	}
	function beginPublication(job: TableRebuildReference, allowance: number) {
		const record = job.record, management = cpu.heapAllocator.managementOffset();
		const expected = advanceTableRebuildReference(oracle.gc, job, allowance);
		assert.equal(job.record, 0, 'the old operation reached its epilogue');
		const oracleMemory = oracle.memory;
		oracleMemory.writeRamRecordPair(jobOffset + 24, job.arrayCleared, job.cleared);
		oracleMemory.writeRamRecordPair(jobOffset + 48, job.homes, job.cursor);
		oracleMemory.writeRamRecordPair(jobOffset + 56, job.free, job.collisions);
		// A pure keep-hash resize can enter the final prep grant with no
		// placements; otherwise these fixtures reach publication via place.
		const prepareOnly = job.source === 0 && job.storage === 0;
		assert.ok(cpu.beginHeapService(linked.image.functions[roots[prepareOnly ? 0 : 1]].address, [record, jobOffset, allowance]));
		retire(expected);
		assert.ok(cpu.beginHeapService(linked.image.functions[roots[2]].address, [management, record, jobOffset, expected]));
		return expected;
	}
	const frontiers = () => [memory.readRamRecordWord(jobOffset + 24), memory.readRamRecordWord(jobOffset + 28)];
	const placement = () => [48, 52, 56, 60].map(offset => memory.readRamRecordWord(jobOffset + offset));
	return { cpu, memory, same, seed, begin, grant, finish, frontiers, placement, beginPublication };
}

for (const opt of [0, 3] as const) {
	test(`staged rebuild matches native transfer grants and packed hash initialization at O${opt}`, () => {
		const f = fixture(opt);
		for (const [kind, oldArray, array, oldHash, hash] of [
			['in-place', 2013, 2048, 128, 1024],
			['moved', 1027, 2048, 8, 128],
			['fresh', 0, 4, 128, 256],
		] as const) {
			const inPlace = kind === 'in-place';
			const record = f.same(target => target.createTable(inPlace ? array : oldArray, oldHash));
			const oldBase = f.same(target => target.gc.tables.arrayAddress(record));
			const source = f.same(target => target.gc.tables.hashAddress(record));
			const base = inPlace ? oldBase : f.same(target => target.heapAllocator.allocate(5 * array, true));
			const storage = f.same(target => target.heapAllocator.allocate(TableRecords.hashStorageBytes(hash), true));
			assert.ok(base && storage);
			f.same(target => {
				const { memory } = target;
				memory.writeRamRecordWord(record + TableHeader.Array, oldArray);
				// In the in-place case the owned extent has grown, but the
				// Table and its initialized tag plane still declare oldArray.
				memory.ramData().fill(dirty, base - RAM_BASE, base - RAM_BASE + 5 * array);
				memory.ramData().fill(dirty, storage - RAM_BASE, storage - RAM_BASE + TableRecords.hashStorageBytes(hash));
				for (let i = 0; i < oldArray; ++i) {
					memory.writeRamRecordWord(oldBase + 4 * i, 0x3af70021 + 17 * i);
					memory.writeRamRecordByte(oldBase + 4 * oldArray + i, [ValueTag.Integer, ValueTag.Float, ValueTag.True][i % 3]);
				}
				target.gc.tables.set(record, valueInteger(-5), valueInteger(71));
			});
			const j = Object.assign(new TableRebuildReference(), { record, source, count: oldHash, storage, capacity: hash,
				arrayStorage: base, arraySlots: array, key: valueInteger(kind === 'fresh' ? 4 : array + 1), value: valueInteger(913) });
			f.seed(j);
			assert.equal(f.begin(j, -2), -2);
			f.finish(-2);
			assert.deepEqual(f.frontiers(), [0, 0]);
			const transfer = 5 * array - (inPlace ? 4 * oldArray : 0);
			const nodeBytes = hash * (hash <= 128 ? 11 : 14);
			if (inPlace) {
				const grant = 96, copied = 16 * grant;
				const high = base + 4 * array + oldArray - 1, low = high - copied + 1;
				const priorHigh = f.memory.readRamRecordByte(high), priorLow = f.memory.readRamRecordByte(low);
				assert.equal(f.begin(j, grant), 0);
				for (let i = 0; i < 4096 && f.memory.readRamRecordByte(high) === priorHigh; ++i) f.grant(1);
				assert.ok(f.cpu.heapServiceActive());
				assert.notEqual(f.memory.readRamRecordByte(high), priorHigh);
				assert.equal(f.memory.readRamRecordByte(low), priorLow, 'overlapping transfer moves its high end first');
				assert.deepEqual(f.frontiers(), [0, 0], 'the original batch cursor is not published on a partial move');
				const checkpoint = captureCpuCheckpoint(f.cpu), elapsed = f.finish(0);
				assert.deepEqual(f.frontiers(), [copied, 0]);
				restoreCpuCheckpoint(f.cpu, checkpoint);
				assert.equal(f.finish(0), elapsed);
			}
			for (let index = 0; j.arrayCleared < transfer || j.cleared < nodeBytes; ++index) {
				const left = j.arrayCleared < transfer ? transfer - j.arrayCleared : nodeBytes - j.cleared;
				// Never give the native oracle spare budget for a placement pass.
				const allowance = Math.min((left + 15) >>> 4, [3, 17, 53][index % 3]);
				assert.equal(f.begin(j, allowance), 0);
				f.finish(0);
			}
			assert.deepEqual(f.frontiers(), [transfer, nodeBytes]);
			assert.equal(f.memory.readRamRecordWord(record + TableHeader.Array), oldArray);
			assert.equal(f.memory.readRamRecordWord(record + TableHeader.HashStorage), source);
			assert.equal(f.memory.readRamRecordByte(storage + nodeBytes - 1), 0xff);
			const home = hashCanonicalTableKey(j.key) & (hash - 1);
			assert.equal(f.memory.readRamRecordByte(storage + 8 * hash + home), kind === 'fresh' ? ValueTag.Nil : ValueTag.Integer);
			assert.equal(f.memory.readRamRecordWord(storage + nodeBytes), (oldHash > 64 ? 1 : 0) + (kind === 'fresh' ? 0 : 1));
			if (hash === 1024) assert.equal(f.memory.readRamRecordWord(storage + nodeBytes + 4 * (1 + 12)), 1);
		}
	});
}

for (const opt of [0, 3] as const) {
	test(`staged homes, occupied free probes, links and shrink match native RAM at O${opt}`, () => {
		const f = fixture(opt);
		for (const { oldArray, array, oldHash, hash } of [
			{ oldArray: 8, array: 16, oldHash: 8, hash: 128 },
			{ oldArray: 8, array: 16, oldHash: 128, hash: 128 },
			{ oldArray: 256, array: 224, oldHash: 128, hash: 1024 },
		]) {
			const mask = hash - 1, shrinking = array < oldArray;
			const record = f.same(target => target.createTable(oldArray, oldHash));
			const oldBase = f.same(target => target.gc.tables.arrayAddress(record));
			const source = f.same(target => target.gc.tables.hashAddress(record));
			const base = shrinking ? oldBase : f.same(target => target.heapAllocator.allocate(5 * array, true));
			const storage = f.same(target => target.heapAllocator.allocate(TableRecords.hashStorageBytes(hash), true));
			assert.ok(base && storage);
			const colliders: number[] = [];
			for (let key = -1; colliders.length < 4; --key) {
				if ((hashCanonicalTableKey(valueInteger(key)) & mask) === mask) colliders.push(key);
			}
			f.same(target => {
				const { memory, gc } = target;
				for (const index of [2, array - 1, oldArray - 3, oldArray - 1]) {
					if (index >= oldArray) continue;
					memory.writeRamRecordWord(oldBase + 4 * index, 0x52a50213 + index);
					memory.writeRamRecordByte(oldBase + 4 * oldArray + index, ValueTag.Integer);
				}
				for (const key of colliders.slice(1)) gc.tables.set(record, valueInteger(key), valueInteger(-key + 7));
				if (!shrinking) gc.tables.set(record, valueInteger(oldArray + 1), valueInteger(8801));
			});
			const j = Object.assign(new TableRebuildReference(), { record, source, count: oldHash, storage, capacity: hash,
				arrayStorage: base, arraySlots: array, free: mask, key: valueInteger(colliders[0]), value: valueInteger(387) });
			f.seed(j);
			const nodeBytes = hash * (hash <= 128 ? 11 : 14);
			const allowance = ((nodeBytes + 15) >>> 4) + (shrinking ? 0 : ((5 * array + 15) >>> 4));
			const prepare = f.begin(j, allowance);
			assert.equal(prepare, 0);
			f.finish(prepare);
			const next = (policy: number) => {
				const expected = f.begin(j, policy, true);
				f.finish(expected);
				return expected;
			};
			const sources = oldHash + (shrinking ? oldArray - array : 0);
			assert.equal(next(1), -7, 'a started mapping consumes all eight policy units');
			while (j.homes < oldHash - 1) next(8);
			if (shrinking) {
				assert.equal(next(8), 0);
				assert.equal(j.homes, oldHash);
				assert.equal(next(2), 0, 'eight absent Array tags cost two policy units');
				assert.equal(j.homes, oldHash + 8);
				while (j.homes < sources) next(8);
			} else {
				next(8);
				assert.equal(f.memory.readRamRecordWord(base + 4 * oldArray), 8801);
				assert.equal(f.memory.readRamRecordWord(storage + nodeBytes), 4,
					'count absent small-source census or subtract the migrated Integer when a census exists');
			}
			assert.equal(j.homes, sources);
			assert.equal(j.collisions, 3);
			while (j.free === mask && j.cursor < sources) {
				const cursor = j.cursor, expected = next(8);
				if (j.free === mask) continue;
				assert.equal(expected, 0);
				assert.equal(j.cursor, cursor, 'an occupied free candidate does not consume the source mapping');
				assert.equal(j.free, mask - 1);
				assert.equal(j.collisions, 3);
			}
			assert.equal(j.free, mask - 1, 'collisions reached their reserved home and traversed an occupied candidate');
			const tags = storage + 8 * hash, links = tags + 2 * hash;
			const expected = f.begin(j, 8, true);
			const tagAddress = tags + mask - 1;
			for (let step = 0; step < 256 && f.memory.readRamRecordByte(tagAddress) === ValueTag.Nil; ++step) f.grant(1);
			assert.equal(f.cpu.heapServiceActive(), true);
			assert.equal(f.memory.readRamRecordByte(tagAddress), ValueTag.Integer);
			const nextLink = () => hash <= 128 ? f.memory.readRamRecordByte(links + mask) : f.memory.readRamRecordWord(links + 4 * mask);
			assert.equal(nextLink(), hash <= 128 ? 255 : 0xffffffff, 'the key tag became visible before the chain link');
			const checkpoint = captureCpuCheckpoint(f.cpu), remaining = f.finish(expected);
			assert.equal(nextLink(), mask - 1);
			assert.deepEqual(f.placement(), [j.homes, j.cursor, mask - 2, 2]);
			restoreCpuCheckpoint(f.cpu, checkpoint);
			assert.equal(f.finish(expected), remaining, 'restore repeats the exact remaining collision grant');
			if (shrinking) {
				while (j.collisions) next(8);
				assert.equal(j.arrayCleared, 0);
				assert.equal(next(3), 0);
				assert.deepEqual(f.frontiers(), [48, nodeBytes]);
				assert.equal(f.memory.readRamRecordByte(base + 4 * array + 2), ValueTag.Integer);
				assert.equal(next(6), 0);
				assert.deepEqual(f.frontiers(), [144, nodeBytes]);
				assert.equal(f.memory.readRamRecordWord(storage + nodeBytes), 6, 'the two live disappearing Array slots joined the hash');
				assert.equal(f.memory.readRamRecordWord(storage + nodeBytes + 4 * (1 + 8)), 2, 'both shrinking-tail Integer keys increment their band');
			}
			assert.equal(f.memory.readRamRecordWord(record + TableHeader.Array), oldArray);
			assert.equal(f.memory.readRamRecordWord(record + TableHeader.HashStorage), source);
		}
	});
}


for (const opt of [0, 3] as const) {
	test(`staged publication matches native detached Array, retained Hash, in-place shrink and zero Array at O${opt}`, () => {
		const f = fixture(opt), control = f.cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
		for (const [kind, oldArray, array, keepHash] of [
			['move', 1024, 2048, false],
			['keep-hash', 1024, 2048, true],
			['shrink', 1024, 512, false],
			['zero-array', 1024, 0, false],
		] as const) {
			const oldHash = 128, hash = keepHash ? 0 : 256;
			const record = f.same(cpu => cpu.createTable(oldArray, oldHash));
			const oldBase = f.same(cpu => cpu.gc.tables.arrayAddress(record));
			const oldStorage = f.same(cpu => cpu.gc.tables.hashAddress(record));
			const base = array > oldArray ? f.same(cpu => cpu.heapAllocator.allocate(5 * array, true)) : oldBase;
			const storage = keepHash ? 0 : f.same(cpu => cpu.heapAllocator.allocate(TableRecords.hashStorageBytes(hash), true));
			const key = valueInteger(array === 0 ? 1025 : 3), value = valueInteger(787);
			const j = Object.assign(new TableRebuildReference(), { record, source: keepHash ? 0 : oldStorage, count: keepHash ? 0 : oldHash,
				storage, capacity: hash, arrayStorage: base, arraySlots: array, free: hash - 1 >>> 0, key, value });
			f.same(cpu => {
				cpu.gc.tables.set(record, valueInteger(1), valueInteger(11));
				cpu.gc.tables.set(record, valueInteger(2), valueInteger(12));
				cpu.gc.tables.set(record, valueInteger(oldArray), valueInteger(17));
				cpu.gc.tables.set(record, valueInteger(-5), valueInteger(15));
			});
			f.seed(j);
			const prepare = (hash * 14 + 15 >>> 4) + (array > oldArray ? (5 * array + 15 >>> 4) : 0);
			// The zero-capacity Hash starts at zero, so only Array prep is paid.
			// All shapes except keep-hash have a placement pass after prep.
			if (keepHash) {
				// The existing placement proof compares the post-prepare bytes
				// against the old monolith only when a later phase will suspend.
				// Use one partial transfer, then let the actual epilogue probe
				// finish prepare in both implementations.
				f.finish(f.begin(j, prepare - 1));
			} else {
				f.finish(f.begin(j, prepare));
			}
			f.same(cpu => {
				// Relocation must invalidate a currently traced Table before
				// changing that Table's header or killing its original extent.
				cpu.memory.writeRamRecordByte(record + 1, 3);
				cpu.memory.writeRamRecordPair(control + GC_TRACE_RECORD, record, 45);
				cpu.memory.writeRamRecordWord(control + GC_MODE_META, record);
			});
			const chargedBefore = f.cpu.luaHeap.usedBytes();
			const expected = f.beginPublication(j, 8192);
			assert.equal(f.memory.readRamRecordWord(record + TableHeader.ArrayStorage), oldBase);
			for (let i = 0; i < 4096 && f.memory.readRamRecordWord(record + TableHeader.Array) === oldArray; ++i) f.grant(1);
			assert.ok(f.cpu.heapServiceActive());
			assert.equal(f.memory.readRamRecordWord(control + GC_TRACE_RECORD), 0);
			assert.equal(f.memory.readRamRecordWord(control + GC_MODE_META), 0);
			assert.equal(f.memory.readRamRecordWord(control + GC_CHANGED_HEAD), (record & GC_RECORD_MASK) >>> GC_RECORD_SHIFT);
			assert.equal(f.memory.readRamRecordWord(record + TableHeader.Array), array);
			assert.equal(f.memory.readRamRecordWord(record + TableHeader.ArrayStorage), array ? base : 0);
			assert.equal(f.memory.readRamRecordWord(record + TableHeader.HashStorage), oldStorage, 'Array publishes before Hash');
			assert.equal(f.cpu.luaHeap.usedBytes(), chargedBefore);
			const checkpoint = captureCpuCheckpoint(f.cpu), paid = f.finish(expected);
			assert.equal(f.cpu.gc.tables.get(record, key), value);
			assert.equal(f.cpu.gc.tables.get(record, valueInteger(-5)), valueInteger(15));
			assert.equal(f.cpu.gc.tables.get(record, valueInteger(oldArray)), valueInteger(17));
			assert.equal(f.memory.readRamRecordWord(record + TableHeader.HashStorage), keepHash ? oldStorage : storage);
			assert.equal(f.cpu.luaHeap.usedBytes(), chargedBefore + TableRecords.allocationCharge(array, keepHash ? oldHash : hash) - TableRecords.allocationCharge(oldArray, oldHash));
			if (array !== 0) assert.equal(f.memory.readRamRecordWord(record + TableHeader.Length), 3);
			restoreCpuCheckpoint(f.cpu, checkpoint);
			assert.equal(f.finish(expected), paid);
		}
	});

	test(`staged Hash publication invalidates its own method cache before marking inserted String edges at O${opt}`, () => {
		const f = fixture(opt), control = f.cpu.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
		const oldHash = 128, hash = 256, record = f.same(cpu => cpu.createTable(0, oldHash));
		const source = f.same(cpu => cpu.gc.tables.hashAddress(record));
		const storage = f.same(cpu => cpu.heapAllocator.allocate(TableRecords.hashStorageBytes(hash), true));
		const key = valueString(f.cpu.gc.diagnosticWord(HeapServiceRemarkHeadField.NewIndex)), value = valueString(f.same(cpu => cpu.stringPool.intern('staged black owner value')));
		f.same(cpu => {
			cpu.gc.tables.set(record, valueInteger(-10), valueInteger(40));
			cpu.stringPool.beginReachabilityEpoch();
			cpu.stringPool.resumeMarkWork(3);
			cpu.memory.writeRamRecordByte(control, GcPhase.MarkAgain);
			cpu.memory.writeRamRecordByte(record + 1, 3);
		});
		assert.equal(f.memory.readRamRecordByte(record + TableHeader.NewIndexAbsent), 1);
		const j = Object.assign(new TableRebuildReference(), { record, source, count: oldHash, storage, capacity: hash, free: hash - 1, key, value });
		f.seed(j);
		f.finish(f.begin(j, hash * 14 + 15 >>> 4));
		const expected = f.beginPublication(j, 4096);
		const oldValueMark = f.memory.readRamRecordByte(valuePayload(value) + 1);
		for (let i = 0; i < 4096 && f.memory.readRamRecordByte(record + TableHeader.NewIndexAbsent) !== 0; ++i) f.grant(1);
		assert.ok(f.cpu.heapServiceActive());
		assert.equal(f.memory.readRamRecordByte(record + TableHeader.NewIndexAbsent), 0);
		assert.equal(f.memory.readRamRecordWord(record + TableHeader.HashStorage), storage);
		assert.equal(f.cpu.gc.tables.get(record, key), value);
		assert.equal(f.memory.readRamRecordByte(valuePayload(value) + 1), oldValueMark);
		const checkpoint = captureCpuCheckpoint(f.cpu), paid = f.finish(expected);
		assert.notEqual(f.memory.readRamRecordByte(valuePayload(value) + 1), oldValueMark);
		restoreCpuCheckpoint(f.cpu, checkpoint);
		assert.equal(f.finish(expected), paid);
	});
}

const pins = [
	['T', 'machine/ts/machine/cpu/table.ts', '5de6ece7a84cd8e4218173055c0d658cc6db0c354cc716b5fc34d6cdf794000e'],
	['C', 'machine/cpp/machine/cpu/table_rebuild.cpp', 'f3217b0930169913133560533ced527a5d0fe91b43b509da107413f11863de7f'],
	['H', 'machine/cpp/machine/cpu/table.h', '833fac7494641af2da5008ffdbd007e265456e202ff400beaaf399b0de75e9a4'],
	['J', 'machine/cpp/machine/cpu/table_rebuild.h', '3949c956a6d04499b9a4093613a170af13bef7dc8a558b4b0491140ba13c367b'],
	['B', 'machine/cpp/machine/cpu/table.cpp', '61f4630adf5f3e0a610ea0e0f41f6b3d10e252a57987ea0b63b6186e53fd3dba'],
	['U', 'machine/ts/machine/cpu/lua_heap.ts', '9fcad1e20049b69a9f89bc69bad1495fdda8034214903dd1f8d140cc845041de'],
	['L', 'machine/cpp/machine/cpu/lua_heap.cpp', '0fb5c13cffa84c99fecf4530dd85dc60452274382db02f30cb394b0768d6c0b5'],
	['A', 'machine/cpp/machine/cpu/heap_allocator.cpp', 'aea53d9b2fecb8ae6d17abda4987b08e2af8a4fdf9a8424c49e10fc84f9eb7a5'],
	['D', 'machine/ts/machine/cpu/heap_allocator.ts', '79309f418c20016b037b26fae01b28c891c72a2ed155ba1f375d7bc11f6d42f1'],
	['V', 'machine/ts/machine/cpu/value.ts', 'bdafe30a070405b98b673dfe76e0daad1384ccd87ee7ca26584eba734204c641'],
	['W', 'machine/cpp/machine/cpu/value.h', 'cb211876c00637f49334db80b281d4af8a17f978bdceb736b6c9a177b9abe94e'],
	['M', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0'],
] as const;
test('staged rebuild preparation, placement and publication pin source operations and exact job lane offsets', () => {
	const source = modules.find(module => module.path === MODULE)!.source;
	assert.ok(source.includes(`-- Source basis: ${basis}.`));
	const references = new Map(pins.map(([key, file, digest]) => {
		const text = execFileSync('git', ['show', `${basis}:${file}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(text).digest('hex'), digest, file);
		return [key as string, { lines: text.split('\n'), covered: new Set<number>() }];
	}));
	for (const [i, line] of source.slice(0, source.lastIndexOf('\nreturn {')).split('\n').entries()) {
		if (/^\s*(?:$|--|module<const>$|struct \w+$|do$|end$)/.test(line)) continue;
		const origin = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(origin, `${port}:${i + 1}: missing native origin`);
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
	for (const [key, first, last, excluded] of [['T', 924, 1091, [929, 1002, 1030, 1057, 1058, 1060, 1071, 1079, 1084]], ['C', 6, 163, [84, 93]]] as const) {
		const reference = references.get(key)!;
		for (let index = first; index <= last; ++index) {
			if (/^\s*(?:$|\/\/|[{}]$)/.test(reference.lines[index - 1]) || (excluded as readonly number[]).includes(index)) continue;
			assert.ok(reference.covered.has(index), `${key}:${index}: ${reference.lines[index - 1]}`);
		}
	}
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture([port]));
	const { chunk } = workspace.updateFile(port, source);
	const span = chunk.body.get(chunk.body.length - 1).span;
	const types = new StructTypes(workspace.getSnapshot(), { value: () => undefined, storage: () => undefined });
	const layout = types.resolve(port, { name: 'rebuild_prepare_job', arrayLengths: [], span }).struct!;
	assert.equal(layout.size, 64);
	for (const [index, name] of fields.entries()) assert.equal(layout.fields.get(name)!.offset, index * 4);
	const header = types.resolve(port, { name: 'rebuild_array_header', arrayLengths: [], span }).struct!;
	assert.equal(header.size, TableRecords.HEADER_BYTES);
	for (const [field, offset] of [
		['hash_storage', TableHeader.HashStorage], ['array_slots', TableHeader.Array], ['hash_slots', TableHeader.Hash],
		['free', TableHeader.Free], ['array_storage', TableHeader.ArrayStorage],
	] as const) assert.equal(header.fields.get(field)!.offset, offset);
});
