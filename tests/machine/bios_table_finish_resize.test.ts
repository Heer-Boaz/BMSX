import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { HEAP_GC_CONTROL_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_COLOR_OFFSET } from '../../machine/ts/machine/cpu/gc_object';
import { HASH_STORE_DECLINED, TableHeader, TableRecords } from '../../machine/ts/machine/cpu/table';
import { type Value, hashCanonicalTableKey, valueBool, valueBuiltinFunction, valueFloatBits, valueInteger, valuePayload, valueString, valueTable, valueTag } from '../../machine/ts/machine/cpu/value';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { HeapServiceRemarkHeadField, HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_VALUE_COUNT } from '../../machine/ts/spec/bmsx/heap_service';
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

const REINSERT = 'kernel/table_reinsert', FINISH = 'kernel/table_finish_resize', RESIZE = 'kernel/table_resize';
const ASSIGNMENT = 'kernel/table_assignment', entrySource = 'halt_until_irq';
const basis = 'c36fafd44eea29507af392041fda24f433709f18';
const modules = ['kernel/dlmalloc', 'kernel/dlmalloc_record', 'kernel/gc_control', 'kernel/gc_strings', 'kernel/gc_mark',
	'kernel/gc_barrier', 'kernel/table_create', 'kernel/table_reserve_growth', 'kernel/table_publish_growth', REINSERT, FINISH, RESIZE, ASSIGNMENT].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8').replaceAll('\r\n', '\n');
	return { path, source, chunk: parseLuaChunk(source, path) };
});
const untouchedReservation = [0x168151d7, 0xf10b4a91] as const;

function fixture(optLevel: 0 | 3) {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	function functionIndex(path: string, name: string) {
		const symbol = object.sections.rodata.moduleExports.find(entry => entry.path === path && entry.exportPathKey === name);
		assert.ok(symbol);
		const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[symbol.slotName]);
		assert.ok(index >= 0);
		return index;
	}
	const root = functionIndex(RESIZE, 'execute_table_resize');
	const { frames, valueSlots } = deriveBlua32FixedStack(linked.image, [root]);
	assert.ok(frames <= HEAP_SERVICE_FRAME_COUNT && valueSlots <= HEAP_SERVICE_VALUE_COUNT, `pinned stack: ${valueSlots} values, ${frames} frames`);
	const entry = linked.image.functions[root].address;
	const { cpu, memory } = createTestSystemCpu(linked), oracle = createTestSystemCpu(linked).cpu;
	for (const target of [cpu, oracle]) runGuestToHalt(target, 10_000);
	const management = cpu.heapAllocator.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
	const state = cpu.heapAllocator.allocatorStateOffset(), occupied = cpu.luaHeap.occupiedOffset;
	function same<T>(action: (target: CPU) => T): T {
		const result = action(cpu);
		assert.deepEqual(action(oracle), result);
		return result;
	}
	const scratch = same(target => target.heapAllocator.allocate(40, true) - RAM_BASE);
	assert.ok(scratch > 0);
	const reserved = () => [memory.readRamRecordWord(scratch), memory.readRamRecordWord(scratch + 4)];
	function compare() {
		const first = memory.ramBusEnd() - RAM_BASE, last = management + HEAP_SERVICE_THREAD_OFFSET;
		// Only the protocol's reservation-result lanes differ from the native caller's locals.
		for (const [from, to] of [[first, scratch], [scratch + 8, last]]) {
			const actual = memory.ramData().subarray(from, to), expected = oracle.memory.ramData().subarray(from, to);
			if (Buffer.compare(actual, expected) === 0) continue;
			const mismatch = actual.findIndex((value, index) => value !== expected[index]);
			assert.equal(actual[mismatch], expected[mismatch], `private RAM differs at 0x${(from + mismatch).toString(16)}`);
		}
	}
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		const spent = cycles - cpu.instructionBudgetRemaining;
		assert.ok(spent > 0);
		return spent;
	}
	function drain() {
		let cycles = 0;
		for (let i = 0; i < 256 && cpu.heapServiceActive(); ++i) cycles += grant(2048);
		assert.equal(cpu.heapServiceActive(), false);
		return cycles;
	}
	function begin(record: number, array: number, hash: number, keepHash: boolean, key: Value, value: Value, cppMirror = true) {
		const tables = oracle.gc.tables;
		const oldArray = tables.arrayCapacity(record), oldHash = tables.hashSize(record);
		const oldStorage = tables.hashAddress(record);
		const previous = TableRecords.allocationCharge(oldArray, oldHash), requested = TableRecords.allocationCharge(array, hash);
		const hashBytes = TableRecords.hashStorageBytes(hash);
		const request = [...untouchedReservation, valueTag(key), valuePayload(key), valueTag(value), valuePayload(value), previous, requested, +keepHash, hashBytes];
		same(target => {
			for (const [index, word] of request.entries()) target.memory.writeRamRecordWord(scratch + index * 4, word);
		});
		const plan = tables['resizePlan'];
		plan.array = array; plan.hash = hash; plan.keepHash = keepHash;
		const expected = tables['resize'](record, key, value, previous, requested);
		if (cppMirror) {
			if (expected !== HASH_STORE_DECLINED) {
				tables['publishHashInsertion'](record, key, valueTag(value), valuePayload(value));
				const index = tables['getArrayIndex'](key);
				if (index >= 0) tables['updateLengthHint'](record, index, true);
			}
			assert.ok(cpu.beginHeapService(entry, [management, record, array, hash, scratch]));
		} else {
			// Exercise the original TS cursor order through the same port
			// leaves, separately from the one production entry policy.
			const functions = linked.image.functions;
			assert.ok(cpu.beginHeapService(functions[functionIndex('kernel/table_reserve_growth', 'reserve_table_growth')].address,
				[state, record, array, hash, hashBytes, +keepHash, 0, scratch]));
			drain();
			assert.equal(cpu.heapServiceResult(), 1);
			assert.ok(cpu.beginHeapService(functions[functionIndex('kernel/table_publish_growth', 'publish_table_growth')].address,
				[control, record, array, hash, hashBytes, +keepHash, scratch, 0]));
			drain();
			assert.ok(cpu.beginHeapService(functions[functionIndex(FINISH, 'finish_table_resize')].address,
				[state, occupied, record, oldArray, oldHash, oldStorage, scratch + 8, 0]));
		}
		return expected;
	}
	function verify(expected: number, cppMirror = true) {
		assert.equal(cpu.heapServiceResult(), cppMirror ? +(expected !== HASH_STORE_DECLINED) : expected >>> 0);
		if (expected === HASH_STORE_DECLINED) assert.deepEqual(reserved(), untouchedReservation);
		compare();
	}
	return { cpu, memory, same, begin, grant, drain, reserved, verify };
}

function integerWithHome(home: number): Value {
	for (let n = -1; n >= -1024; --n) {
		const key = valueInteger(n);
		if ((hashCanonicalTableKey(key) & 7) === home) return key;
	}
	throw new Error('fixture cannot find an Integer key');
}

for (const opt of [0, 3] as const) {
	test(`Table immediate resize matches the native body across packed-array grow, shrink, release, and hash bands at O${opt}`, () => {
		const f = fixture(opt);
		for (const [oldArray, oldHash, array, hash, keepHash] of [
			[31, 4, 32, 4, true], [32, 8, 31, 16, false], [16, 4, 0, 32, false], [1, 128, 2, 1024, false],
		] as const) {
			const record = f.same(target => target.createTable(oldArray, oldHash));
			const key = keepHash ? valueInteger(array) : f.same(target => valueString(target.stringPool.intern('grow')));
			const value = valueInteger(-2147483648);
			const mappings = f.same(target => {
				const next: [Value, Value][] = [];
				const tick = valueString(target.stringPool.intern('tick'));
				for (let i = 1; i <= oldArray; ++i) {
					const values = [tick, valueBool(true), valueFloatBits(0xbf400000), valueInteger(i * 17)];
					next.push([valueInteger(i), i === 5 ? valueBool(false) : values[i & 3]]);
				}
				const store = target.gc.tables;
				next.push([tick, valueInteger(87)], [valueInteger(-100), tick]);
				if (hash === 1024) next.push([valueInteger(59), valueBool(false)], [valueInteger(64), valueInteger(815)],
					[valueBool(false), valueInteger(98)], [valueBool(true), tick], [valueFloatBits(0xbf400000), valueInteger(17)],
					[valueBuiltinFunction(BuiltinFunctionId.RawGet), valueInteger(6)], [valueTable(target.createTable()), valueInteger(217)]);
				for (const [k, v] of next) store.set(record, k, v);
				return next;
			});
			const oldBase = f.cpu.gc.tables.arrayAddress(record), charged = f.cpu.luaHeap.usedBytes();
			const expected = f.begin(record, array, hash, keepHash, key, value);
			let publication: ReturnType<typeof captureCpuCheckpoint> | undefined;
			let checkpoint: ReturnType<typeof captureCpuCheckpoint> | undefined;
			if (keepHash) {
				for (let n = 0; n < 4096 && f.cpu.gc.tables.arrayCapacity(record) !== array; ++n) f.grant(1);
				assert.ok(f.cpu.heapServiceActive());
				assert.equal(f.cpu.gc.tables.arrayCapacity(record), array);
				assert.equal(f.cpu.gc.tables.arrayAddress(record), oldBase, 'header count changed before its backing lane');
				assert.equal(f.cpu.luaHeap.usedBytes(), charged);
				publication = captureCpuCheckpoint(f.cpu);
				// 31→32 starts with backwards overlapping tag copy. The top byte
				// moves first while the first destination byte still aliases the source.
				const [, base] = f.reserved();
				assert.ok(base >= RAM_BASE);
				const mux = base + 4 * array, last = mux + oldArray - 1, prior = f.memory.readRamRecordByte(last);
				for (let n = 0; n < 4096 && f.memory.readRamRecordByte(last) === prior; ++n) f.grant(1);
				assert.ok(f.cpu.heapServiceActive());
				assert.equal(f.memory.readRamRecordByte(last), valueTag(mappings[oldArray - 1][1]));
				assert.notEqual(f.memory.readRamRecordByte(mux), valueTag(mappings[0][1]));
				checkpoint = captureCpuCheckpoint(f.cpu);
			}
			const cycles = f.drain();
			f.verify(expected);
			if (checkpoint) {
				restoreCpuCheckpoint(f.cpu, checkpoint);
				assert.equal(f.drain(), cycles);
				f.verify(expected);
			}
			if (publication) {
				restoreCpuCheckpoint(f.cpu, publication);
				assert.ok(f.drain() > cycles);
				f.verify(expected);
			}
			for (const [k, v] of [...mappings, [key, value]] as const) assert.equal(f.cpu.gc.tables.get(record, k), v);
		}
	});

	test(`Table immediate resize preserves Brent relocation and both Free publication timings at O${opt}`, () => {
		const f = fixture(opt);
		for (const cppMirror of [false, true]) {
			const record = f.same(target => target.createTable(0, 4));
			const a = integerWithHome(2), candidate = valuePayload(a) | 0;
			let b = valueInteger(candidate - 1);
			while ((hashCanonicalTableKey(b) & 7) !== 2) b = valueInteger((valuePayload(b) | 0) - 1);
			const c = integerWithHome(7);
			const first = valueInteger(10), second = valueFloatBits(0x7fa35125), third = valueBool(true);
			f.same(target => {
				target.gc.tables.set(record, a, first);
				target.gc.tables.set(record, b, second);
			});
			const expected = f.begin(record, 0, 8, false, c, third, cppMirror);
			for (let n = 0; n < 4096 && f.cpu.gc.tables.hashSize(record) !== 8; ++n) f.grant(1);
			assert.equal(f.cpu.gc.tables.hashSize(record), 8);
			const storage = f.cpu.gc.tables.hashAddress(record), links = storage + 80;
			// Wait for the new link lane to be initialized before observing the collision.
			for (let n = 0; n < 4096 && f.memory.readRamRecordByte(links + 2) !== 0xff; ++n) f.grant(1);
			assert.equal(f.memory.readRamRecordByte(links + 2), 0xff);
			for (let n = 0; n < 4096 && f.memory.readRamRecordByte(links + 2) === 0xff; ++n) f.grant(1);
			assert.equal(f.memory.readRamRecordByte(links + 2), 7, 'the first collision uses the highest free slot');
			assert.equal(f.memory.readRamRecordWord(record + TableHeader.Free), cppMirror ? 7 : 6);
			const checkpoint = captureCpuCheckpoint(f.cpu);
			const cycles = f.drain();
			f.verify(expected, cppMirror);
			assert.equal(expected, 7);
			assert.equal(f.memory.readRamRecordByte(links + 2), 6, 'trigger owns home 7 after moving the prior collision');
			assert.equal(f.memory.readRamRecordWord(record + TableHeader.Free), 5);
			assert.equal(f.cpu.gc.tables.get(record, a), first);
			assert.equal(f.cpu.gc.tables.get(record, b), second);
			assert.equal(f.cpu.gc.tables.get(record, c), third);
			restoreCpuCheckpoint(f.cpu, checkpoint);
			assert.equal(f.drain(), cycles);
			f.verify(expected, cppMirror);
		}
	});

	test(`the resident resize clears method absence before its direct marking barrier at O${opt}`, () => {
		const f = fixture(opt);
		const owner = f.same(target => target.createTable(0, 1));
		const id = f.same(target => target.stringPool.intern('a new collectable edge'));
		const key = f.same(target => valueString(target.gc.diagnosticWord(HeapServiceRemarkHeadField.NewIndex)));
		f.same(target => {
			const pending = target.stringPool.intern('a String marked before the table write');
			const control = target.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
			target.stringPool.beginReachabilityEpoch();
			target.stringPool.markReachable(pending);
			target.memory.writeRamRecordByte(control, GcPhase.MarkAgain);
			target.memory.writeRamRecordByte(owner + GC_COLOR_OFFSET, 3);
		});
		const work = f.cpu.gc.epochWork();
		const expected = f.begin(owner, 0, 2, false, key, valueString(id));
		for (let i = 0; i < 4096 && f.memory.readRamRecordByte(owner + TableHeader.NewIndexAbsent) !== 0; ++i) f.grant(1);
		assert.equal(f.memory.readRamRecordByte(owner + TableHeader.NewIndexAbsent), 0);
		assert.ok(f.cpu.heapServiceActive());
		assert.equal(f.cpu.gc.epochWork(), work, 'the key cache was cleared before barrier accounting');
		const checkpoint = captureCpuCheckpoint(f.cpu);
		const cycles = f.drain();
		f.verify(expected);
		assert.ok(f.cpu.gc.epochWork() > work, 'the guest accounted String work');
		assert.equal(f.cpu.stringPool.takeMarkWork(), 0);
		restoreCpuCheckpoint(f.cpu, checkpoint);
		assert.equal(f.drain(), cycles);
		f.verify(expected);
	});

	test(`combined immediate resize retires a refused hash without entering publication at O${opt}`, () => {
		const f = fixture(opt), hash = 16;
		const record = f.same(target => target.createTable(32, 8));
		f.same(target => {
			const arena = target.heapAllocator;
			target.gc.tables.set(record, valueInteger(32), valueInteger(17));
			while (arena.allocate(4088, true)) { /* exhaust page supply */ }
			while (arena.allocate(TableRecords.hashStorageBytes(hash), true)) { /* exhaust hash fits */ }
		});
		const before = f.cpu.heapAllocator.occupiedBytes(), charged = f.cpu.luaHeap.usedBytes();
		const oldHash = f.cpu.gc.tables.hashAddress(record);
		const expected = f.begin(record, 31, hash, false, valueInteger(-1), valueBool(true));
		assert.equal(expected, HASH_STORE_DECLINED);
		for (let n = 0; n < 8192 && f.cpu.heapServiceActive(); ++n) {
			f.grant(1);
			assert.equal(f.cpu.gc.tables.arrayCapacity(record), 32);
			assert.equal(f.cpu.gc.tables.hashAddress(record), oldHash);
		}
		assert.equal(f.cpu.heapServiceActive(), false);
		assert.equal(f.cpu.heapAllocator.occupiedBytes(), before);
		assert.equal(f.cpu.luaHeap.usedBytes(), charged);
		f.verify(expected);
	});
}

const pins = [
	['T', 'machine/ts/machine/cpu/table.ts', '39610ec36786e68a5712461b3eebd017816fba9758f1a1644b024871213e05e7', [[187, 190], [524, 524], [564, 567], [588, 605], [607, 629], [632, 643], [801, 804], [806, 817], [830, 834], [840, 869], [1104, 1105]]],
	['C', 'machine/cpp/machine/cpu/table.cpp', '2b8976327da44c9c7fd5f6d5df7b01b6d2593387024fdb9e3cae19ac04403d3e', [[83, 85], [143, 150], [255, 268], [383, 383], [387, 390], [396, 424], [523, 562], [584, 598], [741, 742], [816, 817], [857, 857]]],
	['H', 'machine/cpp/machine/cpu/table.h', 'f0f5b4a879cb6cbd33612aa64d53339a6cbb85bac8d2edb03e3d74f445b88932', [[27, 27], [31, 31], [44, 47], [200, 202], [212, 214], [246, 255], [262, 282], [305, 306]]],
	['V', 'machine/ts/machine/cpu/value.ts', 'bdafe30a070405b98b673dfe76e0daad1384ccd87ee7ca26584eba734204c641', [[90, 103]]],
	['W', 'machine/cpp/machine/cpu/value.h', 'cb211876c00637f49334db80b281d4af8a17f978bdceb736b6c9a177b9abe94e', [[109, 125]]],
	['U', 'machine/ts/machine/cpu/lua_heap.ts', '1c9905f061ffcb9bc031196c6549981300c5281a608f14618a6117d0882e74b9', [[289, 291], [305, 311]]],
	['N', 'machine/cpp/machine/cpu/lua_heap.cpp', 'c6815cbfb0f3caa513dd64c403296125b71a09a2ecaa50a61ecd9ded3091a90b', [[308, 316]]],
	['A', 'machine/ts/machine/cpu/heap_allocator.ts', '79309f418c20016b037b26fae01b28c891c72a2ed155ba1f375d7bc11f6d42f1', [[61, 61], [66, 68]]],
	['B', 'machine/cpp/machine/cpu/heap_allocator.cpp', 'aea53d9b2fecb8ae6d17abda4987b08e2af8a4fdf9a8424c49e10fc84f9eb7a5', [[59, 59], [64, 66]]],
	['I', 'machine/ts/spec/blua32/image_format.ts', 'd2f3d690faa89da542f2b2bcc49daaa3cdda0c6edbface508ba894ff1ea09959', [[54, 54]]],
	['J', 'machine/cpp/spec/blua32/image_format.h', 'd82ee3f5580bb06ce9269e0e5c4b5d32f76985c84a8a5074483a90be630a1111', [[60, 60]]],
	['M', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0', [[6, 7], [9, 9]]],
] as const;

test('combined Table resize pins both native mappings, including allocation refusal and cursor publication', () => {
	const ports = [REINSERT, FINISH, RESIZE, ASSIGNMENT].map(name => `machine/bios/${name}.lua`);
	const sources = new Map<string, { lines: string[]; covered: Set<number> }>();
	for (const [key, file, digest] of pins) {
		const pinned = execFileSync('git', ['show', `${basis}:${file}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(pinned).digest('hex'), digest, `${file}: source changed`);
		sources.set(key, { lines: pinned.split('\n'), covered: new Set() });
	}
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture(ports));
	const unmapped = /^\s*(?:$|--|module<const>$|struct \w+$|end$)/;
	for (const port of ports) {
		const source = readFileSync(port, 'utf8').replaceAll('\r\n', '\n');
		workspace.updateFile(port, source);
		const lines = source.split('\n');
		assert.ok(lines.includes(`-- Source basis: ${basis}.`));
		const exports = lines.findIndex(line => line.startsWith('return {'));
		assert.ok(exports > 0);
		for (const [index, line] of lines.slice(0, exports).entries()) {
			if (unmapped.test(line)) continue;
			const origin = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
			assert.ok(origin, `${port}:${index + 1}: missing native origin for ${line.trim()}`);
			for (const entry of origin[1].trim().split(/\s+/)) {
				const [key, intervals] = entry.split(':');
				const native = sources.get(key);
				assert.ok(native, `${port}:${index + 1}: unknown ${key}`);
				for (const interval of intervals.split(',')) {
					const [first, last = first] = interval.split('-').map(Number);
					assert.ok(first >= 1 && last >= first && last <= native.lines.length, entry);
					for (let n = first; n <= last; ++n) native.covered.add(n);
				}
			}
		}
	}
	const types = new StructTypes(workspace.getSnapshot(), { value: () => undefined, storage: () => undefined });
	const tail = modules.find(module => module.path === FINISH)!.chunk.body;
	const tailSpan = tail.get(tail.length - 1).span;
	const header = types.resolve(ports[1], { name: 'immediate_resize_table', arrayLengths: [], span: tailSpan }).struct!;
	assert.equal(header.size, TableRecords.HEADER_BYTES);
	for (const [name, offset] of [
		['hash_storage', TableHeader.HashStorage], ['array_slots', TableHeader.Array], ['hash_slots', TableHeader.Hash],
		['free', TableHeader.Free], ['array_storage', TableHeader.ArrayStorage],
	] as const) assert.equal(header.fields.get(name)!.offset, offset);
	const context = types.resolve(ports[1], { name: 'immediate_resize_context', arrayLengths: [], span: tailSpan }).struct!;
	assert.equal(context.size, 28);
	for (const [i, name] of ['key_tag', 'key_word', 'value_tag', 'value_word', 'previous_charge', 'requested_charge', 'keep_hash'].entries())
		assert.equal(context.fields.get(name)!.offset, 4 * i);
	const combined = modules.find(module => module.path === RESIZE)!.chunk.body;
	const span = combined.get(combined.length - 1).span;
	const old = types.resolve(ports[2], { name: 'resize_source_layout', arrayLengths: [], span }).struct!;
	for (const [name, offset] of [['hash_storage', TableHeader.HashStorage], ['array_slots', TableHeader.Array], ['hash_slots', TableHeader.Hash]] as const)
		assert.equal(old.fields.get(name)!.offset, offset);
	const request = types.resolve(ports[2], { name: 'resize_request', arrayLengths: [], span }).struct!;
	assert.equal(request.size, 40);
	assert.equal(request.fields.get('hash_storage')!.offset, 0);
	assert.equal(request.fields.get('array_storage')!.offset, 4);
	for (const [field, properties] of context.fields)
		assert.equal(request.fields.get(field)!.offset, 8 + properties.offset);
	assert.equal(request.fields.get('hash_bytes')!.offset, 36);
	for (const [key, , , ranges] of pins) {
		const native = sources.get(key)!;
		for (const [first, last] of ranges) for (let line = first; line <= last; ++line) {
			const statement = native.lines[line - 1];
			if (/^\s*(?:$|\/\/|[{}]$)/.test(statement)) continue;
			assert.ok(native.covered.has(line), `${key}:${line}: ${statement.trim()} has no firmware counterpart`);
		}
	}
	for (const [key, line] of [['T', 835], ['T', 837], ['T', 1035], ['C', 391], ['C', 433]] as const)
		assert.equal(sources.get(key)!.covered.has(line), false, 'the native hash-only fast path and staged placement are separate leaves');
});
