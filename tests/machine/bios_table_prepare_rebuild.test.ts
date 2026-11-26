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
	'key_tag', 'key_word', 'value_tag', 'value_word'] as const;
const dirty = 0x9d;

function fixture(optLevel: 0 | 3) {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	const symbol = object.sections.rodata.moduleExports.find(entry => entry.path === MODULE && entry.exportPathKey === 'prepare_table_rebuild');
	assert.ok(symbol);
	const root = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[symbol.slotName]);
	assert.ok(root >= 0);
	const { frames, valueSlots } = deriveBlua32FixedStack(linked.image, [root]);
	assert.ok(frames <= HEAP_SERVICE_FRAME_COUNT && valueSlots <= HEAP_SERVICE_VALUE_COUNT, `pinned stack: ${frames} frames, ${valueSlots} values`);
	const { cpu, memory } = createTestSystemCpu(linked), oracle = createTestSystemCpu(linked).cpu;
	for (const target of [cpu, oracle]) runGuestToHalt(target, 10_000);
	const first = memory.ramBusEnd() - RAM_BASE, last = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_THREAD_OFFSET;
	function same<T>(action: (target: CPU) => T): T {
		const result = action(cpu);
		assert.deepEqual(action(oracle), result);
		return result;
	}
	const jobOffset = same(target => target.heapAllocator.allocate(48, true) - RAM_BASE);
	assert.ok(jobOffset > 0);
	function seed(job: TableRebuild): void {
		const words = [job.source, job.count, job.storage, job.capacity, job.arrayStorage, job.arraySlots, job.arrayCleared, job.cleared,
			valueTag(job.key), valuePayload(job.key), valueTag(job.value), valuePayload(job.value)];
		same(target => words.forEach((word, index) => target.memory.writeRamRecordWord(jobOffset + index * 4, word)));
	}
	function begin(job: TableRebuild, allowance: number) {
		const expected = oracle.gc.tables.advanceRebuild(job, allowance);
		assert.notEqual(job.record, 0, 'the policy grant stops before native publication');
		assert.equal(job.homes, 0, 'the native oracle never enters a placement pass on these grants');
		oracle.memory.writeRamRecordPair(jobOffset + 24, job.arrayCleared, job.cleared);
		assert.ok(cpu.beginHeapService(linked.image.functions[root].address, [job.record, jobOffset, allowance]));
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
	return { cpu, memory, same, seed, begin, grant, finish, frontiers };
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

const pins = [
	['T', 'machine/ts/machine/cpu/table.ts', '5de6ece7a84cd8e4218173055c0d658cc6db0c354cc716b5fc34d6cdf794000e'],
	['C', 'machine/cpp/machine/cpu/table_rebuild.cpp', 'f3217b0930169913133560533ced527a5d0fe91b43b509da107413f11863de7f'],
	['H', 'machine/cpp/machine/cpu/table.h', '833fac7494641af2da5008ffdbd007e265456e202ff400beaaf399b0de75e9a4'],
	['J', 'machine/cpp/machine/cpu/table_rebuild.h', '3949c956a6d04499b9a4093613a170af13bef7dc8a558b4b0491140ba13c367b'],
	['V', 'machine/ts/machine/cpu/value.ts', 'bdafe30a070405b98b673dfe76e0daad1384ccd87ee7ca26584eba734204c641'],
	['W', 'machine/cpp/machine/cpu/value.h', 'cb211876c00637f49334db80b281d4af8a17f978bdceb736b6c9a177b9abe94e'],
	['M', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0'],
] as const;
test('the rebuild preparation pins source operations and exact job lane offsets', () => {
	const source = modules.find(module => module.path === MODULE)!.source;
	assert.ok(source.includes(`-- Source basis: ${basis}.`));
	const references = new Map(pins.map(([key, file, digest]) => {
		const text = execFileSync('git', ['show', `${basis}:${file}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(text).digest('hex'), digest, file);
		return [key as string, { lines: text.split('\n'), covered: new Set<number>() }];
	}));
	for (const [i, line] of source.slice(0, source.lastIndexOf('\nreturn {')).split('\n').entries()) {
		if (/^\s*(?:$|--|module<const>$|struct \w+$|end$)/.test(line)) continue;
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
	for (const [key, first, last, excluded] of [['T', 930, 1001, []], ['C', 6, 77, [12, 17]]] as const) {
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
	assert.equal(layout.size, 48);
	for (const [index, name] of fields.entries()) assert.equal(layout.fields.get(name)!.offset, index * 4);
});
