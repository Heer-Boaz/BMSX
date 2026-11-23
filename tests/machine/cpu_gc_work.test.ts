import { textToByteString } from '../../machine/ts/common/byte_string';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CpuExecutionBackend, COMPILED_BLOCK_THRESHOLD } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult, CPU } from '../../machine/ts/machine/cpu/cpu';
import { LUA_OUT_OF_MEMORY_SIGNAL } from '../../machine/ts/machine/cpu/errors';
import { GcDiagnostics } from '../../machine/ts/machine/cpu/gc_diagnostics';
import { GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_OBJECT_PREFIX } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_COLLECTION_TARGET_OFFSET, heapAllocationBytes } from '../../machine/ts/machine/cpu/heap_allocator';
import { THREAD_INITIAL_FRAMES, ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { integerConstant } from '../../toolchain/ts/lua/number';
import { readLE32, writeLE32 } from '../../machine/ts/common/endian';
import { ValueTag, valueBool, valueFloatBits, valueNil, valueInteger, valueTable, valueString, valueThread } from '../../machine/ts/machine/cpu/value';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { MAPPED_PAGE_BYTE_MASK, MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { BuiltinFunctionId, GarbageCollectionOperation } from '../../machine/ts/spec/blua32/builtin';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import {
	BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE, BLUA32_GLOBAL_NAME_ADDRESS_OFFSET,
	BLUA32_IMAGE_CONSTANT_COUNT_OFFSET, BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET, BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_STRING_BUCKET_ADDRESS_OFFSET, BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET, BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET,
	BLUA32_STRING_LENGTH_OFFSET, BLUA32_STRING_NEXT_OFFSET, BLUA32_STRING_RECORD_HEADER_SIZE,
} from '../../machine/ts/spec/blua32/image_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { CART_ROM_BASE, HEAP_PAGE_SIZE, MAIN_RAM_SIZE, RAM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { createTestSystemCpu, linkRawTestBlua32Pair, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';
import { runGuestToHalt } from '../helpers/cpu_test_harness';

function source(operation: OpCode = OpCode.HALT, wide = false) {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	let word = 0;
	if (wide) writeInstruction(text, word++, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, word++, operation, 0, operation === OpCode.NEWT ? 2 : 1, 1);
	writeInstruction(text, word++, OpCode.KSMI, 7, 0, 37);
	writeInstruction(text, word++, OpCode.HALT, 0, 0, 0);
	return { text, functions: [{ firstWord: 0, wordCount: word, maxStack: 8 }], constants: [null, integerConstant(12), 'ROM text does not own guest text bytes'],
		systemGlobalNames: ['system', 'system'], globalNames: ['global', 'global'] };
}

// The root Thread owns an 80-byte header, 40 bytes for eight Value slots
// and 112 bytes for two reserved activations. The remainder is a
// Closure, 17 RAM String records, two names and an 8-byte image map.
// Both lookup indexes are storage, not logical occupancy.
const bootThreadBytes = 80 + 40 + 112;
const bootBytes = bootThreadBytes + 12 + 15 + 697 + 8 + 2 * 9;
// Two Thread traces of its header and one active frame, an atomic trace
// that also clears eight Value slots, two remark visits and one sweep visit.
const bootCollectionWork = 2 * (20 + 14) + (20 + 14 + 10) + 2 + 1 + 3 + 1 + 3 * 6 + 2 * 17 + 32;

test('physical GC work counts canonical scans, reclamation and three unique root passes without a cycle debit', () => {
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32(source()));
	assert.equal(cpu.luaHeap.usedBytes(), bootBytes, 'charge allocated Strings and names, not their indexes');
	cpu.instructionBudgetRemaining = 7;
	assert.equal(cpu.gc.collect(), bootCollectionWork, 'object records and the RAM intern index are swept separately');
	assert.equal(cpu.instructionBudgetRemaining, 7);
	assert.equal(cpu.luaHeap.usedBytes(), bootBytes, 'read-only ROM Strings are not allocated');
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, cpu.createTable(2, 3)); //32+10+3×10=72 logical bytes.
	frame.registers.setString(1, cpu.stringPool.intern(textToByteString('é😀'))); //6 canonical UTF8 bytes, not3 UTF16 units.
	frame.top = 2;
	assert.equal(cpu.luaHeap.usedBytes(), bootBytes + 72 + 22);
	assert.equal(cpu.gc.collect(), bootCollectionWork + (8 + 2 + 8 + 1) + 2 + 2 * 3,
		'trace the live Values, scan the Table, mark the String leaf and visit each record');
	assert.equal(cpu.instructionBudgetRemaining, 7);
	assert.equal(cpu.luaHeap.usedBytes(), bootBytes + 72 + 22);
	assert.equal(cpu.luaHeap.collectionTarget(), 1048576);
	cpu.instructionBudgetRemaining = 123; cpu.collectTrackedHeapBytes();
	assert.equal(cpu.instructionBudgetRemaining, 123, 'raw host collection is unbilled');
	const state = cpu.captureRuntimeState(); cpu.restoreRuntimeState(state);
	assert.equal(cpu.instructionBudgetRemaining, 123); assert.equal(cpu.luaHeap.usedBytes(), bootBytes + 72 + 22);
	cpu.reset();
	assert.equal(cpu.instructionBudgetRemaining, 123, 'reset maintenance does not implicitly collect or bill the retained transient grant');
});

test('inactive frame reserve does not consume automatic GC quanta', () => {
	const image = linkRawTestSystemBlua32(source());
	const collect = (reservedFrames: number) => {
		const { cpu, memory } = createTestSystemCpu(image), { gc, rootThread: thread } = cpu;
		const retained = cpu.createTable(), doomed = cpu.createThread(0);
		if (reservedFrames !== THREAD_INITIAL_FRAMES) {
			cpu.luaHeap.reserveThreadFrameStorage(thread.address, 0, reservedFrames, valueNil());
			thread.bindStack();
			cpu.luaHeap.reserveThreadFrameStorage(doomed, 0, reservedFrames, valueThread(doomed));
		}
		thread.currentFrame!.registers.setTable(0, retained);
		thread.currentFrame!.top = 1;
		cpu.instructionBudgetRemaining = 9;
		const steps: [GcPhase, number][] = [];
		do {
			const phase = gc.phase();
			const work = gc.finalMarkPending() ? gc.stepFinalMark() : gc.step();
			steps.push([phase, work]);
			assert.ok(steps.length < 32, 'the automatic cycle drains in bounded quanta');
		} while (gc.active());
		assert.equal(cpu.instructionBudgetRemaining, 9);
		assert.equal(gc.tableRecordAddress(retained), retained);
		assert.equal(gc.threadRecordAddress(doomed), 0);
		assert.equal(memory.readRamRecordWord(thread.address + ThreadField.FrameCapacity), reservedFrames,
			'automatic collection keeps the live reservation');
		return steps;
	};
	assert.deepEqual(collect(THREAD_INITIAL_FRAMES), collect(1024));
});

test('table copy observes weak clearing during physical allocation retry', () => {
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32(source()));
	const { tables } = cpu.gc;
	const input = cpu.createTable(1024, 2), metatable = cpu.createTable(), unrooted = cpu.createTable();
	const key = cpu.stringPool.intern('weak copy member');
	tables.setStringKey(input, key, valueTable(unrooted));
	tables.setInteger(input, 1024, valueInteger(64));
	tables.setStringKey(metatable, cpu.stringPool.intern('__mode'), valueString(cpu.stringPool.intern('v')));
	tables.setMetatableAddress(input, metatable);
	cpu.createTable(1536, 0);
	while (cpu.heapAllocator.allocate(HEAP_PAGE_SIZE, true) !== 0) { /* exhaust physical backing pages */ }

	const copy = tables.copyOwn(input);
	assert.equal(cpu.gc.tableRecordAddress(input), input, 'the initial request roots the borrowed input');
	assert.equal(tables.getStringKey(input, key), valueNil(), 'failed physical admission cleared the weak source entry');
	assert.equal(tables.hashReserve(copy), 2, 'the original reservation still applies');
	assert.equal(tables.getStringKey(copy, key), valueNil(), 'only entries after the collection are copied');
	assert.equal(tables.getInteger(copy, 1024), valueInteger(64));
});

test('allocation admission and GC use logical bytes, not size-class slack', () => {
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32(source()));
	const logical = cpu.luaHeap.usedBytes(), physical = cpu.heapAllocator.occupiedBytes();
	const logicalCharge = (32 + 2 * 5 + 3 * 10) + (32 + 512 * 5);
	cpu.luaHeap.setCollectionTarget(logical + logicalCharge);
	cpu.instructionBudgetRemaining = 23;
	cpu.createTable(2, 3);
	cpu.createTable(512, 0);
	assert.equal(cpu.instructionBudgetRemaining, 23, 'the allocations fit at the exact logical threshold');
	assert.equal(cpu.luaHeap.usedBytes(), logical + logicalCharge);
	assert.equal(cpu.heapAllocator.occupiedBytes(), physical + 80 + 2 * heapAllocationBytes(32 + GC_OBJECT_PREFIX) + HEAP_PAGE_SIZE);
	cpu.collectTrackedHeapBytes();
	assert.equal(cpu.luaHeap.usedBytes(), logical, 'reclaim the exact charges');
	assert.equal(cpu.heapAllocator.occupiedBytes(), physical, 'reclaim class extents and whole pages separately');
});

test('table replacement admits just its logical increase, even when both layouts need backing', () => {
	for (const packArrayIntoHash of [false, true]) {
		const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32(source()));
		const table = packArrayIntoHash ? cpu.createTable(8, 0) : cpu.createTable(1, 0);
		const frame = cpu.rootThread.currentFrame!, tables = cpu.gc.tables;
		frame.registers.setTable(0, table); frame.top = 1;
		const residentKey = packArrayIntoHash ? 8 : 1, trigger = packArrayIntoHash ? 0 : 2;
		tables.setInteger(table, residentKey, valueInteger(100 + residentKey));
		const logical = cpu.luaHeap.usedBytes(), physical = cpu.heapAllocator.occupiedBytes();
		const target = logical + (packArrayIntoHash ? 0 : 5);
		cpu.luaHeap.setCollectionTarget(target);
		tables.setInteger(table, trigger, valueInteger(73));
		assert.equal(cpu.luaHeap.collectionTarget(), target, 'replacing a layout must not cause a gratuitous GC assist');
		assert.equal(cpu.gc.active(), false);
		assert.equal(cpu.luaHeap.usedBytes(), logical + (packArrayIntoHash ? -20 : 5));
		const oldStorage = packArrayIntoHash ? 40 : 5, newStorage = packArrayIntoHash ? 40 : 10;
		assert.equal(cpu.heapAllocator.occupiedBytes(), physical - heapAllocationBytes(oldStorage) + heapAllocationBytes(newStorage));
		assert.equal(tables.getInteger(table, residentKey), valueInteger(100 + residentKey));
		assert.equal(tables.getInteger(table, trigger), valueInteger(73));
	}
});

test('table growth retries its actual physical reserve before starting a fresh GC epoch', () => {
	for (const pressure of ['reclaimable', 'floating', 'unavailable', 'explicit'] as const) {
		const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32(source()));
		const { gc, heapAllocator: arena } = cpu, { tables } = gc;
		const table = cpu.createTable(512, 0);
		const frame = cpu.rootThread.currentFrame!;
		frame.registers.setTable(0, table); frame.top = 1;
		for (let key = 1; key <= 512; ++key) tables.setInteger(table, key, valueInteger(key));
		const garbage = pressure !== 'unavailable' ? cpu.createTable(1024, 0) : 0;
		let lastPage: number;
		for (let page = arena.allocate(HEAP_PAGE_SIZE, true); page !== 0; page = arena.allocate(HEAP_PAGE_SIZE, true)) {
			lastPage = page;
		}
		arena.free(lastPage!);
		assert.equal(arena.allocate(5 * 1024, true), 0, 'the replacement cannot reserve a two-page run while the old layout is live');
		assert.ok(cpu.luaHeap.usedBytes() + 2560 < cpu.luaHeap.capacity(), 'the replacement fits the logical budget');

		const white = gc.white();
		const initialRoot = pressure === 'floating' || pressure === 'explicit' ? valueTable(garbage) : valueNil();
		const diagnostics = gc.diagnostics = new GcDiagnostics(() => 0);
		gc.step(initialRoot, valueNil(), valueNil(), 0, false, 1);
		assert.equal(gc.phase(), GcPhase.Mark);
		cpu.instructionBudgetRemaining = 41;
		if (pressure === 'explicit') {
			gc.collect();
			assert.equal(gc.white(), white, 'deliberate full collection runs the fresh epoch');
			assert.equal(gc.tableRecordAddress(garbage), 0, 'a fresh epoch reclaims floating garbage');
		} else if (pressure === 'unavailable') {
			assert.throws(() => tables.setInteger(table, 513, valueInteger(73)), e => e === LUA_OUT_OF_MEMORY_SIGNAL);
			assert.equal(gc.white(), white, 'an impossible reserve retries once after a fresh epoch');
			assert.equal(tables.arrayCapacity(table), 512);
			assert.equal(tables.getInteger(table, 513), valueNil(), 'no insertion publishes on failure');
		} else {
			tables.setInteger(table, 513, valueInteger(73));
			assert.equal(gc.white(), pressure === 'reclaimable' ? white ^ 1 : white,
				'only a request that still misses after the old epoch starts a fresh one');
			assert.equal(tables.arrayCapacity(table), 1024);
			assert.equal(tables.getInteger(table, 512), valueInteger(512));
			assert.equal(tables.getInteger(table, 513), valueInteger(73));
		}
		assert.equal(gc.active(), false);
		assert.equal(cpu.instructionBudgetRemaining, 41);
		assert.equal(frame.registers.get(0), valueTable(table));
		assert.equal(diagnostics.fullCollections, 1, 'one synchronous request regardless of the number of epochs');
	}
});

test('whole-page demand advances a large live epoch before a table replacement needs recovery', () => {
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32(source()));
	const { gc, heapAllocator: arena } = cpu, { tables } = gc;
	const owner = cpu.createTable(512, 0);
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, owner); frame.top = 1;
	for (let key = 1; key <= 512; ++key) tables.setInteger(owner, key, valueInteger(key));
	frame.registers.setTable(1, cpu.createTable(225280, 0)); frame.top = 2;
	const garbage = cpu.createTable(65536, 0);
	frame.registers.setTable(2, garbage); frame.top = 3;
	const initialFree = 140;
	while (arena.availableWholePages() > initialFree) {
		const free = arena.availableWholePages(), claims = arena.claimedWholePages();
		assert.notEqual(arena.allocate(HEAP_PAGE_SIZE, true), 0);
		assert.equal(arena.availableWholePages(), free - 1);
		assert.equal(arena.claimedWholePages(), claims + 1);
	}
	gc.assistPhysicalPressureAtTick();
	gc.collect();
	frame.top = 2;
	const white = gc.white();
	cpu.instructionBudgetRemaining = 89;
	let physicalSteps = 0;
	for (let tick = 0; tick + 1 < initialFree; ++tick) {
		assert.notEqual(arena.allocate(HEAP_PAGE_SIZE, true), 0);
		const wasActive = gc.active();
		gc.assistPhysicalPressureAtTick();
		if (wasActive || gc.active()) ++physicalSteps;
		for (let steps = 0; gc.finalMarkPending(); ++steps) {
			assert.ok(steps < 8);
			gc.stepFinalMark();
		}
	}
	assert.ok(physicalSteps >= 50 && !gc.active() && gc.white() === (white ^ 1));
	assert.equal(gc.tableRecordAddress(garbage), 0);
	assert.ok(arena.availableWholePages() > 2);
	gc.assistPhysicalPressureAtTick();
	assert.equal(gc.active(), false, 'no new page claims do not trigger another epoch');
	const recoveredWhite = gc.white();
	tables.setInteger(owner, 513, valueInteger(73));
	assert.equal(gc.white(), recoveredWhite, 'the real backing grow requires no synchronous recovery');
	assert.equal(tables.getInteger(owner, 512), valueInteger(512));
	assert.equal(tables.getInteger(owner, 513), valueInteger(73));
	assert.equal(cpu.instructionBudgetRemaining, 89);
});

test('allocation assist target is only restored by the RAM checkpoint', () => {
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32(source()));
	const target = cpu.heapAllocator.managementOffset() + HEAP_COLLECTION_TARGET_OFFSET;
	const ram = cpu.memory.captureSaveState(), checkpoint = cpu.captureRuntimeState();
	cpu.memory.writeRamRecordWord(target, 2048);
	cpu.restoreRuntimeState(checkpoint);
	assert.equal(cpu.luaHeap.collectionTarget(), 2048);
	cpu.memory.restoreSaveState(ram);
	cpu.restoreRuntimeState(checkpoint);
	assert.equal(cpu.luaHeap.collectionTarget(), 1048576);
	assert.equal(cpu.luaHeap.usedBytes(), bootBytes);
});

for (const backend of [CpuExecutionBackend.Interpreter]) for (const wide of [false, true]) {
	test(`explicit collection uses only CALL and primitive cycles at the short-grant frontier (${backend}, WIDE=${wide})`, () => {
		const image = linkRawTestSystemBlua32(source(OpCode.CALL, wide));
		const { cpu } = createTestSystemCpu(image, backend), frame = cpu.rootThread.currentFrame!, pc = frame.pc;
		for (let warm = 0; warm < COMPILED_BLOCK_THRESHOLD + 2; ++warm) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			frame.registers.setBuiltinFunction(0, BuiltinFunctionId.CollectGarbage); frame.top = 1;
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		}
		if (backend === CpuExecutionBackend.JavaScript) assert.ok(frame.decodedPage!.compiledBlocks!.entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		frame.registers.setBuiltinFunction(0, BuiltinFunctionId.CollectGarbage); frame.registers.setNil(7); frame.top = 1;
		const doomed = cpu.createTable(16384, 0);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, 1 - 32 - 4, 'CALL and primitive only, no receiving slots');
		assert.equal(cpu.gc.tableRecordAddress(doomed), 0, 'explicit collection finishes before the instruction retires');
		assert.equal(frame.pc, pc + (wide ? 2 : 1) * INSTRUCTION_BYTES); assert.equal(frame.registers.get(7), valueNil());
		assert.equal(cpu.runUntilDepth(0, 0), RunResult.Yielded); assert.equal(cpu.instructionBudgetRemaining, 0);
		assert.equal(frame.registers.get(7), valueNil());
		assert.equal(cpu.runUntilDepth(0, 2), RunResult.Yielded); assert.equal(cpu.instructionBudgetRemaining, 0);
		assert.equal(frame.registers.get(7), valueInteger(37), 'fresh grant executes successor, not CALL/collection again');
	});

	test(`allocation-triggered GC does not add to NEWT initialization cycles (${backend}, WIDE=${wide})`, () => {
		const image = linkRawTestSystemBlua32(source(OpCode.NEWT, wide));
		const { cpu } = createTestSystemCpu(image, backend), frame = cpu.rootThread.currentFrame!, pc = frame.pc;
		for (let warm = 0; warm < COMPILED_BLOCK_THRESHOLD + 2; ++warm) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			cpu.runUntilDepth(0, 1);
		}
		if (backend === CpuExecutionBackend.JavaScript) assert.ok(frame.decodedPage!.compiledBlocks!.entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]);
		frame.registers.setNil(0); frame.top = 0;
		cpu.instructionBudgetRemaining = 123; cpu.collectTrackedHeapBytes();
		assert.equal(cpu.instructionBudgetRemaining, 123); assert.equal(cpu.luaHeap.usedBytes(), bootBytes);
		cpu.luaHeap.setCollectionTarget(0);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc); frame.registers.setNil(7);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, 1 - 24 - 4, 'charge NEWT and its initialized slots, not the marking step');
		assert.ok(cpu.gc.active(), 'allocation actually assisted an in-progress collection');
		assert.equal(cpu.luaHeap.usedBytes(), bootBytes + 52, 'request52 is admitted after collection and excluded from B_pre');
		assert.equal(frame.registers.getTag(0), ValueTag.Table); assert.equal(frame.registers.get(7), valueNil());
		assert.equal(cpu.runUntilDepth(0, 2), RunResult.Yielded); assert.equal(cpu.instructionBudgetRemaining, 0);
		assert.equal(frame.registers.get(7), valueInteger(37));
	});
}

test('failed allocation finishes emergency collection without a cycle debit or pending bytes', () => {
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32(source()));
	const doomed = cpu.createTable(16384, 0);
	cpu.instructionBudgetRemaining = 1;
	assert.throws(() => cpu.luaHeap.admit(cpu.luaHeap.capacity() + 1), e => e === LUA_OUT_OF_MEMORY_SIGNAL);
	assert.equal(cpu.instructionBudgetRemaining, 1);
	assert.equal(cpu.gc.tableRecordAddress(doomed), 0);
	assert.equal(cpu.luaHeap.usedBytes(), bootBytes);
	runGuestToHalt(cpu, 1); assert.equal(cpu.instructionBudgetRemaining, -1);
});

test('collect and step keep the same exact CALL and result-placement cycles across heap shapes', () => {
	const program = source(OpCode.CALL);
	writeInstruction(program.text, 0, OpCode.CALL, 0, 2, 2);
	const image = linkRawTestSystemBlua32(program);
	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		for (const operation of [GarbageCollectionOperation.Collect, GarbageCollectionOperation.Step]) {
			const physicalWork: number[] = [];
			for (const capacity of [1, 8192]) {
				const { cpu, memory } = createTestSystemCpu(image, backend), frame = cpu.rootThread.currentFrame!;
				frame.registers.setBuiltinFunction(0, BuiltinFunctionId.CollectGarbage);
				frame.registers.setInteger(1, operation);
				frame.registers.setTable(5, cpu.createTable(capacity, 0)); frame.top = 6;
				const state = cpu.captureRuntimeState(), ram = memory.captureSaveState();
				physicalWork.push(operation === GarbageCollectionOperation.Collect ? cpu.gc.collect() : cpu.gc.step());
				memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
				assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
				assert.equal(cpu.instructionBudgetRemaining, 1 - 32 - 4 - 1);
				assert.equal(cpu.readFrameRegister(0, 0),
					operation === GarbageCollectionOperation.Step ? valueBool(false) : valueNil());
				assert.equal(cpu.gc.active(), operation === GarbageCollectionOperation.Step);
			}
			assert.ok(physicalWork[1] > physicalWork[0], 'the same guest charge covers different physical work');
		}
	}
});

test('ROM constants need no collector visits even with multiple resident images', () => {
	const system = source();
	const first = linkRawTestBlua32Pair(system, { ...source(), constants: [null, integerConstant(1), integerConstant(2), 'card0'], globalNames: ['global', 'card0', 'card0'] });
	const second = linkRawTestBlua32Pair(system, { ...source(), constants: ['card1'], globalNames: ['global', 'card1'] });
	const memory = new Memory({ systemRom: first.systemRomBytes, cartridgeSlots: cartridgeSlots(first.cartRomBytes, second.cartRomBytes) }, PSX_MACHINE_SPEC.ramBytes);
	const irq = new IrqController(memory), cpu = new CPU(memory, irq, new ExecutionAddressSpace(memory)); cpu.reset();
	cpu.writeFrameExecution(0, 0, first.cartSymbols.functionAddresses[0], first.cartImage.functions[0].codeAddress);
	cpu.writeFrameExecution(0, 1, second.cartSymbols.functionAddresses[0], second.cartImage.functions[0].codeAddress);
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, first.systemSymbols.functionAddresses[0], first.systemImage.functions[0].codeAddress);
	cpu.collectTrackedHeapBytes();
	assert.equal(cpu.luaHeap.usedBytes(), bootBytes + (20 + 12) + (5 + 12) + 2 * 9, 'each card charges its constant bank, name-slot map and new unique global');
	cpu.instructionBudgetRemaining = 5;
	const work = bootCollectionWork + 3 * (3 * 2);
	assert.equal(cpu.gc.collect(), work, 'only the registered namespace slots add root work');
	assert.equal(cpu.instructionBudgetRemaining, 5);
	const state = cpu.captureRuntimeState(); cpu.restoreRuntimeState(state);
	assert.equal(cpu.gc.collect(), work);
	assert.equal(cpu.instructionBudgetRemaining, 5);
});

test('absolute ROM String references resolve even when backing and directory owner differ', () => {
	const bios = { ...source(), constants: ['system-shared', 'directory-link'], globalNames: [], systemGlobalNames: [] };
	const text = new Uint8Array(4 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.GETGL, 0, 0, 0);
	writeInstruction(text, 1, OpCode.LOADK, 1, 0, 0);
	writeInstruction(text, 2, OpCode.LOADK, 2, 0, 1);
	writeInstruction(text, 3, OpCode.HALT, 0, 0, 0);
	const media = { text, functions: [{ firstWord: 0, wordCount: 4, maxStack: 3 }],
		constants: ['unused', 'slot-zero'], globalNames: ['unused'] };
	const first = linkRawTestBlua32Pair(bios, media);
	const second = linkRawTestBlua32Pair(bios, { ...media, constants: ['unused', 'slot-one!'] });
	const biosHeader = first.systemImage.address;
	const biosConstants = readLE32(first.systemRomBytes, biosHeader + BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET);
	const shared = readLE32(first.systemRomBytes, biosConstants + BLUA32_CONSTANT_PAYLOAD_OFFSET);
	const bridge = readLE32(first.systemRomBytes, biosConstants + BLUA32_CONSTANT_RECORD_SIZE + BLUA32_CONSTANT_PAYLOAD_OFFSET);
	const bridgeBytes = BLUA32_STRING_RECORD_HEADER_SIZE + readLE32(first.systemRomBytes, bridge + BLUA32_STRING_LENGTH_OFFSET);
	const cartHeader = second.cartImage.address - CART_ROM_BASE;
	const cartConstants = readLE32(second.cartRomBytes, cartHeader + BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET) - CART_ROM_BASE;
	const cartNames = readLE32(second.cartRomBytes, cartHeader + BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET) - CART_ROM_BASE;
	const local = readLE32(second.cartRomBytes, cartConstants + BLUA32_CONSTANT_RECORD_SIZE + BLUA32_CONSTANT_PAYLOAD_OFFSET);
	assert.equal(readLE32(first.cartRomBytes, cartConstants + BLUA32_CONSTANT_RECORD_SIZE + BLUA32_CONSTANT_PAYLOAD_OFFSET), local);
	writeLE32(second.cartRomBytes, cartConstants + BLUA32_CONSTANT_PAYLOAD_OFFSET, shared);
	writeLE32(second.cartRomBytes, cartNames + BLUA32_GLOBAL_NAME_ADDRESS_OFFSET, shared);

	const directory = (first.systemRomBytes.length + 7) & ~7, link = directory + 8;
	const shortDirectory = (link + bridgeBytes + 7) & ~7, shortRecord = shortDirectory + 8;
	const localOffset = local - CART_ROM_BASE;
	const localBytes = BLUA32_STRING_RECORD_HEADER_SIZE + readLE32(second.cartRomBytes, localOffset + BLUA32_STRING_LENGTH_OFFSET);
	const systemRom = new Uint8Array(shortRecord + localBytes - 1);
	systemRom.set(first.systemRomBytes);
	systemRom.copyWithin(link, bridge, bridge + bridgeBytes);
	systemRom.set(second.cartRomBytes.subarray(localOffset, localOffset + localBytes - 1), shortRecord);
	writeLE32(systemRom, shortDirectory, shortRecord);
	writeLE32(systemRom, directory, link);
	writeLE32(systemRom, link + BLUA32_STRING_NEXT_OFFSET, local);
	writeLE32(second.cartRomBytes, local - CART_ROM_BASE + BLUA32_STRING_NEXT_OFFSET, 0);
	writeLE32(second.cartRomBytes, cartHeader + BLUA32_IMAGE_STRING_BUCKET_ADDRESS_OFFSET, directory);
	writeLE32(second.cartRomBytes, cartHeader + BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET, 1);

	const memory = new Memory({ systemRom, cartridgeSlots: cartridgeSlots(first.cartRomBytes, second.cartRomBytes) }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	cpu.reset();
	cpu.setGlobalByKey(shared, valueInteger(19));
	cpu.writeFrameExecution(0, 0, first.cartSymbols.functionAddresses[0], first.cartImage.functions[0].codeAddress);
	const bank0 = cpu.rootThread.currentFrame!.executionImage!;
	cpu.writeFrameExecution(0, 1, second.cartSymbols.functionAddresses[0], second.cartImage.functions[0].codeAddress);
	runGuestToHalt(cpu, 100);
	assert.equal(cpu.readFrameRegister(0, 0), valueInteger(19), 'the system-ROM name reuses the existing slot');
	assert.equal(cpu.readFrameRegister(0, 1), valueString(shared), 'socket one does not retag a system-ROM String ID');
	assert.equal(bank0.constWords[1], local);
	assert.equal(cpu.readFrameRegister(0, 2), valueString((local | 0x80000000) >>> 0));
	assert.equal(cpu.stringPool.toString(local), 'slot-zero');
	assert.equal(cpu.stringPool.toString((local | 0x80000000) >>> 0), 'slot-one!');

	const strings = cpu.stringPool;
	assert.throws(() => strings.activateRomTable(1, RAM_BASE, 1), { message: 'BLua32 String bucket table is invalid.' });
	assert.equal(strings.find('slot-one!'), (local | 0x80000000) >>> 0, 'failed directory admission leaves the index installed');
	assert.throws(() => strings.resolveImageRecord(1, RAM_BASE), { message: 'BLua32 ROM String header is invalid.' });
	assert.throws(() => strings.resolveImageRecord(1, shortRecord), { message: 'BLua32 ROM String is truncated.' });
	strings.activateRomTable(1, shortDirectory, 1);
	assert.throws(() => strings.find('slot-one!'), { message: 'BLua32 ROM String is truncated.' });
});

test('image replacement rejects bank extents beyond main RAM before changing runtime records', () => {
	const image = linkRawTestSystemBlua32(source());
	for (const constants of [false, true]) {
		const { cpu, memory, executionAddressSpace } = createTestSystemCpu(image);
		const rom = image.romBytes.slice();
		const header = image.image.address - SYSTEM_ROM_BASE;
		if (constants) {
			writeLE32(rom, header + BLUA32_IMAGE_CONSTANT_COUNT_OFFSET, ((MAIN_RAM_SIZE / 5) | 0) + 1);
		} else {
			// Each namespace fits the map on its own; their combined extent does not.
			writeLE32(rom, header + BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET, MAIN_RAM_SIZE / 4);
			writeLE32(rom, header + BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET, 1);
		}
		memory.installSystemRom(rom);
		const boot = executionAddressSpace.resolveSystemDomain();
		const before = cpu.captureRuntimeState(), ram = memory.captureSaveState();
		assert.throws(() => cpu.replaceExecutionImages([boot]), { message: 'BLua32 image bank extents exceed main RAM.' });
		assert.deepEqual(cpu.captureRuntimeState(), before);
		assert.deepEqual(memory.captureSaveState(), ram);
	}
});

test('constant loads, compiled operands and checkpoints use the physical bank', () => {
	const program = source();
	writeInstruction(program.text, 0, OpCode.LOADK, 0, 0, 1);
	writeInstruction(program.text, 1, OpCode.ADD, 1, 0, 0);
	writeInstruction(program.text, 2, OpCode.JMP, 0, 63, 61, 255);
	const image = linkRawTestSystemBlua32(program);
	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		const { cpu, memory } = createTestSystemCpu(image, backend);
		const base = cpu.captureRuntimeState().constantPoolBases[SYSTEM_EXECUTION_DOMAIN_ID + 1], tag = base + 3 * 4 + 1;
		assert.equal(memory.readRamRecordWord(base + 4), 12);
		assert.equal(memory.readRamRecordByte(tag), ValueTag.Integer);
		cpu.runUntilDepth(0, 4000);
		assert.equal(cpu.readFrameRegister(0, 1), valueInteger(24));
		if (backend === CpuExecutionBackend.JavaScript) assert.ok(cpu.rootThread.currentFrame!.decodedPage!.compiledBlocks);
		const ram = memory.captureSaveState(), state = cpu.captureRuntimeState(), occupied = cpu.heapAllocator.occupiedBytes();
		const bytes = new DataView(ram.ram.buffer);
		// A checkpoint restores the private bank, not writes through the public bus.
		ram.ram[tag - RAM_BASE] = ValueTag.Float;
		for (const [payload, result] of [[0x3fa00000, 0x40200000], [0x40000000, 0x40800000], [0x3fa00000, 0x40200000]]) {
			bytes.setUint32(base - RAM_BASE + 4, payload, true);
			memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
			cpu.runUntilDepth(0, 4000);
			assert.equal(cpu.readFrameRegister(0, 1), valueFloatBits(result), 'restore reattaches RAM instead of decoding ROM');
			assert.equal(cpu.heapAllocator.occupiedBytes(), occupied, 'restore does not allocate another bank');
		}
		cpu.reset(); cpu.reset();
		assert.equal(cpu.heapAllocator.occupiedBytes(), occupied, 'reset does not leak the superseded bank');
	}
});

test('temporary roots survive unbilled admission; unreachable allocations only add physical reclamation work', () => {
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32(source()));
	const table = cpu.createTable(), id = cpu.stringPool.intern(textToByteString('é😀'));
	const heap = [cpu.luaHeap.usedBytes(), cpu.luaHeap.collectionTarget()]; assert.equal(heap[0], bootBytes + 32 + 22);
	cpu.luaHeap.setCollectionTarget(0); cpu.instructionBudgetRemaining = 1;
	cpu.luaHeap.admit(0, valueTable(table), valueString(id));
	assert.equal(cpu.instructionBudgetRemaining, 1);
	assert.equal(cpu.gc.isAlive(table), true, 'the first mark actually visited the temporary Table');
	assert.equal(cpu.luaHeap.usedBytes(), bootBytes + 32 + 22); assert.equal(cpu.stringPool.toString(id), 'é😀');
	while (cpu.gc.active()) cpu.gc.step(valueTable(table), valueString(id));
	assert.equal(cpu.gc.collect(), bootCollectionWork + 2);
	assert.equal(cpu.instructionBudgetRemaining, 1);
	assert.equal(cpu.luaHeap.usedBytes(), bootBytes);
});
