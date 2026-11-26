import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { initializeRecord as initializeClosure } from '../../machine/ts/machine/cpu/closure';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_COLOR_MASK, GC_COLOR_OFFSET, GC_OBJECT_LINK_BEFORE, GC_OBJECT_PREFIX } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET, HEAP_LOGICAL_OCCUPIED_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { TableHeader, TableRecords } from '../../machine/ts/machine/cpu/table';
import { initialize as initializeCell, UPVALUE_HEAP_BYTES } from '../../machine/ts/machine/cpu/upvalue';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import {
	HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_OBJECT_SWEEP_OFFSET, HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_VALUE_COUNT,
	HeapServiceObjectSweepField as Sweep,
} from '../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';

const OBJECT_HEAD = 0x6c, OBJECT_COUNT = 0x70, SWEEP_LINK = 0x74;
const OBJECTS = 'kernel/gc_objects';
const entrySource = 'halt_until_irq';
const modules = ['kernel/dlmalloc', 'kernel/dlmalloc_record', 'kernel/gc_control', OBJECTS].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});

function fixture(optLevel: 0 | 3) {
	const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const object = encodeCompiledProgramObject(compiled), linked = linkTestSystemBlua32(compiled);
	const exported = object.sections.rodata.moduleExports.find(entry => entry.path === OBJECTS && entry.exportPathKey === 'sweep_objects');
	assert.ok(exported);
	const entry = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[exported.slotName]);
	assert.ok(entry >= 0);
	const { valueSlots, frames } = deriveBlua32FixedStack(linked.image, [entry]);
	assert.ok(valueSlots <= HEAP_SERVICE_VALUE_COUNT && frames <= HEAP_SERVICE_FRAME_COUNT);
	const { cpu, memory } = createTestSystemCpu(linked), oracle = createTestSystemCpu(linked).cpu;
	assert.equal(cpu.runUntilDepth(0, 1024), RunResult.Halted);
	assert.equal(oracle.runUntilDepth(0, 1024), RunResult.Halted);
	const management = cpu.heapAllocator.managementOffset();
	const control = management + HEAP_GC_CONTROL_OFFSET, occupied = management + HEAP_LOGICAL_OCCUPIED_OFFSET;
	const context = management + HEAP_SERVICE_OBJECT_SWEEP_OFFSET;
	const arena = cpu.heapAllocator.allocatorStateOffset();
	const floor = memory.ramBusEnd() - RAM_BASE, end = management + HEAP_SERVICE_THREAD_OFFSET;
	const parts = [[floor, context], [context + Sweep.Allowance + 4, end]] as const;
	function compare() {
		for (const [first, last] of parts) {
			const actual = memory.ramData().subarray(first, last), expected = oracle.memory.ramData().subarray(first, last);
			if (Buffer.compare(actual, expected) === 0) continue;
			const offset = actual.findIndex((byte, index) => byte !== expected[index]);
			assert.equal(actual[offset], expected[offset], `private arena byte 0x${(first + offset).toString(16)}`);
		}
	}
	function allocate(create: (target: CPU) => number): number {
		const address = create(cpu);
		assert.ok(address !== 0);
		assert.equal(create(oracle), address);
		return address;
	}
	function cell() {
		return allocate(target => {
			const address = target.luaHeap.allocateRecord(UPVALUE_HEAP_BYTES, true, 0, 0);
			initializeCell(target.memory, address, target.gc.white());
			target.gc.publishObject(address);
			return address;
		});
	}
	function color(address: number, byte: number) {
		for (const mem of [memory, oracle.memory]) mem.writeRamRecordByte(address + GC_COLOR_OFFSET, byte);
	}
	function setCursor(link: number) {
		for (const mem of [memory, oracle.memory]) mem.writeRamRecordWord(control + SWEEP_LINK, link);
	}
	function contextWord(field: Sweep): number { return memory.readRamRecordWord(context + field); }
	function resume(growing = 0, compact = 0, hashFirst = 0, observer = 0) {
		assert.ok(cpu.beginHeapService(linked.image.functions[entry].address,
			[control, arena, occupied, context, growing, compact, hashFirst, observer]));
	}
	function begin(allowance: number, growing = 0, compact = 0, hashFirst = 0, observer = 0) {
		memory.writeRamRecordWord(context + Sweep.Link, memory.readRamRecordWord(control + SWEEP_LINK));
		memory.writeRamRecordWord(context + Sweep.Work, 0);
		memory.writeRamRecordWord(context + Sweep.Removed, 0);
		memory.writeRamRecordWord(context + Sweep.Deferred, 0);
		memory.writeRamRecordWord(context + Sweep.Allowance, allowance);
		resume(growing, compact, hashFirst, observer);
	}
	function handleDeferred(growing: number, compact: boolean) {
		const address = contextWord(Sweep.Deferred), link = contextWord(Sweep.Link);
		assert.notEqual(address, 0);
		assert.equal(memory.readRamRecordWord(link), address, 'deferred record is still linked');
		const nextLink = address - GC_OBJECT_LINK_BEFORE;
		const header = memory.readRamRecordWord(address), white = cpu.gc.white();
		const garbage = ((header >>> (8 * GC_COLOR_OFFSET)) & GC_COLOR_MASK) === (white ^ 1);
		// Only the existing native record operation runs here; this does not
		// call or commit another collector quantum.
		if (garbage) memory.writeRamRecordWord(link, memory.readRamRecordWord(nextLink));
		const work = cpu.gc['sweepRecord'](address, header, garbage, white, growing, compact);
		memory.writeRamRecordWord(context + Sweep.Link, garbage ? link : nextLink);
		memory.writeRamRecordWord(context + Sweep.Work, contextWord(Sweep.Work) + work);
		memory.writeRamRecordWord(context + Sweep.Removed, contextWord(Sweep.Removed) + +garbage);
	}
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		assert.ok(cpu.instructionBudgetRemaining < cycles, 'retired a BIOS instruction');
	}
	function finish() {
		for (let i = 0; i < 1024 && cpu.heapServiceActive(); ++i) grant(512);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		return cpu.heapServiceResult();
	}
	function step(allowance: number, growing = 0, compact = false) {
		begin(allowance, growing, +compact);
		assert.equal(finish(), oracle.gc['sweepObjects'](allowance, growing, compact));
		assert.equal(contextWord(Sweep.Deferred), 0);
		compare();
	}
	compare();
	return { cpu, oracle, memory, control, occupied, allocate, cell, color, setCursor, compare,
		begin, grant, finish, step, contextWord, resume, handleDeferred };
}

for (const optLevel of [0, 3] as const) {
	test(`BLua object sweep matches the TS cursor and backs Table/Upvalue reclamation at O${optLevel}`, () => {
		const { cpu, oracle, memory, control, occupied, allocate, cell, color, setCursor, compare, begin, grant, finish, step } = fixture(optLevel);
		step(7); // inactive native link: no GC writes
		const keep = allocate(target => target.createTable(2, 0));
		const retire = [[0, 0], [0, 8], [4, 0]].map(([array, hash]) => allocate(target => target.createTable(array, hash)));
		retire.push(cell());
		const table = allocate(target => target.createTable(3, 8));
		retire.push(table);
		const white = cpu.gc.white(), oldWhite = white ^ 1;
		for (const address of retire) color(address, 0xa0 | oldWhite);
		color(keep, 0xfe);
		setCursor(control + OBJECT_HEAD);
		step(0);
		const inventory = memory.readRamRecordWord(control + OBJECT_COUNT);
		const charged = memory.readRamRecordWord(occupied);
		const backing = memory.readRamRecordWord(table + TableHeader.ArrayStorage);
		const backingBytes = cpu.heapAllocator.allocationBytes(backing);

		begin(1);
		for (let i = 0; i < 256 && memory.readRamRecordWord(control + OBJECT_HEAD) === table; ++i) grant(1);
		assert.equal(memory.readRamRecordWord(control + OBJECT_HEAD), retire[3], 'dead Table is unlinked first');
		assert.equal(memory.readRamRecordWord(control + OBJECT_COUNT), inventory, 'the removed count is local to the service');
		assert.equal(memory.readRamRecordWord(occupied), charged);
		assert.equal(cpu.heapAllocator.allocationBytes(backing), backingBytes, 'the first backing is still allocated');
		assert.ok(cpu.heapServiceActive());
		const partial = captureCpuCheckpoint(cpu);
		for (let i = 0; i < 4096 && memory.readRamRecordWord(occupied) === charged; ++i) grant(1);
		assert.equal(memory.readRamRecordWord(occupied), charged - 3 * 5, 'TS retires array before hash');
		const work = oracle.gc['sweepObjects'](1, 0, false);
		assert.equal(finish(), work);
		compare();
		restoreCpuCheckpoint(cpu, partial);
		assert.equal(finish(), work);
		compare();
		assert.equal(memory.readRamRecordWord(occupied), charged - TableRecords.HEADER_CHARGE - 3 * 5 - 8 * 10);
		assert.equal(memory.readRamRecordWord(control + SWEEP_LINK), control + OBJECT_HEAD);

		step(2);
		step(16);
		assert.equal(memory.readRamRecordWord(control + OBJECT_COUNT), inventory - retire.length);
		assert.equal(memory.readRamRecordWord(control + SWEEP_LINK), 0);
		assert.equal(memory.readRamRecordByte(keep + GC_COLOR_OFFSET), white, 'survivors receive the full current-white byte');
		for (const address of retire) assert.equal(cpu.heapAllocator.issuedObjectStart(address - RAM_BASE - GC_OBJECT_PREFIX), false);
	});

	test(`BLua preserves the C++ hash-first Table release quantum at O${optLevel}`, () => {
		const { oracle, memory, control, occupied, allocate, color, setCursor, compare, begin, grant, finish } = fixture(optLevel);
		const table = allocate(target => target.createTable(3, 8));
		color(table, oracle.gc.white() ^ 1);
		setCursor(control + OBJECT_HEAD);
		const count = memory.readRamRecordWord(control + OBJECT_COUNT), charged = memory.readRamRecordWord(occupied);
		const next = memory.readRamRecordWord(table - GC_OBJECT_LINK_BEFORE);
		begin(1, 0, 0, 1);
		for (let i = 0; i < 4096 && memory.readRamRecordWord(occupied) === charged; ++i) grant(1);
		assert.equal(memory.readRamRecordWord(occupied), charged - 8 * 10, 'C++ retires hash before array');
		assert.equal(memory.readRamRecordWord(control + OBJECT_COUNT), count, 'retirement has not published the new count');

		// Execute the pinned C++ order with the common physical allocator.
		const ref = oracle.memory;
		ref.writeRamRecordWord(control + OBJECT_HEAD, next);
		oracle.luaHeap.releaseRecord(ref.readRamRecordWord(table + TableHeader.HashStorage), 8 * 10);
		oracle.luaHeap.releaseRecord(ref.readRamRecordWord(table + TableHeader.ArrayStorage), 3 * 5);
		oracle.luaHeap.releaseObject(table, TableRecords.HEADER_CHARGE);
		ref.writeRamRecordWord(control + OBJECT_COUNT, count - 1);
		ref.writeRamRecordWord(control + SWEEP_LINK, control + OBJECT_HEAD);
		assert.equal(finish(), 1);
		compare();
	});

	test(`BLua retains one native sweep quantum across observer, Thread and Closure handoffs at O${optLevel}`, () => {
		const { cpu, oracle, memory, control, occupied, allocate, cell, color, setCursor, compare,
			begin, grant, finish, contextWord, resume, handleDeferred } = fixture(optLevel);
		const deadThread = allocate(target => target.createThread(0));
		const deadClosure = allocate(target => {
			let existing = 0;
			target.gc.visitObjectRecords(null, (_, record) => {
				if (target.memory.readRamRecordByte(record) === ValueTag.Closure) existing = record;
			});
			assert.ok(existing !== 0, 'firmware entry owns a real Closure prototype');
			const address = target.luaHeap.allocateClosureRecord(0);
			initializeClosure(target.memory, address, target.captureClosureBinding(existing), false, target.gc.white(), 0);
			target.gc.publishObject(address);
			return address;
		});
		const liveThread = allocate(target => target.createThread(0));
		const table = allocate(target => target.createTable(4, 2));
		const deadCell = cell();
		const white = oracle.gc.white();
		for (const address of [deadThread, deadClosure, table, deadCell]) color(address, white ^ 1);
		color(liveThread, 3);
		const published = control + OBJECT_HEAD;
		setCursor(published);
		const inventory = memory.readRamRecordWord(control + OBJECT_COUNT);
		const charged = memory.readRamRecordWord(occupied);
		// Compaction preserves the currently growing root Thread. The other
		// live Thread must defer, even though its color can be assigned in RAM.
		const growing = cpu.rootThread.address, allowance = 4096;
		assert.equal(oracle.rootThread.address, growing);
		const observed: number[][] = [], refObserved: number[][] = [];
		for (const [target, trace] of [[cpu, observed], [oracle, refObserved]] as const) {
			target.gc.onRecordRetirement = address => {
				if (address === null) return;
				const mem = target.memory;
				trace.push([address, mem.readRamRecordWord(control + OBJECT_COUNT),
					mem.readRamRecordWord(control + SWEEP_LINK), mem.readRamRecordWord(occupied)]);
			};
		}
		const expectedWork = oracle.gc['sweepObjects'](allowance, growing, true);
		assert.deepEqual(refObserved.map(([address]) => address), [table, deadClosure, deadThread]);
		begin(allowance, growing, 1, 0, 1);
		assert.equal(finish(), 1, 'one Upvalue precedes the host-only Table');
		assert.equal(memory.readRamRecordWord(published), table);
		assert.equal(contextWord(Sweep.Deferred), table);
		assert.equal(contextWord(Sweep.Work), 1);
		assert.equal(contextWord(Sweep.Removed), 1);
		assert.equal(memory.readRamRecordWord(occupied), charged - UPVALUE_HEAP_BYTES);
		assert.deepEqual(observed, []);
		const partial = captureCpuCheckpoint(cpu);

		function finishWholeQuantum() {
			let work = contextWord(Sweep.Work);
			for (const address of [table, liveThread, deadClosure, deadThread]) {
				assert.equal(contextWord(Sweep.Deferred), address);
				assert.equal(memory.readRamRecordWord(contextWord(Sweep.Link)), address);
				assert.equal(memory.readRamRecordWord(control + OBJECT_COUNT), inventory, 'no prefix commits between owners');
				assert.equal(memory.readRamRecordWord(control + SWEEP_LINK), published, 'only the saved link advances between owners');
				if (address === liveThread) assert.equal(memory.readRamRecordByte(address + GC_COLOR_OFFSET), 3);
				if (address === deadClosure) assert.equal(contextWord(Sweep.Link), liveThread - GC_OBJECT_LINK_BEFORE);
				handleDeferred(growing, true);
				resume(growing, 1, 0, 1);
			if (address === deadThread) {
				for (let i = 0; i < 2048 && memory.readRamRecordWord(control + OBJECT_COUNT) === inventory; ++i) grant(1);
				assert.equal(memory.readRamRecordWord(control + OBJECT_COUNT), inventory - 4);
				assert.equal(memory.readRamRecordWord(control + SWEEP_LINK), published, 'commit the count before the cursor');
			}
				const cumulative = finish();
				assert.ok(cumulative > work, 'the next entry retains the native owner work');
				work = cumulative;
			}
			assert.equal(work, expectedWork);
			assert.equal(contextWord(Sweep.Deferred), 0);
			assert.equal(memory.readRamRecordWord(control + OBJECT_COUNT), inventory - 4);
			assert.equal(memory.readRamRecordWord(control + SWEEP_LINK), 0);
			assert.equal(memory.readRamRecordByte(liveThread + GC_COLOR_OFFSET), white);
			assert.deepEqual(observed, refObserved, 'observers see the same unpublished cursor/count and logical-byte sequence');
			compare();
		}
		finishWholeQuantum();
		observed.length = 0;
		restoreCpuCheckpoint(cpu, partial);
		finishWholeQuantum();
	});
}
