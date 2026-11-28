import { initialize as initializeCell } from '../helpers/native_heap/upvalue_record';
import { initializeRecord as initializeClosure } from '../helpers/native_heap/closure_record';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import { allocateClosureRecordReference } from '../helpers/captured_closure_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FRAME_CONTROL_BYTES } from '../../machine/ts/machine/cpu/call_state';
import { closureRecordBytes } from '../../machine/ts/machine/cpu/closure';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_COLOR_OFFSET, GC_OBJECT_LINK_BEFORE, GC_OBJECT_PREFIX } from '../../toolchain/ts/firmware/stock_object_layout';
import { TableHeader, TableRecords } from '../../machine/ts/machine/cpu/table';
import { THREAD_CONTROL_COUNT_MASK, THREAD_HEAP_BYTES, THREAD_STACK_SLOT_BYTES, ThreadField, ThreadStatus } from '../../machine/ts/machine/cpu/thread_record';
import { UPVALUE_HEAP_BYTES } from '../../machine/ts/machine/cpu/upvalue';
import { ValueTag, valueInteger, valueNil, valueThread } from '../../machine/ts/machine/cpu/value';
import { CPU_FIXED_FRAME_COUNT, CPU_FIXED_VALUE_COUNT, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_WORKSPACE_END, HEAP_GC_CONTROL_OFFSET, HEAP_LOGICAL_OCCUPIED_OFFSET } from '../helpers/firmware_heap_layout';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { createTestSystemCpu, writeTestBlua32Rom } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { linkManagedTestSystem } from '../helpers/managed_system';
import { allocateThreadRecordReference, reserveThreadStorageReference } from '../helpers/thread_allocation_reference';

const OBJECT_HEAD = 0x6c, OBJECT_COUNT = 0x70, SWEEP_LINK = 0x74;
const OBJECTS = 'kernel/gc_objects';
const entrySource = `collector_probe = function() end
halt_until_irq`;

function fixture(optLevel: 0 | 3) {
	const linked = linkManagedTestSystem(entrySource, optLevel);
	const { object } = linked;
	const exported = object.sections.rodata.moduleExports.find(entry => entry.path === OBJECTS && entry.exportPathKey === 'sweep_objects');
	assert.ok(exported);
	const entry = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[exported.slotName]);
	assert.ok(entry >= 0);
	const { valueSlots, frames } = deriveBlua32FixedStack(linked.layout, [entry]);
	assert.ok(valueSlots <= CPU_FIXED_VALUE_COUNT && frames <= CPU_FIXED_FRAME_COUNT);
	const rom = { romBytes: writeTestBlua32Rom(linked) };
	const { cpu, memory } = createTestSystemCpu(rom), oracle = createTestSystemCpu(rom).cpu;
	runGuestToHalt(cpu, 1_000_000);
	runGuestToHalt(oracle, 1_000_000);
	const management = nativeHeapReference(cpu).heapAllocator.managementOffset();
	const control = management + HEAP_GC_CONTROL_OFFSET, occupied = management + HEAP_LOGICAL_OCCUPIED_OFFSET;
	const arena = nativeHeapReference(cpu).heapAllocator.allocatorStateOffset();
	const floor = memory.ramBusEnd() - RAM_BASE, end = management + GC_WORKSPACE_END;
	function compare() {
		const actual = memory.ramData().subarray(floor, end), expected = oracle.memory.ramData().subarray(floor, end);
		if (Buffer.compare(actual, expected) === 0) return;
		const offset = actual.findIndex((byte, index) => byte !== expected[index]);
		assert.equal(actual[offset], expected[offset], `private arena byte 0x${(floor + offset).toString(16)}`);
	}
	function allocate(create: (target: CPU) => number): number {
		const address = create(cpu);
		assert.ok(address !== 0);
		assert.equal(create(oracle), address);
		return address;
	}
	function cell() {
		return allocate(target => {
			const address = nativeHeapReference(target).luaHeap.allocateRecord(UPVALUE_HEAP_BYTES, true, 0, 0);
			initializeCell(target.memory, address, nativeHeapReference(target).gc.white());
			nativeHeapReference(target).gc.publishObject(address);
			return address;
		});
	}
	function color(address: number, byte: number) {
		for (const mem of [memory, oracle.memory]) mem.writeRamRecordByte(address + GC_COLOR_OFFSET, byte);
	}
	function setCursor(link: number) {
		for (const mem of [memory, oracle.memory]) mem.writeRamRecordWord(control + SWEEP_LINK, link);
	}
	function begin(allowance: number, growing = 0, compact = 0, hashFirst = 0) {
		assert.ok(cpu.beginHeapService(linked.layout.functions[entry].address,
			[control, arena, occupied, growing, compact, hashFirst, allowance]));
	}
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		assert.ok(cpu.instructionBudgetRemaining < cycles, 'retired a BIOS instruction');
	}
	function finish() {
		for (let i = 0; i < 1024 && cpu.heapServiceActive(); ++i) grant(512);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		return cpu.heapServiceResult();
	}
	function step(allowance: number, growing = 0, compact = false) {
		begin(allowance, growing, +compact);
		assert.equal(finish(), nativeHeapReference(oracle).gc['sweepObjects'](allowance, growing, compact));
		compare();
	}
	compare();
	return { cpu, oracle, memory, control, occupied, allocate, cell, color, setCursor, compare,
		begin, grant, finish, step };
}

for (const optLevel of [0, 3] as const) {
	test(`BLua object sweep matches the TS cursor and backs Table/Upvalue reclamation at O${optLevel}`, () => {
		const { cpu, oracle, memory, control, occupied, allocate, cell, color, setCursor, compare, begin, grant, finish, step } = fixture(optLevel);
		step(7); // inactive native link: no GC writes
		const keep = allocate(target => createReferenceTable(target, 2, 0));
		const retire = [[0, 0], [0, 8], [4, 0]].map(([array, hash]) => allocate(target => createReferenceTable(target, array, hash)));
		retire.push(cell());
		const table = allocate(target => createReferenceTable(target, 3, 8));
		retire.push(table);
		const white = nativeHeapReference(cpu).gc.white(), oldWhite = white ^ 1;
		for (const address of retire) color(address, 0xa0 | oldWhite);
		color(keep, 0xfe);
		setCursor(control + OBJECT_HEAD);
		step(0);
		const inventory = memory.readRamRecordWord(control + OBJECT_COUNT);
		const charged = memory.readRamRecordWord(occupied);
		const backing = memory.readRamRecordWord(table + TableHeader.ArrayStorage);
		const backingBytes = nativeHeapReference(cpu).heapAllocator.allocationBytes(backing);

		begin(1);
		for (let i = 0; i < 256 && memory.readRamRecordWord(control + OBJECT_HEAD) === table; ++i) grant(1);
		assert.equal(memory.readRamRecordWord(control + OBJECT_HEAD), retire[3], 'dead Table is unlinked first');
		assert.equal(memory.readRamRecordWord(control + OBJECT_COUNT), inventory, 'the removed count is local to the service');
		assert.equal(memory.readRamRecordWord(occupied), charged);
		assert.equal(nativeHeapReference(cpu).heapAllocator.allocationBytes(backing), backingBytes, 'the first backing is still allocated');
		assert.ok(cpu.heapServiceActive());
		const partial = captureCpuCheckpoint(cpu);
		for (let i = 0; i < 4096 && memory.readRamRecordWord(occupied) === charged; ++i) grant(1);
		assert.equal(memory.readRamRecordWord(occupied), charged - 3 * 5, 'TS retires array before hash');
		const work = nativeHeapReference(oracle).gc['sweepObjects'](1, 0, false);
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
		for (const address of retire) assert.equal(nativeHeapReference(cpu).heapAllocator.issuedObjectStart(address - RAM_BASE - GC_OBJECT_PREFIX), false);
	});

	test(`BLua preserves the C++ hash-first Table release quantum at O${optLevel}`, () => {
		const { oracle, memory, control, occupied, allocate, color, setCursor, compare, begin, grant, finish } = fixture(optLevel);
		const table = allocate(target => createReferenceTable(target, 3, 8));
		color(table, nativeHeapReference(oracle).gc.white() ^ 1);
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
		nativeHeapReference(oracle).luaHeap.releaseRecord(ref.readRamRecordWord(table + TableHeader.HashStorage), 8 * 10);
		nativeHeapReference(oracle).luaHeap.releaseRecord(ref.readRamRecordWord(table + TableHeader.ArrayStorage), 3 * 5);
		nativeHeapReference(oracle).luaHeap.releaseObject(table, TableRecords.HEADER_CHARGE);
		ref.writeRamRecordWord(control + OBJECT_COUNT, count - 1);
		ref.writeRamRecordWord(control + SWEEP_LINK, control + OBJECT_HEAD);
		assert.equal(finish(), 1);
		compare();
	});

	test(`BLua retires physical kinds and compacts inside one resumable quantum at O${optLevel}`, () => {
		const { cpu, oracle, memory, control, occupied, allocate, cell, color, setCursor, compare,
			begin, grant, finish } = fixture(optLevel);
		const deadThread = allocate(target => {
			const address = allocateThreadRecordReference(target, 0);
			const mem = target.memory;
			mem.writeRamRecordWord(address + ThreadField.FrameCapacity, mem.readRamRecordWord(address + ThreadField.FrameCapacity) | 0xa0000000);
			return address;
		});
		function closure(captures: number, latched: boolean, kind = ValueTag.Closure) {
			return allocate(target => {
				let existing = 0;
				nativeHeapReference(target).gc.visitObjectRecords(null, (_, record) => {
					if (target.memory.readRamRecordByte(record) === ValueTag.Closure) existing = record;
				});
				assert.ok(existing !== 0, 'firmware entry owns a real Closure prototype');
				const prototype = target.captureClosureBinding(existing);
				const address = allocateClosureRecordReference(target, captures, latched);
				initializeClosure(target.memory, address, prototype, false, nativeHeapReference(target).gc.white(), captures, latched);
				target.memory.writeRamRecordByte(address, kind);
				nativeHeapReference(target).gc.publishObject(address);
				return address;
			});
		}
		const fewerCaptures = closure(2, true);
		const opaque = closure(0x2001, false, ValueTag.DeadKey);
		const ordinary = closure(7, true);
		const unchangedThread = allocate(target => allocateThreadRecordReference(target, 0));
		const liveThread = allocate(target => {
			const address = allocateThreadRecordReference(target, 0);
			reserveThreadStorageReference(target, address, 32, 8, valueThread(address));
			return address;
		});
		const table = allocate(target => createReferenceTable(target, 4, 2));
		const deadCell = cell();
		const white = nativeHeapReference(oracle).gc.white();
		const dead = [deadThread, fewerCaptures, opaque, ordinary, table, deadCell];
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
			const mem = target.memory;
			for (const address of dead) mem.watchRamByte(address - RAM_BASE);
			mem.onRamWrite(offset => {
				if (mem.readRamRecordByte(offset) !== 0) return;
				const address = RAM_BASE + offset;
				if (!dead.includes(address) || trace.some(([seen]) => seen === address)) return;
				trace.push([address, mem.readRamRecordWord(control + OBJECT_COUNT),
					mem.readRamRecordWord(control + SWEEP_LINK), mem.readRamRecordWord(occupied),
					+nativeHeapReference(target).heapAllocator.issuedObjectStart(offset - GC_OBJECT_PREFIX)]);
			});
		}
		const valueCapacity = memory.readRamRecordWord(deadThread + ThreadField.StackCapacity);
		const frameCapacity = memory.readRamRecordWord(deadThread + ThreadField.FrameCapacity);
		const liveValueCapacity = memory.readRamRecordWord(liveThread + ThreadField.StackCapacity);
		const liveFrameCapacity = memory.readRamRecordWord(liveThread + ThreadField.FrameCapacity);
		const threadDebits = [valueCapacity * THREAD_STACK_SLOT_BYTES, (frameCapacity & THREAD_CONTROL_COUNT_MASK) * FRAME_CONTROL_BYTES,
			THREAD_HEAP_BYTES];
		const expectedWork = nativeHeapReference(oracle).gc['sweepObjects'](allowance, growing, true);
		assert.deepEqual(refObserved.map(([address, count, cursor, , issued]) => [address, count, cursor, issued]),
			[deadCell, table, ordinary, opaque, fewerCaptures, deadThread].map(address => [address, inventory, published, 1]));
		begin(allowance, growing, 1);
		for (let i = 0; i < 8192 && memory.readRamRecordByte(fewerCaptures) !== 0; ++i) grant(1);
		assert.ok(cpu.heapServiceActive());
		assert.equal(memory.readRamRecordByte(fewerCaptures), 0);
		assert.equal(nativeHeapReference(cpu).heapAllocator.issuedObjectStart(fewerCaptures - RAM_BASE - GC_OBJECT_PREFIX), true,
			'the kind byte is cleared before the allocator releases its chunk');
		assert.equal(memory.readRamRecordByte(liveThread + GC_COLOR_OFFSET), white);
		assert.equal(memory.readRamRecordWord(liveThread + ThreadField.StackCapacity), liveValueCapacity >>> 1);
		assert.equal(memory.readRamRecordWord(liveThread + ThreadField.FrameCapacity), liveFrameCapacity >>> 1);
		const partial = captureCpuCheckpoint(cpu);
		const prefix = observed.slice();

		function finishWholeQuantum() {
			// The Closure releases its own extent before the Thread's backing.
			for (let i = 0; i < 4096 && nativeHeapReference(cpu).heapAllocator.issuedObjectStart(fewerCaptures - RAM_BASE - GC_OBJECT_PREFIX); ++i) grant(1);
			let charge = memory.readRamRecordWord(occupied);
			// Wait for the logical debit of the just-cleared Closure.
			const closureCharge = prefix[prefix.length - 1][3] - closureRecordBytes(2, true);
			for (let i = 0; i < 4096 && charge !== closureCharge; ++i) {
				grant(1);
				charge = memory.readRamRecordWord(occupied);
			}
			assert.equal(charge, closureCharge);
			for (const bytes of threadDebits) {
				for (let i = 0; i < 4096 && memory.readRamRecordWord(occupied) === charge; ++i) grant(1);
				charge -= bytes;
				assert.equal(memory.readRamRecordWord(occupied), charge, 'release values, frames, protected controls, then Thread');
			}
			for (let i = 0; i < 2048 && memory.readRamRecordWord(control + OBJECT_COUNT) === inventory; ++i) grant(1);
			assert.equal(memory.readRamRecordWord(control + OBJECT_COUNT), inventory - dead.length);
			assert.equal(memory.readRamRecordWord(control + SWEEP_LINK), published, 'commit count before cursor');
			assert.equal(finish(), expectedWork);
			assert.equal(memory.readRamRecordWord(control + SWEEP_LINK), 0);
			assert.equal(memory.readRamRecordByte(liveThread + GC_COLOR_OFFSET), white);
			assert.equal(memory.readRamRecordWord(unchangedThread + ThreadField.StackCapacity), 8);
			assert.deepEqual(observed, refObserved, 'native and BIOS see the same ordered RAM retirement boundaries');
			compare();
		}
		finishWholeQuantum();
		observed.length = prefix.length;
		restoreCpuCheckpoint(cpu, partial);
		finishWholeQuantum();
	});

	test(`BLua finishes an oversized compaction's quantum without visiting its successor at O${optLevel}`, () => {
		const { cpu, oracle, memory, control, allocate, color, setCursor, compare,
			begin, finish } = fixture(optLevel);
		const successor = allocate(target => createReferenceTable(target, 0, 0));
		const thread = allocate(target => {
			const address = allocateThreadRecordReference(target, 0);
			reserveThreadStorageReference(target, address, 32, 8, valueThread(address));
			return address;
		});
		const growing = cpu.rootThread.address, published = control + OBJECT_HEAD;
		color(thread, 3);
		color(successor, 3);
		setCursor(published);
		const expected = nativeHeapReference(oracle).gc['sweepObjects'](1, growing, true);
		assert.ok(expected > 1);
		begin(1, growing, 1);
		assert.equal(finish(), expected, 'the complete traversal still charges the final record once');
		assert.equal(memory.readRamRecordWord(control + SWEEP_LINK), thread - GC_OBJECT_LINK_BEFORE);
		assert.equal(memory.readRamRecordByte(successor + GC_COLOR_OFFSET), 3);
		compare();
	});
	test(`a swept borrowed Thread address reattaches to the new lifetime at O${optLevel}`, () => {
		const { cpu, memory, oracle, control, allocate, color, setCursor, begin, finish } = fixture(optLevel);
		const dead = allocate(target => allocateThreadRecordReference(target, 0));
		const loan = cpu.bindThread(dead);
		const original = cpu.rootThread.currentFrame!, saved = loan.acquireFrame();
		saved.initializeControl(original.functionAddress, original.pc, 0, false, SYSTEM_EXECUTION_DOMAIN_ID,
			0, 0, 0, 0, 1, original.closure, 0, 8);
		loan.enterFrame(saved);
		loan.stackTop = 8;
		loan.status = ThreadStatus.Suspended;
		saved.registers.set(0, valueInteger(73));
		color(dead, nativeHeapReference(oracle).gc.white() ^ 1);
		setCursor(control + OBJECT_HEAD);
		begin(1);
		const checkpoint = captureCpuCheckpoint(cpu);
		function complete() {
			assert.equal(finish(), 1);
			assert.equal(nativeHeapReference(cpu).gc.threadRecordAddress(dead), 0);
			const fresh = allocateThreadRecordReference(cpu, 0);
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
