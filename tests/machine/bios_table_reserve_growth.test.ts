import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type CPU } from '../../machine/ts/machine/cpu/cpu';
import { TableHeader, TableRecords } from '../../machine/ts/machine/cpu/table';
import { MAIN_RAM_SIZE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_WORKSPACE_END } from '../helpers/firmware_heap_layout';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { StructTypes } from '../../toolchain/ts/lua/static/struct_types';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { firmwareProbeResult, grantFirmwareProbe, issueFirmwareProbe, linkFirmwareProbe } from '../helpers/ordinary_firmware_probe';

const MODULE = 'kernel/table_reserve_growth', port = `machine/bios/${MODULE}.lua`;
const basis = '9d878caf4ee677bdff65b798b51f97b253e9740b';
const source = readFileSync(port, 'utf8').replaceAll('\r\n', '\n');
const modules = ['kernel/dlmalloc', MODULE].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});
const sentinels = [0xe7100061, 0xb60000a8] as const;
const hashBytes = TableRecords.hashStorageBytes;

function fixture(optLevel: 0 | 3) {
	const linked = linkFirmwareProbe(optLevel, modules, [{ path: MODULE, member: 'reserve_table_growth', arity: 8 }]);
	const { cpu, memory } = createTestHeapServiceCpu(linked), oracle = createTestHeapServiceCpu(linked).cpu;
	for (const target of [cpu, oracle]) runGuestToHalt(target, 10_000);
	const floor = memory.ramBusEnd() - RAM_BASE;
	const last = nativeHeapReference(cpu).heapAllocator.managementOffset() + GC_WORKSPACE_END;
	function same<T>(action: (target: CPU) => T): T {
		const actual = action(cpu);
		assert.deepEqual(action(oracle), actual);
		return actual;
	}
	const output = same(target => nativeHeapReference(target).heapAllocator.allocate(8, true));
	assert.ok(output);
	function header(record: number) {
		return memory.ramData().slice(record - RAM_BASE, record - RAM_BASE + TableRecords.HEADER_BYTES);
	}
	function compare() {
		const actual = memory.ramData().subarray(floor, last), expected = oracle.memory.ramData().subarray(floor, last);
		if (Buffer.compare(actual, expected) === 0) return;
		const index = actual.findIndex((value, index) => value !== expected[index]);
		assert.equal(actual[index], expected[index], `private RAM differs at 0x${(floor + index).toString(16)}`);
	}
	function begin(record: number, array: number, hash: number, keepHash: boolean, staged: boolean) {
		same(target => target.memory.writeRamRecordPair(output, ...sentinels));
		issueFirmwareProbe(cpu, [
			nativeHeapReference(cpu).heapAllocator.allocatorStateOffset(), record, array, hash, hashBytes(hash), +keepHash, +staged, output - RAM_BASE,
		]);
	}
	function grant(cycles: number) {
		const spent = grantFirmwareProbe(cpu, cycles);
		assert.ok(spent > 0);
		return spent;
	}
	function finish() {
		let spent = 0;
		for (let i = 0; i < 128 && !cpu.isHaltedUntilIrq(); ++i) spent += grant(256);
		return spent;
	}
	const result = () => [memory.readRamRecordWord(output), memory.readRamRecordWord(output + 4)];
	function verify(record: number, before: Uint8Array, occupied: number, expected?: readonly [number, number]) {
		assert.equal(firmwareProbeResult(cpu), +(expected !== undefined));
		assert.deepEqual(result(), expected === undefined ? sentinels : expected);
		if (expected !== undefined) oracle.memory.writeRamRecordPair(output, ...expected);
		assert.deepEqual(header(record), before, 'the semantic Table descriptor is still unpublished');
		assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), occupied, 'reservation does not charge logical occupancy');
		compare();
	}
	return { cpu, oracle, same, header, compare, begin, grant, finish, verify, result };
}

for (const optLevel of [0, 3] as const) {
	test(`table growth issues hash before array, then resumes and publishes only scratch at O${optLevel}`, () => {
		const f = fixture(optLevel), array = 9, hash = 8;
		const record = f.same(target => createReferenceTable(target, 0, 0));
		const before = f.header(record), occupied = nativeHeapReference(f.cpu).luaHeap.usedBytes(), physical = nativeHeapReference(f.cpu).heapAllocator.occupiedBytes();
		const arena = nativeHeapReference(f.oracle).heapAllocator;
		const storage = arena.allocate(hashBytes(hash), true);
		const hashOnly = arena.occupiedBytes();
		const base = arena.allocate(5 * array, true);
		assert.ok(storage && base && hashOnly > physical);
		f.begin(record, array, hash, false, false);
		for (let i = 0; i < 4096 && nativeHeapReference(f.cpu).heapAllocator.occupiedBytes() === physical; ++i) f.grant(1);
		assert.ok(!f.cpu.isHaltedUntilIrq());
		assert.equal(nativeHeapReference(f.cpu).heapAllocator.occupiedBytes(), hashOnly, 'first allocation is the hash');
		assert.deepEqual(f.result(), sentinels);
		assert.deepEqual(f.header(record), before);
		const checkpoint = captureCpuCheckpoint(f.cpu);
		const spent = f.finish();
		f.verify(record, before, occupied, [storage, base]);
		restoreCpuCheckpoint(f.cpu, checkpoint);
		assert.equal(f.finish(), spent);
		f.verify(record, before, occupied, [storage, base]);
	});

	test(`table growth matches staged native reservation and destructive native resize at O${optLevel}`, () => {
		const f = fixture(optLevel);
		for (const staged of [true, false]) {
			const oldArray = staged ? 1024 : 8, array = staged ? 2048 : 256, hash = staged ? 16 : 8;
			const record = f.same(target => createReferenceTable(target, oldArray, hash));
			const before = f.header(record), occupied = nativeHeapReference(f.cpu).luaHeap.usedBytes();
			const oldBase = f.same(target => target.tables.arrayAddress(record));
			const oldHash = f.same(target => target.tables.hashAddress(record));
			f.same(target => target.memory.writeRamRecordWord(oldBase, 0x378422bc));
			let base: number;
			if (staged) {
				base = nativeHeapReference(f.oracle).heapAllocator.reserveBacking(oldBase, 5 * array);
				assert.notEqual(base, oldBase, 'blocked old array reserves a separate raw backing');
			} else {
				base = nativeHeapReference(f.oracle).heapAllocator.resizeBacking(oldBase, 5 * array);
				assert.notEqual(base, oldBase, 'blocked old array must relocate and copy its payload');
			}
			assert.ok(base);
			f.begin(record, array, hash, true, staged);
			f.finish();
			f.verify(record, before, occupied, [oldHash, base]);
			if (!staged) assert.equal(f.cpu.memory.readRamRecordWord(base), 0x378422bc);
		}
		const record = f.same(target => createReferenceTable(target, 0, 0)), before = f.header(record), occupied = nativeHeapReference(f.cpu).luaHeap.usedBytes();
		f.begin(record, 0, 0, false, false);
		f.finish();
		f.verify(record, before, occupied, [0, 0]);

		const raw = f.same(target => createReferenceTable(target, 1, 0));
		const base = f.same(target => target.tables.arrayAddress(raw));
		// The record port still decodes aliases and compares raw unsigned slots.
		f.same(target => target.memory.writeRamRecordWord(raw + TableHeader.Array, 0x80000001));
		const rawHeader = f.header(raw), rawOccupied = nativeHeapReference(f.cpu).luaHeap.usedBytes();
		assert.ok(f.oracle.tables.arrayCapacity(raw) > 4);
		f.begin(raw + MAIN_RAM_SIZE, 4, 0, false, false);
		f.finish();
		f.verify(raw, rawHeader, rawOccupied, [0, base]);
	});
}

test('table growth restores only its owned hash block on an array refusal', () => {
	const f = fixture(3), hash = 8;
	const record = f.same(target => createReferenceTable(target, 0, hash));
	const before = f.header(record), occupied = nativeHeapReference(f.cpu).luaHeap.usedBytes();
	const fit = f.same(target => nativeHeapReference(target).heapAllocator.allocate(hashBytes(hash), true));
	assert.ok(fit && f.same(target => nativeHeapReference(target).heapAllocator.allocate(32, true)));
	f.same(target => {
		while (nativeHeapReference(target).heapAllocator.allocate(4088, true)) { /* exhaust page supply */ }
		while (nativeHeapReference(target).heapAllocator.allocate(hashBytes(hash), true)) { /* exhaust hash fits */ }
		nativeHeapReference(target).heapAllocator.free(fit);
	});
	const arena = nativeHeapReference(f.oracle).heapAllocator, array = 1024;
	assert.equal(arena.allocate(5 * array, true), 0);
	f.begin(record, array, hash, true, false);
	f.finish();
	f.verify(record, before, occupied);

	const fresh = arena.allocate(hashBytes(hash), true);
	assert.equal(fresh, fit);
	assert.equal(arena.allocate(5 * array, true), 0);
	arena.free(fresh);
	f.begin(record, array, hash, false, false);
	f.finish();
	f.verify(record, before, occupied);

	assert.equal(arena.allocate(hashBytes(1024), true), 0);
	f.begin(record, 1, 1024, false, false);
	f.finish();
	f.verify(record, before, occupied);
});

const pins = [
	['T', 'machine/ts/machine/cpu/table.ts', '39610ec36786e68a5712461b3eebd017816fba9758f1a1644b024871213e05e7', [[34, 34], [52, 52], [98, 98], [120, 120], [132, 132], [136, 137], [801, 817]]],
	['C', 'machine/cpp/machine/cpu/table.cpp', '2b8976327da44c9c7fd5f6d5df7b01b6d2593387024fdb9e3cae19ac04403d3e', [[249, 250], [255, 268]]],
	['H', 'machine/cpp/machine/cpu/table.h', 'f0f5b4a879cb6cbd33612aa64d53339a6cbb85bac8d2edb03e3d74f445b88932', [[27, 27], [43, 43], [48, 48], [55, 57]]],
	['A', 'machine/ts/machine/cpu/heap_allocator.ts', '79309f418c20016b037b26fae01b28c891c72a2ed155ba1f375d7bc11f6d42f1', [[56, 58], [61, 68]]],
	['B', 'machine/cpp/machine/cpu/heap_allocator.cpp', 'aea53d9b2fecb8ae6d17abda4987b08e2af8a4fdf9a8424c49e10fc84f9eb7a5', [[54, 56], [59, 66]]],
	['M', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0', [[6, 7], [9, 9]]],
] as const;

test('the Table growth body maps the mirrored physical phase and its word lanes', () => {
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture([port]));
	const file = workspace.updateFile(port, source);
	const span = file.chunk.body.get(file.chunk.body.length - 1).span;
	const types = new StructTypes(workspace.getSnapshot(), { value: () => undefined, storage: () => undefined });
	for (const [name, size, fields] of [
		['growth_table_header', TableRecords.HEADER_BYTES,
			[['hash_storage', TableHeader.HashStorage], ['array_slots', TableHeader.Array], ['array_storage', TableHeader.ArrayStorage]]],
		['table_growth_result', 8, [['hash_storage', 0], ['array_storage', 4]]],
	] as const) {
		const type = types.resolve(port, { name, arrayLengths: [], span });
		assert.equal(type.size, size, name);
		for (const [fieldName, offset] of fields) {
			const field = type.struct!.fields.get(fieldName);
			assert.ok(field, fieldName);
			assert.equal(field.offset, offset, fieldName);
			assert.equal(field.size, 4, fieldName);
		}
	}
	const sources = new Map<string, { lines: string[]; covered: Set<number> }>();
	for (const [key, file, digest] of pins) {
		const pinned = execFileSync('git', ['show', `${basis}:${file}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(pinned).digest('hex'), digest, `${file}: review changed reference bytes`);
		sources.set(key, { lines: pinned.split('\n'), covered: new Set() });
	}
	const lines = source.split('\n');
	assert.ok(lines.includes(`-- Source basis: ${basis}.`));
	const exports = lines.indexOf('return { reserve_table_growth = reserve_table_growth }');
	assert.ok(exports > 0);
	for (const [index, line] of lines.slice(0, exports).entries()) {
		if (/^\s*(?:$|--|module<const>$|struct \w+$|end$)/.test(line)) continue;
		const origin = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(origin, `${port}:${index + 1}: missing native origin for ${line.trim()}`);
		for (const entry of origin[1].trim().split(/\s+/)) {
			const [key, intervals] = entry.split(':');
			const native = sources.get(key);
			assert.ok(native, `${port}:${index + 1}: unknown ${key}`);
			for (const interval of intervals.split(',')) {
				const [first, last = first] = interval.split('-').map(Number);
				assert.ok(first >= 1 && last >= first && last <= native.lines.length, `${port}:${index + 1}: invalid ${entry}`);
				for (let n = first; n <= last; ++n) native.covered.add(n);
			}
		}
	}
	for (const [key, , , slices] of pins) {
		const native = sources.get(key)!;
		for (const [first, last] of slices) for (let n = first; n <= last; ++n) {
			const statement = native.lines[n - 1];
			if (/^\s*(?:$|\/\/|[{}]$)/.test(statement)) continue;
			assert.ok(native.covered.has(n), `${key}:${n}: no firmware mapping for ${statement.trim()}`);
		}
	}
	for (const [key, line] of [['T', 830], ['T', 831], ['T', 868], ['C', 253], ['C', 383], ['C', 387], ['C', 423]] as const) {
		assert.equal(sources.get(key)!.covered.has(line), false, 'admission, rehash, and Table publication stay with the caller');
	}
});
