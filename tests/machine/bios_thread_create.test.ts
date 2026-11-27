import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FRAME_CONTROL_BYTES } from '../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult, type CPU } from '../../machine/ts/machine/cpu/cpu';
import { LUA_OUT_OF_MEMORY_SIGNAL } from '../../machine/ts/machine/cpu/errors';
import { GC_COLOR_OFFSET, GC_OBJECT_PREFIX } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET, HEAP_LOGICAL_OCCUPIED_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { ValueTag, valueClosure, valueNil, valuePayload, valueTag } from '../../machine/ts/machine/cpu/value';
import { LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../machine/ts/spec/blua32/cop0';
import { THREAD_HEAP_BYTES, THREAD_INITIAL_FRAMES, THREAD_INITIAL_VALUES, THREAD_STACK_SLOT_BYTES, ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_ROOT_BANKS_OFFSET, HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_VALUE_COUNT } from '../../machine/ts/spec/bmsx/heap_service';
import { HEAP_PAGE_SIZE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { StructTypes } from '../../toolchain/ts/lua/static/struct_types';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { compileHeapServiceSystem } from '../helpers/heap_service_system';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';

const path = 'kernel/thread_create', port = `machine/bios/${path}.lua`, source = readFileSync(port, 'utf8');
const valueBytes = THREAD_INITIAL_VALUES * THREAD_STACK_SLOT_BYTES, frameBytes = THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES;
const dirty = 0xa7;
const objectHead = 0x6c, objectCount = 0x70; // gc_control inventory lanes

function fixture(opt: 0 | 3, entrySource = 'halt_until_irq') {
	const compiled = compileHeapServiceSystem(entrySource, opt);
	const image = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	function functionIndex(name: string) {
		const exported = object.sections.rodata.moduleExports.find(entry => entry.path === path && entry.exportPathKey === name);
		assert.ok(exported);
		const index = image.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[exported.slotName]);
		assert.ok(index >= 0);
		return index;
	}
	const fn = functionIndex('create_thread'), whole = functionIndex('create_coroutine');
	const { frames, valueSlots } = deriveBlua32FixedStack(image.image, [fn, whole]);
	assert.ok(frames <= HEAP_SERVICE_FRAME_COUNT && valueSlots <= HEAP_SERVICE_VALUE_COUNT);
	const { cpu, memory } = createTestSystemCpu(image), oracle = createTestSystemCpu(image).cpu;
	for (const target of [cpu, oracle]) runGuestToHalt(target, 65_536);
	function same<T>(action: (target: CPU) => T): T {
		const result = action(cpu);
		assert.deepEqual(action(oracle), result);
		return result;
	}
	function begin(management: number, entry: number) {
		assert.ok(cpu.beginHeapService(image.image.functions[fn].address, [management, entry]));
	}
	function beginWhole(management: number, entry: number, cycles: number) {
		assert.ok(cpu.beginHeapService(image.image.functions[whole].address, [management, entry, cycles]));
	}
	function grant(cycles: number) {
		const status = cpu.runUntilDepth(0, cycles);
		assert.equal(status, RunResult.Yielded, `fault ${cpu.readLuaFaultReasonWord()}, active ${cpu.heapServiceActive()}, result ${cpu.heapServiceResult()}`);
		const paid = cycles - cpu.instructionBudgetRemaining;
		assert.ok(paid > 0);
		return paid;
	}
	function compare(extent = HEAP_SERVICE_THREAD_OFFSET) {
		const first = memory.ramBusEnd() - RAM_BASE, end = cpu.heapAllocator.managementOffset() + extent;
		const have = memory.ramData().subarray(first, end), want = oracle.memory.ramData().subarray(first, end);
		if (Buffer.compare(have, want) === 0) return;
		const mismatch = have.findIndex((byte, index) => byte !== want[index]);
		assert.equal(have[mismatch], want[mismatch], `first private RAM mismatch at 0x${(first + mismatch).toString(16)}`);
	}
	function finish(expected: number) {
		let paid = 0;
		for (let i = 0; i < 128 && cpu.heapServiceActive(); ++i) paid += grant(128);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		assert.equal(cpu.heapServiceResult(), expected);
		compare();
		return paid;
	}
	return { cpu, memory, oracle, same, begin, beginWhole, grant, finish, compare };
}

for (const opt of [0, 3] as const) {
	test(`Thread reservation, cleared backing, publication and charge match native in order at O${opt}`, () => {
		const f = fixture(opt), { cpu, memory, oracle } = f, management = cpu.heapAllocator.managementOffset();
		const control = management + HEAP_GC_CONTROL_OFFSET;
		const entry = f.same(cpu => cpu.rootThread.currentFrame!.closure);
		const oldHead = memory.readRamRecordWord(control + objectHead);
		const oldCount = memory.readRamRecordWord(control + objectCount);
		const charge = cpu.luaHeap.usedBytes();
		f.same(cpu => {
			const arena = cpu.heapAllocator;
			const extents = [[THREAD_HEAP_BYTES + GC_OBJECT_PREFIX, false], [valueBytes, true], [frameBytes, true]] as const;
			const addresses = extents.map(([bytes, owned]) => {
				const address = arena.allocate(bytes, owned);
				assert.notEqual(address, 0);
				cpu.memory.ramData().fill(dirty, address - RAM_BASE, address - RAM_BASE + bytes);
				return address;
			});
			for (let index = addresses.length - 1; index >= 0; --index) arena.free(addresses[index]);
		});
		const record = oracle.createThread(entry);
		const stack = oracle.memory.readRamRecordWord(record + ThreadField.StackBlock);
		const frames = oracle.memory.readRamRecordWord(record + ThreadField.FrameBlock);
		assert.equal(memory.readRamRecordByte(frames + frameBytes - 1), dirty);
		assert.equal(memory.readRamRecordByte(stack + valueBytes - 1), dirty);
		f.begin(management, entry);
		for (let i = 0; i < 16384 && memory.readRamRecordByte(frames + frameBytes - 1) !== 0; ++i) f.grant(1);
		assert.ok(cpu.heapServiceActive());
		assert.equal(memory.readRamRecordByte(frames + frameBytes - 1), 0);
		assert.equal(memory.readRamRecordByte(stack + valueBytes - 1), dirty, 'frame clear precedes value clear');
		assert.equal(memory.readRamRecordWord(record + ThreadField.Entry), entry);
		assert.equal(memory.readRamRecordWord(control + objectHead), oldHead);
		assert.equal(cpu.luaHeap.usedBytes(), charge);
		const checkpoint = captureCpuCheckpoint(cpu);
		for (let i = 0; i < 8192 && memory.readRamRecordWord(control + objectHead) !== record; ++i) f.grant(1);
		assert.ok(cpu.heapServiceActive());
		assert.equal(memory.readRamRecordByte(stack + valueBytes - 1), 0);
		assert.equal(memory.readRamRecordWord(control + objectHead), record);
		assert.equal(cpu.luaHeap.usedBytes(), charge, 'logical charge follows inventory publication');
		const beforeCharge = captureCpuCheckpoint(cpu);
		let paid = f.finish(record - RAM_BASE);
		assert.equal(memory.readRamRecordWord(control + objectCount), oldCount + 1);
		assert.equal(cpu.luaHeap.usedBytes(), charge + THREAD_HEAP_BYTES + valueBytes + frameBytes);
		restoreCpuCheckpoint(cpu, beforeCharge);
		assert.equal(f.finish(record - RAM_BASE), paid);
		restoreCpuCheckpoint(cpu, checkpoint);
		paid = f.finish(record - RAM_BASE);
		restoreCpuCheckpoint(cpu, checkpoint);
		assert.equal(f.finish(record - RAM_BASE), paid);
	});

	test(`failed Thread attempts free precisely the reserved prefixes without publication at O${opt}`, () => {
		const f = fixture(opt), owner = f.same(cpu => cpu.heapAllocator.allocate(3 * HEAP_PAGE_SIZE, true)) - RAM_BASE;
		const floor = (owner + 0x600 + HEAP_PAGE_SIZE - 1) & -HEAP_PAGE_SIZE;
		const state = owner + (f.cpu.heapAllocator.allocatorStateOffset() - f.cpu.heapAllocator.managementOffset());
		const charge = owner + HEAP_LOGICAL_OCCUPIED_OFFSET, control = owner + HEAP_GC_CONTROL_OFFSET;
		for (const [extent, canAllocateValues] of [[144, false], [200, true]] as const) {
			const arena = f.memory.bindDlmalloc(state), reference = f.oracle.memory.bindDlmalloc(state);
			f.same(cpu => {
				cpu.memory.ramData().fill(dirty, floor, floor + extent);
				cpu.memory.bindDlmalloc(state).reset(floor, floor + extent);
				cpu.memory.writeRamRecordWord(charge, 123);
			});
			const base = reference.allocate(THREAD_HEAP_BYTES + GC_OBJECT_PREFIX, 1);
			assert.notEqual(base, 0);
			const allocatedRecord = reference.occupiedBytes();
			const values = reference.allocate(valueBytes, 0);
			assert.equal(values !== 0, canAllocateValues);
			const allocatedBoth = reference.occupiedBytes();
			if (canAllocateValues) {
				assert.equal(reference.allocate(frameBytes, 0), 0);
				reference.free(values);
			}
			reference.free(base);
			assert.equal(reference.occupiedBytes(), 0);
			const run = () => {
				const trail: number[] = [0];
				for (let i = 0; i < 16384 && f.cpu.heapServiceActive(); ++i) {
					f.grant(1);
					const chunk = arena.occupiedBytes();
					if (trail.at(-1) !== chunk) trail.push(chunk);
					assert.equal(f.memory.readRamRecordWord(charge), 123);
					assert.equal(f.memory.readRamRecordWord(control + objectHead), 0);
					assert.equal(f.memory.readRamRecordWord(control + objectCount), 0);
				}
				f.finish(0);
				assert.deepEqual(trail, canAllocateValues ? [0, allocatedRecord, allocatedBoth, allocatedRecord, 0] : [0, allocatedRecord, 0]);
			};
			f.begin(owner, 0);
			const beginning = captureCpuCheckpoint(f.cpu);
			run();
			restoreCpuCheckpoint(f.cpu, beginning);
			run();
		}
	});
}

const detachedEntrySource = `
local entry = function() return 17 end
detached_entry = entry
entry = nil
halt_until_irq
`;

function detachEntry(f: ReturnType<typeof fixture>): number {
	return f.same(cpu => {
		const key = cpu.stringPool.intern('detached_entry'), operand = cpu.getGlobalByKey(key);
		assert.equal(valueTag(operand), ValueTag.Closure);
		cpu.setGlobalByKey(key, valueNil());
		// O3 can retain a now-dead physical temporary. Explicitly remove it
		// to prove the scope, independently of the compiler's slot lifetime.
		const slots = cpu.rootThread.currentFrame!.registers;
		for (let index = 0; index < slots.capacity(); ++index)
			if (slots.get(index) === operand) slots.set(index, valueNil());
		return valuePayload(operand);
	});
}

for (const opt of [0, 3] as const) {
	test(`Coroutine keeps its detached Closure alive through a real failed reservation at O${opt}`, () => {
		const f = fixture(opt, detachedEntrySource);
		const { cpu, oracle, memory } = f, arena = cpu.heapAllocator;
		const management = arena.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
		const entry = detachEntry(f);
		const victim = f.same(cpu => cpu.createTable(256, 0));
		f.same(cpu => {
			const arena = cpu.heapAllocator;
			cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
			while (arena.allocate(HEAP_PAGE_SIZE - 8, true)) {}
			while (arena.allocate(16, true)) {}
		});
		const before = arena.occupiedBytes(), beforeLogical = cpu.luaHeap.usedBytes(), oldWhite = cpu.gc.white();
		assert.equal(memory.readRamRecordByte(entry + GC_COLOR_OFFSET), oldWhite);
		const seed = captureCpuCheckpoint(oracle);
		oracle.gc.collect();
		assert.equal(oracle.gc.closureRecordAddress(entry), 0, 'no ordinary published root owns the operand');
		restoreCpuCheckpoint(oracle, seed);
		oracle['runKind'] = CpuRunKind.Direct;
		oracle.instructionBudgetRemaining = 0;
		const record = oracle.createThread(entry);
		oracle['runKind'] = CpuRunKind.Idle;
		assert.notEqual(record, 0);
		assert.equal(oracle.gc.tableRecordAddress(victim), 0);
		f.beginWhole(management, entry, 0);
		for (let i = 0; i < 8192 && memory.readRamRecordByte(entry + GC_COLOR_OFFSET) === oldWhite; ++i) f.grant(1);
		assert.equal(cpu.heapServiceActive(), true);
		assert.equal(memory.readRamRecordByte(entry + GC_COLOR_OFFSET), 2, 'the scoped Closure has actually enqueued');
		assert.equal(arena.occupiedBytes(), before, 'first refusal retired every provisional extent before starting recovery');
		assert.equal(cpu.luaHeap.usedBytes(), beforeLogical);
		const checkpoint = captureCpuCheckpoint(cpu);
		function drain() {
			let cycles = 0;
			for (let i = 0; i < 256 && cpu.heapServiceActive(); ++i) cycles += f.grant(4096);
			assert.equal(cpu.heapServiceActive(), false);
			assert.equal(cpu.readLuaFaultReasonWord(), 0);
			assert.equal(cpu.heapServiceResult(), 0);
			assert.equal(cpu.gc.white(), oldWhite ^ 1);
			assert.equal(cpu.gc.tableRecordAddress(victim), 0);
			assert.equal(cpu.gc.closureRecordAddress(entry), entry);
			assert.equal(memory.readRamRecordWord(control + objectHead), record);
			assert.equal(memory.readRamRecordWord(record + ThreadField.Entry), entry);
			// Native work does not materialize the private BIOS root/frontier scratch.
			f.compare(HEAP_SERVICE_ROOT_BANKS_OFFSET);
			return cycles;
		}
		const cycles = drain();
		restoreCpuCheckpoint(cpu, checkpoint);
		assert.equal(drain(), cycles);
	});

	test(`Coroutine logical assist spends the source allowance before reserving any backing at O${opt}`, () => {
		const f = fixture(opt, detachedEntrySource);
		const { cpu, oracle, memory } = f, arena = cpu.heapAllocator;
		const management = arena.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
		const entry = detachEntry(f), sourceCycles = 21;
		f.same(cpu => cpu.luaHeap.setCollectionTarget(cpu.luaHeap.usedBytes()));
		const target = cpu.luaHeap.collectionTarget(), occupied = arena.occupiedBytes(), work = cpu.gc.epochWork();
		const head = memory.readRamRecordWord(control + objectHead);
		oracle['runKind'] = CpuRunKind.Direct;
		oracle.instructionBudgetRemaining = sourceCycles;
		const record = oracle.createThread(entry);
		oracle['runKind'] = CpuRunKind.Idle;
		assert.ok(oracle.gc.epochWork() > work, 'the old source granted a positive mark quantum');
		assert.ok(oracle.luaHeap.collectionTarget() > target);
		f.beginWhole(management, entry, sourceCycles);
		for (let i = 0; i < 8192 && cpu.luaHeap.collectionTarget() === target; ++i) f.grant(1);
		assert.equal(cpu.heapServiceActive(), true);
		assert.equal(arena.occupiedBytes(), occupied);
		assert.equal(memory.readRamRecordWord(control + objectHead), head);
		assert.equal(cpu.luaHeap.collectionTarget(), oracle.luaHeap.collectionTarget());
		assert.equal(cpu.gc.epochWork(), oracle.gc.epochWork());
		for (let i = 0; i < 128 && cpu.heapServiceActive(); ++i) f.grant(128);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.heapServiceResult(), 0);
		assert.equal(memory.readRamRecordWord(control + objectHead), record);
		f.compare(HEAP_SERVICE_ROOT_BANKS_OFFSET);
	});

	test(`Coroutine reports terminal physical OOM only after the permitted rooted epoch at O${opt}`, () => {
		const f = fixture(opt, detachedEntrySource);
		const { cpu, oracle, memory } = f, arena = cpu.heapAllocator;
		const management = arena.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
		const entry = detachEntry(f);
		f.same(cpu => {
			cpu.gc.collect(valueClosure(entry));
			cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
			while (cpu.heapAllocator.allocate(HEAP_PAGE_SIZE - 8, true)) {}
			while (cpu.heapAllocator.allocate(16, true)) {}
		});
		const before = arena.occupiedBytes(), count = memory.readRamRecordWord(control + objectCount);
		const white = cpu.gc.white();
		oracle['runKind'] = CpuRunKind.Direct;
		oracle.instructionBudgetRemaining = 0;
		assert.throws(() => oracle.createThread(entry), error => error === LUA_OUT_OF_MEMORY_SIGNAL);
		oracle['runKind'] = CpuRunKind.Idle;
		f.beginWhole(management, entry, 0);
		for (let i = 0; i < 256 && cpu.heapServiceActive(); ++i) f.grant(4096);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.heapServiceResult(), LUA_FAULT_REASON_OUT_OF_MEMORY + 1);
		assert.equal(cpu.gc.white(), white ^ 1, 'only one fresh epoch was permitted from Pause');
		assert.equal(cpu.gc.closureRecordAddress(entry), entry);
		assert.equal(arena.occupiedBytes(), before);
		assert.equal(memory.readRamRecordWord(control + objectCount), count);
		f.compare(HEAP_SERVICE_ROOT_BANKS_OFFSET);
	});
}

test('Thread creation maps and pins the original mutations and raw layout', () => {
	const basis = 'da65fb039c6daeee3f08f4cec4ff232c0fe8d550';
	assert.ok(source.includes(`-- Source basis: ${basis}.`));
	const files = {
		T: 'machine/ts/machine/cpu/lua_heap.ts', C: 'machine/cpp/machine/cpu/lua_heap.cpp',
		I: 'machine/ts/machine/cpu/thread_record.ts', J: 'machine/cpp/machine/cpu/thread_record.cpp',
		H: 'machine/cpp/machine/cpu/thread_record.h', Y: 'machine/cpp/machine/cpu/gc_heap.h',
		A: 'machine/ts/machine/cpu/heap_allocator.ts', B: 'machine/cpp/machine/cpu/heap_allocator.cpp',
		U: 'machine/ts/machine/cpu/gc_heap.ts', V: 'machine/cpp/machine/cpu/gc_heap.cpp',
		F: 'machine/ts/machine/cpu/call_state.ts', G: 'machine/cpp/machine/cpu/call_state.h',
		P: 'machine/ts/machine/cpu/gc_object.ts', Q: 'machine/cpp/machine/cpu/gc_object.h',
		S: 'machine/cpp/machine/cpu/value_slots.h', M: 'machine/ts/spec/bmsx/memory_map.ts',
		D: 'machine/ts/spec/blua32/cop0.ts', E: 'machine/ts/machine/cpu/value.ts', W: 'machine/cpp/machine/cpu/value.h',
		X: 'machine/ts/machine/cpu/cpu.ts', Y: 'machine/cpp/machine/cpu/cpu_heap_service.inl', Z: 'machine/cpp/machine/cpu/cpu.cpp',
	};
	const refs = new Map(Object.entries(files).map(([label, path]) => [label, {
		lines: execFileSync('git', ['show', `${'DEWXYZ'.includes(label) ? '08c4a76d41e49d689c13a47fed3de37cece84072' : basis}:${path}`], { encoding: 'utf8' }).split('\n'), covered: new Set<number>(),
	}]));
	for (const [i, line] of source.split('\n').entries()) {
		if (/^\s*(?:$|--|module<const>$|struct \w+$|end$|return \{)/.test(line)) continue;
		const origin = /\s--\s+((?:[A-Z]:[0-9,-]+\s*)+)(?:;.*)?$/.exec(line);
		assert.ok(origin, `${port}:${i + 1} is unmapped`);
		for (const span of origin[1].trim().split(/\s+/)) {
			const [label, ranges] = span.split(':'), ref = refs.get(label);
			assert.ok(ref, span);
			for (const range of ranges.split(',')) {
				const [start, end = start] = range.split('-').map(Number);
				assert.ok(start > 0 && end >= start && end <= ref.lines.length, span);
				for (let row = start; row <= end; ++row) ref.covered.add(row);
			}
		}
	}
	for (const [label, start, end] of [['T', 177, 195], ['C', 189, 205], ['I', 100, 116], ['J', 72, 88]] as const) {
		const ref = refs.get(label)!;
		for (let row = start; row <= end; ++row) {
			if (/^\s*(?:$|\/\/|[{}]$)/.test(ref.lines[row - 1])) continue;
			assert.ok(ref.covered.has(row), `${label}:${row} ${ref.lines[row - 1]}`);
		}
	}
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture([port]));
	const { chunk } = workspace.updateFile(port, source);
	const types = new StructTypes(workspace.getSnapshot(), { value: () => undefined, storage: () => undefined });
	const layout = types.resolve(port, { name: 'new_thread_record', arrayLengths: [], span: chunk.body.get(0).span }).struct!;
	assert.equal(layout.size, THREAD_HEAP_BYTES);
	for (const [field, offset] of [
		['header', ThreadField.Header], ['entry', ThreadField.Entry], ['stack_block', ThreadField.StackBlock], ['stack_capacity', ThreadField.StackCapacity],
		['frame_block', ThreadField.FrameBlock], ['frame_capacity', ThreadField.FrameCapacity], ['protected_block', ThreadField.ProtectedBlock],
	] as const) assert.equal(layout.fields.get(field)!.offset, offset);
});
