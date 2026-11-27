import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { TableHeader, TableRebuild, TableRecords } from '../../machine/ts/machine/cpu/table';
import { ValueTag, hashCanonicalTableKey, valueInteger, valuePayload, valueTag } from '../../machine/ts/machine/cpu/value';
import { HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_VALUE_COUNT } from '../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { StructTypes } from '../../toolchain/ts/lua/static/struct_types';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';
import { compileTestSystemWithHeap } from '../helpers/heap_service_system';

const MODULE = 'kernel/table_prepare_rebuild', port = `machine/bios/${MODULE}.lua`, entrySource = 'halt_until_irq';
const basis = 'edfe988ff624b541b9162691b5d8bdae295b70bc';
const modules = ['kernel/dlmalloc', 'kernel/dlmalloc_record', 'kernel/gc_control', 'kernel/table_create', 'kernel/table_reinsert', MODULE].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8').replaceAll('\r\n', '\n');
	return { path, source, chunk: parseLuaChunk(source, path) };
});
const fields = ['source', 'count', 'storage', 'capacity', 'array_storage', 'array_slots', 'array_cleared', 'cleared',
	'key_tag', 'key_word', 'value_tag', 'value_word', 'homes', 'cursor', 'free', 'collisions'] as const;
const dirty = 0x9d;

function fixture(optLevel: 0 | 3) {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	const roots = ['prepare_table_rebuild', 'place_table_rebuild'].map(operation => {
		const symbol = object.sections.rodata.moduleExports.find(entry => entry.path === MODULE && entry.exportPathKey === operation);
		assert.ok(symbol);
		const root = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[symbol.slotName]);
		assert.ok(root >= 0);
		return root;
	});
	const { frames, valueSlots } = deriveBlua32FixedStack(linked.image, roots);
	assert.ok(frames <= HEAP_SERVICE_FRAME_COUNT && valueSlots <= HEAP_SERVICE_VALUE_COUNT, `pinned stack: ${frames} frames, ${valueSlots} values`);
	const { cpu, memory } = createTestSystemCpu(linked), oracle = createTestSystemCpu(linked).cpu;
	for (const target of [cpu, oracle]) runGuestToHalt(target, 10_000);
	const first = memory.ramBusEnd() - RAM_BASE, last = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_THREAD_OFFSET;
	function same<T>(action: (target: CPU) => T): T {
		const result = action(cpu);
		assert.deepEqual(action(oracle), result);
		return result;
	}
	const jobOffset = same(target => target.heapAllocator.allocate(64, true) - RAM_BASE);
	assert.ok(jobOffset > 0);
	function seed(job: TableRebuild): void {
		const words = [job.source, job.count, job.storage, job.capacity, job.arrayStorage, job.arraySlots, job.arrayCleared, job.cleared,
			valueTag(job.key), valuePayload(job.key), valueTag(job.value), valuePayload(job.value),
			job.homes, job.cursor, job.free, job.collisions];
		same(target => words.forEach((word, index) => target.memory.writeRamRecordWord(jobOffset + index * 4, word)));
	}
	function begin(job: TableRebuild, allowance: number, placement = false) {
		const expected = oracle.gc.tables.advanceRebuild(job, allowance);
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
	function finish(expected: number) {
		let spent = 0;
		for (let i = 0; i < 512 && cpu.heapServiceActive(); ++i) spent += grant(256);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.heapServiceResult() | 0, expected);
		const actual = memory.ramData().subarray(first, last), native = oracle.memory.ramData().subarray(first, last);
		if (Buffer.compare(actual, native) !== 0) {
			const mismatch = actual.findIndex((value, i) => value !== native[i]);
			assert.equal(actual[mismatch], native[mismatch], `private RAM differs at 0x${(first + mismatch).toString(16)}`);
		}
		return spent;
	}
	const frontiers = () => [memory.readRamRecordWord(jobOffset + 24), memory.readRamRecordWord(jobOffset + 28)];
	const placement = () => [48, 52, 56, 60].map(offset => memory.readRamRecordWord(jobOffset + offset));
	return { cpu, memory, same, seed, begin, grant, finish, frontiers, placement };
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
			const j = Object.assign(new TableRebuild(), { record, source, count: oldHash, storage, capacity: hash,
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
			const j = Object.assign(new TableRebuild(), { record, source, count: oldHash, storage, capacity: hash,
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

const pins = [
	['T', 'machine/ts/machine/cpu/table.ts', '5de6ece7a84cd8e4218173055c0d658cc6db0c354cc716b5fc34d6cdf794000e'],
	['C', 'machine/cpp/machine/cpu/table_rebuild.cpp', 'f3217b0930169913133560533ced527a5d0fe91b43b509da107413f11863de7f'],
	['H', 'machine/cpp/machine/cpu/table.h', '833fac7494641af2da5008ffdbd007e265456e202ff400beaaf399b0de75e9a4'],
	['J', 'machine/cpp/machine/cpu/table_rebuild.h', '3949c956a6d04499b9a4093613a170af13bef7dc8a558b4b0491140ba13c367b'],
	['V', 'machine/ts/machine/cpu/value.ts', 'bdafe30a070405b98b673dfe76e0daad1384ccd87ee7ca26584eba734204c641'],
	['W', 'machine/cpp/machine/cpu/value.h', 'cb211876c00637f49334db80b281d4af8a17f978bdceb736b6c9a177b9abe94e'],
	['M', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0'],
] as const;
test('staged rebuild preparation and placement pin source operations and exact job lane offsets', () => {
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
	for (const [key, first, last, excluded] of [['T', 924, 1071, [929, 1002, 1030, 1057, 1058, 1060, 1071]], ['C', 6, 144, [84, 93]]] as const) {
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
});
