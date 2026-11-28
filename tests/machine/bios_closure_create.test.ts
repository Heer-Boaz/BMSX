import { nativeHeapReference } from '../helpers/native_heap/reference';
import { allocateClosureRecordReference } from '../helpers/captured_closure_reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	CLOSURE_CANONICAL, CLOSURE_CAPTURE_WORDS, CLOSURE_PROTOTYPE_ADDRESS, type FunctionPrototype,
	closureRecordBytes, initializeRecord,
} from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_GRAY_INDEX_BITS, GC_GRAY_INDEX_MASK, GC_OBJECT_LINK_BEFORE, GC_OBJECT_PREFIX, GC_RECORD_LINK, GC_RECORD_SHIFT } from '../../machine/ts/machine/cpu/gc_object';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { CPU_FIXED_FRAME_COUNT, CPU_FIXED_VALUE_COUNT, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_WORKSPACE_END, HEAP_GC_CONTROL_OFFSET } from '../helpers/firmware_heap_layout';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import type { Blua32FunctionRecord } from '../../toolchain/ts/rompack/blua32_image';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { StructTypes } from '../../toolchain/ts/lua/static/struct_types';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestCartBlua32, writeTestBlua32Rom } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';
import { linkManagedTestSystem } from '../helpers/managed_system';

const MODULE = 'kernel/closure_create', port = `machine/bios/${MODULE}.lua`;
const basis = 'fdbb99cb46fbf8381dff4e5a065ae765dee1b525';
const source = readFileSync(port, 'utf8').replaceAll('\r\n', '\n');
const OBJECT_HEAD = 0x6c, OBJECT_COUNT = 0x70, SWEEP_LINK = 0x74;
// Firmware test only: weak membership occupies the spare object prefix word
// plus this private group of bucket heads, not a CPU or save-state layout.
const WEAK_HEADS = 0x3d00, WEAK_HEAD_COUNT = 128;

function fixture(optLevel: 0 | 3) {
	const cartSource = 'return 42';
	const system = linkManagedTestSystem('halt_until_irq', optLevel, [], [
		{ path: MODULE, exportPathKey: 'create_closure' },
	]);
	const [entry] = system.biosImports.functions;
	const fn = system.symbols.functionAddresses.indexOf(entry.functionAddress);
	const fixed = deriveBlua32FixedStack(system.layout, [fn]);
	assert.ok(fixed.frames <= CPU_FIXED_FRAME_COUNT && fixed.valueSlots <= CPU_FIXED_VALUE_COUNT);
	const linkedCart = linkTestCartBlua32(system.biosImports,
		compileLuaChunkToProgram(parseLuaChunk(cartSource), [], { entrySource: cartSource, optLevel }));
	const cart = linkedCart.cartImage.functions.find(record => record.address === linkedCart.cartVectors.entryFunctionAddress)!;
	const firmware = system.layout.functions[fn];
	const prototype = (record: Blua32FunctionRecord, executionDomainId: FunctionPrototype['executionDomainId']): FunctionPrototype => ({
		functionAddress: record.address, executionDomainId, codeAddress: record.codeAddress, flags: record.flags, numParams: record.numParams,
		maxStack: record.maxStack, upvalueTableAddress: record.upvalueTableAddress, recordUpvalueCount: record.upvalues.length,
	});
	// The same mapped cartridge program is installed separately on both sockets.
	function create() {
		const runtime = new Runtime({
			systemRomBytes: writeTestBlua32Rom(system), cartridgeSlots: cartridgeSlots(linkedCart.cartRomBytes, linkedCart.cartRomBytes),
			machineModel: PSX_MACHINE_SPEC,
		}, { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} });
		runtime.boot();
		const { cpu } = runtime.machine;
		runGuestToHalt(cpu, 1_000_000);
		assert.ok(cpu.isHaltedUntilIrq());
		return cpu;
	}
	const cpu = create(), oracle = create(), memory = cpu.memory;
	const management = cpu.heapAllocator.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
	const first = memory.ramBusEnd() - RAM_BASE, last = management + GC_WORKSPACE_END;
	function compare(weakMembers: readonly number[] = []) {
		const actual = memory.ramData(), expected = oracle.memory.ramData();
		let previous = first;
		for (const member of weakMembers.toSorted((left, right) => left - right)) {
			const link = member - RAM_BASE - GC_OBJECT_PREFIX;
			assert.equal(Buffer.compare(actual.subarray(previous, link), expected.subarray(previous, link)), 0,
				`native storage and firmware differ before weak word at 0x${link.toString(16)}`);
			previous = link + 4;
		}
		assert.equal(Buffer.compare(actual.subarray(previous, last), expected.subarray(previous, last)), 0);
	}
	function begin(proto: FunctionPrototype, canonical: boolean) {
		assert.equal(proto.recordUpvalueCount, 0);
		assert.ok(cpu.beginHeapService(entry.functionAddress,
			[cpu.heapAllocator.allocatorStateOffset(), control, cpu.luaHeap.occupiedOffset, proto.functionAddress, proto.executionDomainId >>> 0, +canonical]));
	}
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		const spent = cycles - cpu.instructionBudgetRemaining;
		assert.ok(spent > 0);
		return spent;
	}
	function finish() {
		let cycles = 0;
		for (let i = 0; i < 16 && cpu.heapServiceActive(); ++i) cycles += grant(256);
		return cycles;
	}
	function native(proto: FunctionPrototype, canonical: boolean) {
		const address = allocateClosureRecordReference(oracle, 0, false);
		initializeRecord(oracle.memory, address, proto, canonical, nativeHeapReference(oracle).gc.white(), 0);
		nativeHeapReference(oracle).gc.publishObject(address);
		return address;
	}
	return { cpu, oracle, memory, control, compare, begin, grant, finish, native, heads: management + WEAK_HEADS,
		prototypes: [prototype(firmware, -1), prototype(cart, 0), prototype(cart, 1)] };
}

for (const optLevel of [0, 3] as const) for (const canonical of [true, false]) {
	test(`captureless ROM Closure (${canonical}) BIOS reservation and inventory match native at O${optLevel}`, () => {
		const f = fixture(optLevel);
		const members: number[] = [];
		const readHeads = () => Array.from({ length: WEAK_HEAD_COUNT }, (_, i) => f.memory.readRamRecordWord(f.heads + 4 * i));
		const heads = readHeads();
		for (const [step, proto] of f.prototypes.entries()) {
			const before = f.memory.readRamRecordWord(f.control + OBJECT_HEAD), count = f.memory.readRamRecordWord(f.control + OBJECT_COUNT);
			const sweep = step === 0 ? before - GC_OBJECT_LINK_BEFORE : f.control + OBJECT_HEAD;
			for (const cpu of [f.cpu, f.oracle]) {
				cpu.memory.writeRamRecordWord(f.control + SWEEP_LINK, sweep);
				cpu.memory.writeRamRecordByte(f.control + 1, 0xa0 | (step & 1));
			}
			const occupied = f.cpu.luaHeap.usedBytes();
			const address = f.native(proto, canonical);
			const kind = ValueTag.Closure | ((step & 1) << 8) | (((proto.executionDomainId + 1) | (canonical ? CLOSURE_CANONICAL : 0)) << 16);
			f.begin(proto, canonical);
			let checkpoint: ReturnType<typeof captureCpuCheckpoint> | undefined;
			if (step === 0) {
				for (let i = 0; i < 4096 && f.cpu.luaHeap.usedBytes() === occupied; ++i) f.grant(1);
				assert.equal(f.cpu.luaHeap.usedBytes(), occupied + CLOSURE_CAPTURE_WORDS);
				assert.notEqual(f.memory.readRamRecordWord(address), kind, 'logical charge precedes the Closure header');
				for (let i = 0; i < 4096 && f.memory.readRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS) !== proto.functionAddress; ++i) f.grant(1);
				assert.ok(f.cpu.heapServiceActive());
				assert.equal(f.memory.readRamRecordWord(address), kind);
				assert.equal(f.memory.readRamRecordWord(address + GC_RECORD_LINK), 0);
				assert.equal(f.memory.readRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS), proto.functionAddress);
				assert.equal(f.memory.readRamRecordWord(f.control + OBJECT_HEAD), before, 'prototype write precedes inventory');
				checkpoint = captureCpuCheckpoint(f.cpu);
			}
			const spent = f.finish();
			assert.equal(f.cpu.heapServiceResult(), address - RAM_BASE);
			assert.equal(f.cpu.luaHeap.usedBytes(), occupied + CLOSURE_CAPTURE_WORDS);
			// An unsplittable remainder is charged as part of the actual chunk.
			assert.equal(f.cpu.heapAllocator.occupiedBytes(), f.oracle.heapAllocator.occupiedBytes());
			assert.ok(f.cpu.heapAllocator.issuedObjectStart(address - RAM_BASE - GC_OBJECT_PREFIX));
			assert.equal(f.memory.readRamRecordWord(address), kind);
			assert.equal(f.memory.readRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS), proto.functionAddress);
			assert.equal(f.memory.readRamRecordWord(address - GC_OBJECT_LINK_BEFORE), before);
			assert.equal(f.memory.readRamRecordWord(f.control + OBJECT_HEAD), address);
			assert.equal(f.memory.readRamRecordWord(f.control + OBJECT_COUNT), count + 1);
			assert.equal(f.memory.readRamRecordWord(f.control + SWEEP_LINK), step === 0 ? sweep : address - GC_OBJECT_LINK_BEFORE);
			const link = f.memory.readRamRecordWord(address - GC_OBJECT_PREFIX);
			if (canonical) {
				const bucket = link >>> GC_GRAY_INDEX_BITS;
				assert.ok(bucket < heads.length);
				assert.equal(link & GC_GRAY_INDEX_MASK, heads[bucket], 'publication links only the chosen previous head');
				heads[bucket] = (address - RAM_BASE) >>> GC_RECORD_SHIFT;
				members.push(address);
			}
			assert.deepEqual(readHeads(), heads);
			f.compare(members);
			if (checkpoint !== undefined) {
				restoreCpuCheckpoint(f.cpu, checkpoint);
				assert.equal(f.finish(), spent);
				assert.equal(f.memory.readRamRecordWord(address - GC_OBJECT_PREFIX), link);
				assert.deepEqual(readHeads(), heads);
				f.compare(members);
			}
		}
	});
}

for (const canonical of [true, false]) test(`captureless ROM Closure (${canonical}) refusal leaves charge and inventory untouched`, () => {
	const f = fixture(3), arena = nativeHeapReference(f.cpu).heapAllocator;
	while (arena.allocate(4088, true)) { /* leave no complete page supply */ }
	while (arena.allocate(GC_OBJECT_PREFIX + CLOSURE_CAPTURE_WORDS, true)) { /* exhaust the remaining Closure-size fits */ }
	restoreCpuCheckpoint(f.oracle, captureCpuCheckpoint(f.cpu));
	const occupied = f.cpu.luaHeap.usedBytes();
	assert.equal(nativeHeapReference(f.oracle).heapAllocator.allocate(GC_OBJECT_PREFIX + CLOSURE_CAPTURE_WORDS, false), 0);
	f.begin(f.prototypes[0], canonical);
	f.finish();
	assert.equal(f.cpu.heapServiceResult(), 0);
	assert.equal(f.cpu.luaHeap.usedBytes(), occupied);
	f.compare();
});

const pins = [
	['T', 'machine/ts/machine/cpu/lua_heap.ts', '42b146dce7e77d87bccf7a9e20e36c44f985bfc7f3de1f4966f3bbc3b0ed9230', [[226, 228], [231, 235], [241, 244], [249, 250], [272, 274]]],
	['C', 'machine/cpp/machine/cpu/lua_heap.cpp', '0fb3b3b71921d1321b805260afcbe525efcf506c7fc632ce7e2acb5b4648ed7d', [[241, 243], [246, 249], [255, 259], [263, 264], [283, 285]]],
	['A', 'machine/ts/machine/cpu/heap_allocator.ts', '79309f418c20016b037b26fae01b28c891c72a2ed155ba1f375d7bc11f6d42f1', [[56, 58]]],
	['B', 'machine/cpp/machine/cpu/heap_allocator.cpp', 'aea53d9b2fecb8ae6d17abda4987b08e2af8a4fdf9a8424c49e10fc84f9eb7a5', [[54, 56]]],
	['L', 'machine/ts/machine/cpu/closure.ts', 'dccda2a02992d7ad7a04ae4ee78b46ae7d310b6cf19d787252d73af3cf40d024', [[35, 35], [39, 43], [61, 65], [72, 74]]],
	['R', 'machine/cpp/machine/cpu/closure.cpp', '989524624c0955ea61dde1cfe19a2e5bc6476902194c7117d95c1dc12c7a86c6', [[18, 25]]],
	['H', 'machine/cpp/machine/cpu/closure.h', 'ef85f807bc81dc47034d15cabcf80bffd408c4e9f890827fcabbf11af8512663', [[54, 54], [58, 60], [64, 65], [69, 70]]],
	['N', 'machine/ts/machine/cpu/cpu.ts', 'c199f4a87b23e09d9a9156020aa4acc8e616c083ef678b7f392b312802e700d8', [[1276, 1281], [4013, 4015], [4026, 4028]]],
	['P', 'machine/cpp/machine/cpu/cpu.cpp', '518a1cfeafda8b2774ac2f8b09686656fd788cba82e909d9050074aae0ce4e30', [[161, 166], [585, 587], [2950, 2950], [2963, 2964]]],
	['U', 'machine/ts/machine/cpu/gc_heap.ts', 'c2c3aa2c781339b31dc4c01215ab4573eda384c133efdeb4e653be0b61e6dba2', [[102, 102], [147, 155]]],
	['V', 'machine/cpp/machine/cpu/gc_heap.cpp', '3b381497094c08ac1fdd96cad70a76fd8ab42d560bf23041cd87224afc7c4b3d', [[235, 244]]],
	['W', 'machine/cpp/machine/cpu/gc_heap.h', '306c39028d8f2c953ca62d821a6f726646e12bd8cd21ac4693d98e0696ce84db', [[93, 93]]],
	['O', 'machine/ts/machine/cpu/gc_object.ts', 'eb2b0d0d5cd41541c3a1c33b062416b925e73469135db22262b5270f47471db3', [[6, 6], [8, 9]]],
	['Q', 'machine/cpp/machine/cpu/gc_object.h', '947d8c6020d3d32a4ea747281a7d27cb9fc375d22d6d9c9d2665320a25f1c9e5', [[9, 9], [13, 13], [15, 15]]],
	['J', 'machine/ts/machine/cpu/value.ts', 'bdafe30a070405b98b673dfe76e0daad1384ccd87ee7ca26584eba734204c641', [[9, 10]]],
	['K', 'machine/cpp/machine/cpu/value.h', 'cb211876c00637f49334db80b281d4af8a17f978bdceb736b6c9a177b9abe94e', [[21, 22]]],
	['M', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0', [[6, 6]]],
] as const;

test('captureless ROM Closure firmware binds the mirrored record layout and source effects', () => {
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture([port]));
	const file = workspace.updateFile(port, source);
	const span = file.chunk.body.get(file.chunk.body.length - 1).span;
	const types = new StructTypes(workspace.getSnapshot(), { value: () => undefined, storage: () => undefined });
	const record = types.resolve(port, { name: 'rom_closure', arrayLengths: [], span });
	assert.equal(record.size, closureRecordBytes(0, false));
	for (const [name, offset] of [['kind', 0], ['gray', GC_RECORD_LINK], ['prototype', CLOSURE_PROTOTYPE_ADDRESS]] as const) {
		const field = record.struct!.fields.get(name);
		assert.ok(field, name);
		assert.equal(field.offset, offset, name);
		assert.equal(field.size, 4, name);
	}
	const sources = new Map<string, { lines: string[]; covered: Set<number> }>();
	for (const [key, file, digest] of pins) {
		const pinned = execFileSync('git', ['show', `${basis}:${file}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(pinned).digest('hex'), digest, `${file}: review changed reference bytes`);
		sources.set(key, { lines: pinned.split('\n'), covered: new Set() });
	}
	const lines = source.split('\n');
	assert.ok(lines.includes(`-- Source basis: ${basis}.`));
	const exports = lines.findIndex(line => line.startsWith('return { create_closure = create_closure,'));
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
	for (const [key, line] of [['T', 229], ['T', 230], ['C', 244], ['C', 245]] as const) {
		const native = sources.get(key)!;
		assert.equal(native.covered.has(line), false, 'logical admission stays with the caller');
	}
});
