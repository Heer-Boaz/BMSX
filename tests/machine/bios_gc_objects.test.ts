import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FRAME_CONTROL_BYTES, PROTECTED_CALL_BYTES } from '../../machine/ts/machine/cpu/call_state';
import { closureRecordBytes, initializeRecord as initializeClosure } from '../../machine/ts/machine/cpu/closure';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_COLOR_OFFSET, GC_OBJECT_LINK_BEFORE, GC_OBJECT_PREFIX } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET, HEAP_LOGICAL_OCCUPIED_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { TableHeader, TableRecords } from '../../machine/ts/machine/cpu/table';
import { THREAD_CONTROL_COUNT_MASK, THREAD_HEAP_BYTES, THREAD_STACK_SLOT_BYTES, ThreadField, ThreadStatus } from '../../machine/ts/machine/cpu/thread_record';
import { initialize as initializeCell, UPVALUE_HEAP_BYTES } from '../../machine/ts/machine/cpu/upvalue';
import { ValueTag, valueInteger, valueNil, valueThread } from '../../machine/ts/machine/cpu/value';
import {
	HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_OBJECT_SWEEP_OFFSET, HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_VALUE_COUNT,
	HeapServiceObjectSweepAction as Action, HeapServiceObjectSweepField as Sweep,
} from '../../machine/ts/spec/bmsx/heap_service';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { compileTestSystemWithHeap } from '../helpers/heap_service_system';

const OBJECT_HEAD = 0x6c, OBJECT_COUNT = 0x70, SWEEP_LINK = 0x74;
const OBJECTS = 'kernel/gc_objects';
const entrySource = 'halt_until_irq';
const modules = ['kernel/dlmalloc', 'kernel/dlmalloc_record', 'kernel/gc_control', 'kernel/gc_thread_compact', OBJECTS].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});

function fixture(optLevel: 0 | 3) {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const object = encodeCompiledProgramObject(compiled), linked = linkTestSystemBlua32(compiled);
	const exported = object.sections.rodata.moduleExports.find(entry => entry.path === OBJECTS && entry.exportPathKey === 'sweep_objects');
	assert.ok(exported);
	const entry = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[exported.slotName]);
	assert.ok(entry >= 0);
	const { valueSlots, frames } = deriveBlua32FixedStack(linked.image, [entry]);
	assert.ok(valueSlots <= HEAP_SERVICE_VALUE_COUNT && frames <= HEAP_SERVICE_FRAME_COUNT);
	const { cpu, memory } = createTestSystemCpu(linked), oracle = createTestSystemCpu(linked).cpu;
	runGuestToHalt(cpu, 10_000);
	runGuestToHalt(oracle, 10_000);
	const management = cpu.heapAllocator.managementOffset();
	const control = management + HEAP_GC_CONTROL_OFFSET, occupied = management + HEAP_LOGICAL_OCCUPIED_OFFSET;
	const context = management + HEAP_SERVICE_OBJECT_SWEEP_OFFSET;
	const arena = cpu.heapAllocator.allocatorStateOffset();
	const floor = memory.ramBusEnd() - RAM_BASE, end = management + HEAP_SERVICE_THREAD_OFFSET;
	const parts = [[floor, context], [context + Sweep.Next + 4, end]] as const;
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
		memory.writeRamRecordWord(context + Sweep.Action, Action.None);
		resume(growing, compact, hashFirst, observer);
	}
	function handleDeferred(): void {
		const address = contextWord(Sweep.Deferred);
		assert.notEqual(address, 0);
		switch (contextWord(Sweep.Action)) {
			case Action.RetireCanonicalClosure: cpu.retireStaticClosure(address); return;
			case Action.ObserveRetiredRecord: cpu.gc.onRecordRetirement!(address); return;
		}
		assert.fail('expected a pending host action');
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
		assert.equal(contextWord(Sweep.Action), Action.None);
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

	test(`BLua keeps compaction, storage release and observer order inside one quantum at O${optLevel}`, () => {
		const { cpu, oracle, memory, control, occupied, allocate, cell, color, setCursor, compare,
			begin, grant, finish, contextWord, resume, handleDeferred } = fixture(optLevel);
		const deadThread = allocate(target => {
			const address = target.createThread(0);
			target.luaHeap.reserveThreadControls(address, ThreadField.ProtectedBlock, 4, 0, valueThread(address));
			const mem = target.memory;
			mem.writeRamRecordWord(address + ThreadField.FrameCapacity, mem.readRamRecordWord(address + ThreadField.FrameCapacity) | 0xa0000000);
			mem.writeRamRecordWord(address + ThreadField.ProtectedCapacity, mem.readRamRecordWord(address + ThreadField.ProtectedCapacity) | 0x80000000);
			return address;
		});
		function closure(captures: number, canonical: boolean, latched: boolean, kind = ValueTag.Closure) {
			return allocate(target => {
				let existing = 0;
				target.gc.visitObjectRecords(null, (_, record) => {
					if (target.memory.readRamRecordByte(record) === ValueTag.Closure) existing = record;
				});
				assert.ok(existing !== 0, 'firmware entry owns a real Closure prototype');
				const prototype = target.captureClosureBinding(existing);
				const address = target.luaHeap.allocateClosureRecord(captures, latched);
				initializeClosure(target.memory, address, prototype, canonical, target.gc.white(), captures, latched);
				target.memory.writeRamRecordByte(address, kind);
				target.gc.publishObject(address);
				if (canonical) target['staticClosures'].insert(prototype.functionAddress, address);
				return address;
			});
		}
		const canonical = closure(2, true, true);
		const opaque = closure(0x2001, false, false, ValueTag.DeadKey);
		const ordinary = closure(7, false, true);
		const unchangedThread = allocate(target => target.createThread(0));
		const liveThread = allocate(target => {
			const address = target.createThread(0);
			target.luaHeap.reserveThreadFrameStorage(address, 32, 8, valueThread(address));
			return address;
		});
		const table = allocate(target => target.createTable(4, 2));
		const deadCell = cell();
		const white = oracle.gc.white();
		const dead = [deadThread, canonical, opaque, ordinary, table, deadCell];
		for (const address of dead) color(address, white ^ 1);
		color(liveThread, 3);
		const published = control + OBJECT_HEAD;
		setCursor(published);
		const inventory = memory.readRamRecordWord(control + OBJECT_COUNT);
		const charged = memory.readRamRecordWord(occupied);
		// Compaction preserves the growing root, but shrinks the other live Thread.
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
		const valueCapacity = memory.readRamRecordWord(deadThread + ThreadField.StackCapacity);
		const frameCapacity = memory.readRamRecordWord(deadThread + ThreadField.FrameCapacity);
		const protectedCapacity = memory.readRamRecordWord(deadThread + ThreadField.ProtectedCapacity);
		const liveValueCapacity = memory.readRamRecordWord(liveThread + ThreadField.StackCapacity);
		const liveFrameCapacity = memory.readRamRecordWord(liveThread + ThreadField.FrameCapacity);
		const liveRetained = (liveValueCapacity >>> 1) * THREAD_STACK_SLOT_BYTES + (liveFrameCapacity >>> 1) * FRAME_CONTROL_BYTES;
		const threadDebits = [valueCapacity * THREAD_STACK_SLOT_BYTES, (frameCapacity & THREAD_CONTROL_COUNT_MASK) * FRAME_CONTROL_BYTES,
			(protectedCapacity & THREAD_CONTROL_COUNT_MASK) * PROTECTED_CALL_BYTES, THREAD_HEAP_BYTES];
		const expectedWork = oracle.gc['sweepObjects'](allowance, growing, true);
		assert.deepEqual(refObserved.map(([address]) => address), [table, ordinary, canonical, deadThread]);
		begin(allowance, growing, 1, 0, 1);
		assert.equal(finish(), 1, 'only the Upvalue is charged before the Table observer');
		assert.equal(memory.readRamRecordWord(published), liveThread, 'Table is already unlinked at its observer');
		assert.equal(contextWord(Sweep.Deferred), table);
		assert.equal(contextWord(Sweep.Action), Action.ObserveRetiredRecord);
		assert.equal(contextWord(Sweep.Removed), 2);
		assert.equal(memory.readRamRecordWord(occupied), charged - UPVALUE_HEAP_BYTES - TableRecords.HEADER_CHARGE - 4 * 5 - 2 * 10);
		assert.deepEqual(observed, []);
		const partial = captureCpuCheckpoint(cpu);

		function finishWholeQuantum() {
			let cumulative = 1;
			for (const [action, address] of [
				[Action.ObserveRetiredRecord, table],
				[Action.ObserveRetiredRecord, ordinary], [Action.RetireCanonicalClosure, canonical],
				[Action.ObserveRetiredRecord, canonical],
				[Action.ObserveRetiredRecord, deadThread],
			] as const) {
				assert.equal(contextWord(Sweep.Action), action);
				assert.equal(contextWord(Sweep.Deferred), address);
				assert.equal(contextWord(Sweep.Work), cumulative);
				const link = contextWord(Sweep.Link), next = contextWord(Sweep.Next);
				assert.equal(memory.readRamRecordWord(link), next, 'the link already leads to the next record');
				assert.equal(memory.readRamRecordWord(control + OBJECT_COUNT), inventory, 'no prefix commits between owners');
				assert.equal(memory.readRamRecordWord(control + SWEEP_LINK), published, 'only the saved link advances between owners');
				const issued = cpu.heapAllocator.issuedObjectStart(address - RAM_BASE - GC_OBJECT_PREFIX);
				assert.equal(issued, action !== Action.ObserveRetiredRecord, 'pre-release owner sees issued storage, observer sees retirement');
				if (address === ordinary) {
					assert.equal(memory.readRamRecordByte(liveThread + GC_COLOR_OFFSET), white, 'recolor before compaction');
					assert.equal(memory.readRamRecordWord(liveThread + ThreadField.StackCapacity), liveValueCapacity >>> 1);
					assert.equal(memory.readRamRecordWord(liveThread + ThreadField.FrameCapacity), liveFrameCapacity >>> 1);
					assert.equal(cumulative, 4 + 2 * ((liveRetained + 3) >> 2), 'retain and charge the same compaction without a host stop');
				}
				if (action === Action.RetireCanonicalClosure)
					assert.equal(contextWord(Sweep.Header), memory.readRamRecordWord(address));
				let charge = memory.readRamRecordWord(occupied);
				handleDeferred();
				assert.equal(contextWord(Sweep.Work), cumulative, 'host action cannot change logical GC work');
				assert.equal(memory.readRamRecordWord(occupied), charge, 'host action cannot release BIOS storage');
				resume(growing, 1, 0, 1);
				let partialRelease: ReturnType<typeof captureCpuCheckpoint> | null = null;
				if (action === Action.ObserveRetiredRecord && address === canonical) {
					for (const [i, bytes] of threadDebits.entries()) {
						for (let i = 0; i < 4096 && memory.readRamRecordWord(occupied) === charge; ++i) grant(1);
						charge -= bytes;
						assert.equal(memory.readRamRecordWord(occupied), charge, 'release values, frames, protected controls, then Thread');
						if (i === 0) partialRelease = captureCpuCheckpoint(cpu);
					}
				}
				if (action === Action.ObserveRetiredRecord && address === deadThread) {
					for (let i = 0; i < 2048 && memory.readRamRecordWord(control + OBJECT_COUNT) === inventory; ++i) grant(1);
					assert.equal(memory.readRamRecordWord(control + OBJECT_COUNT), inventory - dead.length);
					assert.equal(memory.readRamRecordWord(control + SWEEP_LINK), published, 'commit count before cursor');
				}
				cumulative = finish();
				if (partialRelease !== null) {
					restoreCpuCheckpoint(cpu, partialRelease);
					assert.equal(finish(), cumulative, 'resume inside BIOS storage release, not the host action');
					assert.equal(memory.readRamRecordWord(occupied), charge, 'rewind did not replay the first backing release');
				}
				if (action === Action.RetireCanonicalClosure) {
					assert.equal(memory.readRamRecordWord(occupied), charge - closureRecordBytes(2, true));
					assert.equal(contextWord(Sweep.Work), cumulative, 'post-release callback still precedes charging the Closure');
				}
			}
			assert.equal(cumulative, expectedWork);
			assert.equal(contextWord(Sweep.Deferred), 0);
			assert.equal(contextWord(Sweep.Action), Action.None);
			assert.equal(memory.readRamRecordWord(control + OBJECT_COUNT), inventory - dead.length);
			assert.equal(memory.readRamRecordWord(control + SWEEP_LINK), 0);
			assert.equal(memory.readRamRecordByte(liveThread + GC_COLOR_OFFSET), white);
			assert.equal(memory.readRamRecordWord(unchangedThread + ThreadField.StackCapacity), 8, 'cold Thread needs no rebind action');
			assert.deepEqual(observed, refObserved, 'observe the same unpublished cursor/count and logical-byte sequence');
			compare();
		}
		finishWholeQuantum();
		observed.length = 0;
		restoreCpuCheckpoint(cpu, partial);
		finishWholeQuantum();
	});

	test(`BLua finishes an oversized compaction's quantum without visiting its successor at O${optLevel}`, () => {
		const { cpu, oracle, memory, control, allocate, color, setCursor, compare,
			begin, finish, contextWord } = fixture(optLevel);
		const successor = allocate(target => target.createTable(0, 0));
		const thread = allocate(target => {
			const address = target.createThread(0);
			target.luaHeap.reserveThreadFrameStorage(address, 32, 8, valueThread(address));
			return address;
		});
		const growing = cpu.rootThread.address, published = control + OBJECT_HEAD;
		color(thread, 3);
		color(successor, 3);
		setCursor(published);
		const expected = oracle.gc['sweepObjects'](1, growing, true);
		assert.ok(expected > 1);
		begin(1, growing, 1);
		assert.equal(finish(), expected, 'the complete traversal still charges the final record once');
		assert.equal(contextWord(Sweep.Action), Action.None);
		assert.equal(memory.readRamRecordWord(control + SWEEP_LINK), thread - GC_OBJECT_LINK_BEFORE);
		assert.equal(memory.readRamRecordByte(successor + GC_COLOR_OFFSET), 3);
		compare();
	});
	test(`a swept borrowed Thread address reattaches to the new lifetime at O${optLevel}`, () => {
		const { cpu, memory, oracle, control, allocate, color, setCursor, begin, finish } = fixture(optLevel);
		const dead = allocate(target => target.createThread(0));
		const loan = cpu.bindThread(dead);
		const original = cpu.rootThread.currentFrame!, saved = loan.acquireFrame();
		saved.initializeControl(original.functionAddress, original.pc, 0, false, SYSTEM_EXECUTION_DOMAIN_ID,
			0, 0, 0, 0, 1, original.closure, 0, 8);
		loan.enterFrame(saved);
		loan.stackTop = 8;
		loan.status = ThreadStatus.Suspended;
		saved.registers.set(0, valueInteger(73));
		color(dead, oracle.gc.white() ^ 1);
		setCursor(control + OBJECT_HEAD);
		begin(1);
		const checkpoint = captureCpuCheckpoint(cpu);
		function complete() {
			assert.equal(finish(), 1);
			assert.equal(cpu.gc.threadRecordAddress(dead), 0);
			const fresh = cpu.createThread(0);
			assert.equal(fresh, dead, 'the allocator really reused the object address');
			const view = cpu.bindThread(fresh);
			assert.equal(view.frameDepth, 0);
			assert.equal(view.currentFrame, null, 'no stale ordinary frame belongs to this Thread');
			assert.equal(view.stackRegisters.get(0), valueNil(), 'the new record supplies its own Value plane');
			assert.equal(view.status, ThreadStatus.New);
			return memory.ramData().slice(fresh - RAM_BASE, fresh - RAM_BASE + THREAD_HEAP_BYTES);
		}
		const expected = complete();
		restoreCpuCheckpoint(cpu, checkpoint);
		assert.deepEqual(complete(), expected);
	});

}
