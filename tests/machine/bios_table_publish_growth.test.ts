import { GC_CHANGED_HEAD, GC_MODE_META, GC_ROOT_CURSOR, GC_TRACE_CURSOR, GC_TRACE_RECORD } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type CPU } from '../../machine/ts/machine/cpu/cpu';
import { GC_COLOR_OFFSET } from '../../machine/ts/machine/cpu/gc_object';
import { TableHeader, TableRecords } from '../../machine/ts/machine/cpu/table';
import { MAIN_RAM_SIZE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_WORKSPACE_END, HEAP_GC_CONTROL_OFFSET } from '../helpers/firmware_heap_layout';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { StructTypes } from '../../toolchain/ts/lua/static/struct_types';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { grantFirmwareProbe, issueFirmwareProbe, linkFirmwareProbe } from '../helpers/ordinary_firmware_probe';

const MODULE = 'kernel/table_publish_growth', port = `machine/bios/${MODULE}.lua`;
const basis = 'f2aac88e703a8d8fe40beb96163224142d11e98a';
const source = readFileSync(port, 'utf8').replaceAll('\r\n', '\n');
const modules = ['kernel/dlmalloc', 'kernel/dlmalloc_record', 'kernel/gc_control', 'kernel/gc_strings',
	'kernel/gc_mark', 'kernel/gc_barrier', 'kernel/table_create', MODULE].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});
const dirty = 0x9d;

function fixture(optLevel: 0 | 3) {
	const linked = linkFirmwareProbe(optLevel, modules, [{ path: MODULE, member: 'publish_table_growth', arity: 8, result: false }]);
	const { cpu, memory } = createTestHeapServiceCpu(linked), oracle = createTestHeapServiceCpu(linked).cpu;
	for (const target of [cpu, oracle]) runGuestToHalt(target, 10_000);
	const first = memory.ramBusEnd() - RAM_BASE, management = cpu.heapAllocator.managementOffset();
	const last = management + GC_WORKSPACE_END, control = management + HEAP_GC_CONTROL_OFFSET;
	function same<T>(action: (target: CPU) => T): T {
		const result = action(cpu);
		assert.deepEqual(action(oracle), result);
		return result;
	}
	const reservation = same(target => nativeHeapReference(target).heapAllocator.allocate(8, true));
	assert.ok(reservation);
	function compare() {
		const actual = memory.ramData().subarray(first, last), expected = oracle.memory.ramData().subarray(first, last);
		if (Buffer.compare(actual, expected) === 0) return;
		const mismatch = actual.findIndex((value, index) => value !== expected[index]);
		assert.equal(actual[mismatch], expected[mismatch], `private RAM differs at 0x${(first + mismatch).toString(16)}`);
	}
	function begin(record: number, array: number, hash: number, keepHash: boolean, storage: number, base: number, cppMirror = false) {
		same(target => target.memory.writeRamRecordPair(reservation, storage, base));
		// The frozen native immediate resize prefix, excluding rehash and array work.
		const tables = nativeHeapReference(oracle).gc.tables;
		nativeHeapReference(oracle).gc.tableEntriesMoved(record);
		// The C++ fixture also requeues this black record, but replaces its
		// whole color byte instead of preserving the high six bits (GcHeap::color).
		if (cppMirror) oracle.memory.writeRamRecordByte(record + GC_COLOR_OFFSET, 2);
		oracle.memory.writeRamRecordWord(record + TableHeader.Array, array);
		if (!keepHash) tables['bindHash'](record, hash, storage);
		oracle.memory.writeRamRecordWord(record + TableHeader.ArrayStorage, base);
		if (!keepHash) tables['initializeHash'](storage, hash);
		issueFirmwareProbe(cpu, [
			control, record, array, hash, TableRecords.hashStorageBytes(hash), +keepHash, reservation - RAM_BASE, +cppMirror,
		]);
	}
	function grant(cycles: number) {
		const spent = grantFirmwareProbe(cpu, cycles);
		assert.ok(spent > 0);
		return spent;
	}
	function finish() {
		let spent = 0;
		for (let i = 0; i < 128 && !cpu.isHaltedUntilIrq(); ++i) spent += grant(1024);
		compare();
		return spent;
	}
	function backing(bytes: number) {
		return same(target => {
			const address = nativeHeapReference(target).heapAllocator.allocate(bytes, true);
			assert.ok(address);
			for (let offset = 0; offset < bytes; ++offset) target.memory.writeRamRecordByte(address + offset, dirty);
			return address;
		});
	}
	return { cpu, memory, control, same, begin, grant, finish, backing };
}

for (const optLevel of [0, 3] as const) {
	test(`immediate table growth preserves the native header, barrier, and hash fill effects at O${optLevel}`, () => {
		const f = fixture(optLevel);
		const { memory } = f;
		for (const hash of [0, 1, 128, 256, 1024]) {
			const record = f.same(target => createReferenceTable(target, 2, 4)), array = 9;
			const oldHash = f.same(target => target.tables.hashAddress(record));
			const base = f.backing(array * 5), storage = hash === 0 ? 0 : f.backing(TableRecords.hashStorageBytes(hash));
			const alias = hash === 1 ? MAIN_RAM_SIZE : 0, cppMirror = hash === 128;
			f.same(target => {
				const { memory } = target;
				memory.writeRamRecordWord(record + TableHeader.Length, 2);
				memory.writeRamRecordWord(oldHash, 0x5091ab47);
				memory.writeRamRecordByte(record + GC_COLOR_OFFSET, 0xa3);
				memory.writeRamRecordPair(f.control + GC_TRACE_RECORD, record, 1);
				memory.writeRamRecordPair(f.control + GC_MODE_META, record, 7);
				memory.writeRamRecordWord(f.control + GC_ROOT_CURSOR - 4, 16);
			});
			const logical = f.cpu.luaHeap.usedBytes(), physical = f.cpu.heapAllocator.occupiedBytes();
			f.begin(record + alias, array, hash, false, storage, base, cppMirror);
			f.finish();
			assert.equal(memory.readRamRecordWord(record + TableHeader.Free), (hash - 1) >>> 0);
			assert.equal(memory.readRamRecordWord(record + TableHeader.Length), 2);
			assert.equal(memory.readRamRecordWord(oldHash), 0x5091ab47, 'caller still owns the old hash view');
			assert.equal(memory.readRamRecordByte(base), dirty, 'array tag and payload planes have not been reshuffled');
			assert.equal(memory.readRamRecordWord(f.control + GC_TRACE_RECORD), alias === 0 ? 0 : record);
			assert.equal(memory.readRamRecordByte(record + GC_COLOR_OFFSET), cppMirror ? 2 : alias === 0 ? 0xa2 : 0xa3);
			assert.equal(f.cpu.luaHeap.usedBytes(), logical);
			assert.equal(f.cpu.heapAllocator.occupiedBytes(), physical);
		}

		const record = f.same(target => createReferenceTable(target, 1, 8)), array = 7;
		const storage = f.same(target => target.tables.hashAddress(record)), base = f.backing(array * 5);
		f.same(target => {
			target.memory.writeRamRecordWord(storage, 0x1627419b);
			target.memory.writeRamRecordWord(record + TableHeader.Free, 5);
		});
		f.begin(record, array, 8, true, storage, base);
		f.finish();
		assert.equal(memory.readRamRecordWord(storage), 0x1627419b, 'kept hash remains untouched');
		assert.equal(memory.readRamRecordWord(record + TableHeader.Free), 5);
	});

	test(`immediate publication and hash initialization resume at original write boundaries at O${optLevel}`, () => {
		const f = fixture(optLevel);
		const { cpu, memory, control } = f;
		const record = f.same(target => createReferenceTable(target, 2, 4)), array = 11, hash = 256;
		const oldHash = memory.readRamRecordWord(record + TableHeader.HashStorage);
		const oldArray = memory.readRamRecordWord(record + TableHeader.ArrayStorage);
		const storage = f.backing(TableRecords.hashStorageBytes(hash)), base = f.backing(array * 5);
		f.same(target => {
			const { memory } = target;
			memory.writeRamRecordByte(record + GC_COLOR_OFFSET, 3);
			memory.writeRamRecordPair(control + GC_TRACE_RECORD, record, 4);
			memory.writeRamRecordPair(control + GC_MODE_META, record, 7);
			memory.writeRamRecordWord(control + GC_ROOT_CURSOR - 4, 16);
		});
		f.begin(record, array, hash, false, storage, base);
		for (let i = 0; i < 4096 && memory.readRamRecordWord(record + TableHeader.Array) !== array; ++i) f.grant(1);
		assert.ok(!cpu.isHaltedUntilIrq());
		assert.equal(memory.readRamRecordWord(record + TableHeader.Array), array);
		assert.equal(memory.readRamRecordWord(control + GC_TRACE_CURSOR), 0, 'scan invalidates before publishing the new extent');
		assert.equal(memory.readRamRecordWord(control + GC_MODE_META), 0);
		assert.notEqual(memory.readRamRecordWord(control + GC_CHANGED_HEAD), 0);
		assert.equal(memory.readRamRecordWord(record + TableHeader.HashStorage), oldHash);
		assert.equal(memory.readRamRecordWord(record + TableHeader.ArrayStorage), oldArray);
		for (let i = 0; i < 4096 && memory.readRamRecordWord(record + TableHeader.ArrayStorage) !== base; ++i) f.grant(1);
		assert.ok(!cpu.isHaltedUntilIrq());
		assert.equal(memory.readRamRecordWord(record + TableHeader.ArrayStorage), base);
		assert.equal(memory.readRamRecordWord(record + TableHeader.HashStorage), storage);
		assert.equal(memory.readRamRecordWord(record + TableHeader.Hash), hash);
		assert.equal(memory.readRamRecordWord(record + TableHeader.Free), hash - 1);
		assert.equal(memory.readRamRecordByte(storage), dirty, 'all backing words publish before the fill');
		for (let i = 0; i < 4096 && memory.readRamRecordByte(storage) === dirty; ++i) f.grant(1);
		assert.ok(!cpu.isHaltedUntilIrq());
		assert.equal(memory.readRamRecordWord(storage), 0);
		assert.equal(memory.readRamRecordByte(storage + 10 * hash), dirty, 'link fill is still pending');
		const checkpoint = captureCpuCheckpoint(cpu);
		const cycles = f.finish();
		restoreCpuCheckpoint(cpu, checkpoint);
		assert.equal(f.finish(), cycles);
	});
}

const pins = [
	['T', 'machine/ts/machine/cpu/table.ts', '39610ec36786e68a5712461b3eebd017816fba9758f1a1644b024871213e05e7', [[34, 34], [121, 121], [139, 142], [152, 164], [830, 834]]],
	['C', 'machine/cpp/machine/cpu/table.cpp', '2b8976327da44c9c7fd5f6d5df7b01b6d2593387024fdb9e3cae19ac04403d3e', [[383, 383], [387, 390], [477, 480], [493, 506]]],
	['H', 'machine/cpp/machine/cpu/table.h', 'f0f5b4a879cb6cbd33612aa64d53339a6cbb85bac8d2edb03e3d74f445b88932', [[27, 27], [43, 48], [241, 241]]],
	['U', 'machine/ts/machine/cpu/gc_heap.ts', 'ae281750665c38337e070e7256a71d4423ac7db2c8625ce5542319cd07e7bd81', [[188, 190], [198, 203], [252, 260]]],
	['V', 'machine/cpp/machine/cpu/gc_heap.cpp', 'c61514f015e406bc93dab030f91c6eba75759594baca62a473151911e38b7f54', [[95, 101], [155, 163]]],
	['W', 'machine/cpp/machine/cpu/gc_heap.h', 'eb278883736d46c77dd656d6b1c60a461cb6f47fbea93623d754516158427d7f', [[159, 161]]],
	['M', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0', [[6, 7], [9, 9]]],
] as const;

test('the immediate publication references original layout, barrier, bindings, and hash initialization only', () => {
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture([port]));
	const file = workspace.updateFile(port, source);
	const span = file.chunk.body.get(file.chunk.body.length - 1).span;
	const types = new StructTypes(workspace.getSnapshot(), { value: () => undefined, storage: () => undefined });
	for (const [name, size, fields] of [
		['growth_publication_header', TableRecords.HEADER_BYTES, [['hash_storage', TableHeader.HashStorage],
			['array_slots', TableHeader.Array], ['hash_slots', TableHeader.Hash], ['length', TableHeader.Length],
			['free', TableHeader.Free], ['array_storage', TableHeader.ArrayStorage]]],
		['growth_publication_reservation', 8, [['hash_storage', 0], ['array_storage', 4]]],
	] as const) {
		const type = types.resolve(port, { name, arrayLengths: [], span });
		assert.equal(type.size, size, name);
		for (const [name, offset] of fields) {
			const field = type.struct!.fields.get(name);
			assert.ok(field, name);
			assert.equal(field.offset, offset, name);
			assert.equal(field.size, 4, name);
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
	const exports = lines.indexOf('return { publish_table_growth = publish_table_growth }');
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
	for (const [key, line] of [['T', 818], ['T', 835], ['T', 849], ['T', 868], ['C', 269], ['C', 391], ['C', 407], ['C', 423]] as const) {
		assert.equal(sources.get(key)!.covered.has(line), false, 'staging, rehash, and retirement stay with the caller');
	}
});
