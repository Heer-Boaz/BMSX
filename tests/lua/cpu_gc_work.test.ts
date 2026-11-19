import { textToByteString } from '../../machine/ts/common/byte_string';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CpuExecutionBackend, COMPILED_BLOCK_THRESHOLD } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult, CPU } from '../../machine/ts/machine/cpu/cpu';
import { LUA_OUT_OF_MEMORY_SIGNAL } from '../../machine/ts/machine/cpu/errors';
import { HEAP_COLLECTION_TARGET_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { integerConstant } from '../../toolchain/ts/lua/number';
import { ValueTag, valueFloatBits, valueNil, valueInteger, valueTable, valueString } from '../../machine/ts/machine/cpu/value';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { MAPPED_PAGE_BYTE_MASK, MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { createTestSystemCpu, linkRawTestBlua32Pair, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';

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

// The root Thread owns a 64-byte header and a 160-byte allocation for
// eight Value slots and two reserved activations. The remainder is a
// Closure, 14 RAM String records and their 16 four-byte intern buckets.
const bootThreadBytes = 64 + 160;
const bootThreadWords = bootThreadBytes / 4;
const bootBytes = bootThreadBytes + 16 + 16 + 648 + 64;
const bootMarkWork = 2 * bootThreadWords + 3 + 2 * 12 + 14;
const bootCollectionWork = 4 * bootThreadWords + 3 + 1 + 3 * 12 + 2 * 14 + 16;

test('runtime GC bills actual canonical scans, reclamation and three unique root passes', () => {
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32(source()));
	assert.equal(cpu.luaHeap.usedBytes(), bootBytes, 'charge the allocated RAM String and index blocks');
	cpu.instructionBudgetRemaining = 7; cpu.luaHeap.collectRuntime();
	assert.equal(cpu.instructionBudgetRemaining, 7 - bootCollectionWork, 'only physical object slots and the RAM intern index are swept');
	assert.equal(cpu.luaHeap.usedBytes(), bootBytes, 'read-only ROM Strings are not allocated');
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, cpu.gc.reference(cpu.createTable(2, 3))); //32+S(10+4×14)=112.
	frame.registers.setString(1, cpu.stringPool.intern(textToByteString('é😀'))); //6 canonical UTF8 bytes, not3 UTF16 units.
	frame.top = 2;
	assert.equal(cpu.luaHeap.usedBytes(), bootBytes + 112 + 24);
	cpu.instructionBudgetRemaining = 7; cpu.luaHeap.collectRuntime();
	assert.equal(cpu.instructionBudgetRemaining, 7 - bootCollectionWork - (8 + 2 + 8 + 1) - 2, 'scan the Table, mark the String leaf and visit each record');
	assert.equal(cpu.luaHeap.usedBytes(), bootBytes + 112 + 24);
	assert.equal(cpu.luaHeap.collectionTarget(), 1048576);
	cpu.instructionBudgetRemaining = 123; cpu.collectTrackedHeapBytes();
	assert.equal(cpu.instructionBudgetRemaining, 123, 'raw host collection is unbilled');
	const state = cpu.captureRuntimeState(); cpu.restoreRuntimeState(state);
	assert.equal(cpu.instructionBudgetRemaining, 123); assert.equal(cpu.luaHeap.usedBytes(), bootBytes + 112 + 24);
	cpu.reset();
	assert.equal(cpu.instructionBudgetRemaining, 123, 'reset maintenance does not implicitly collect or bill the retained transient grant');
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

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) for (const wide of [false, true]) {
	test(`explicit GC owns full short-grant debt once (${backend}, WIDE=${wide})`, () => {
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
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, 1 - 32 - 4 - bootCollectionWork, 'CALL and primitive plus collection, no receiving slots');
		assert.equal(frame.pc, pc + (wide ? 2 : 1) * INSTRUCTION_BYTES); assert.equal(frame.registers.get(7), valueNil());
		assert.equal(cpu.runUntilDepth(0, 0), RunResult.Yielded); assert.equal(cpu.instructionBudgetRemaining, 0);
		assert.equal(frame.registers.get(7), valueNil());
		assert.equal(cpu.runUntilDepth(0, 2), RunResult.Yielded); assert.equal(cpu.instructionBudgetRemaining, 0);
		assert.equal(frame.registers.get(7), valueInteger(37), 'fresh grant executes successor, not CALL/collection again');
	});

	test(`allocation-triggered GC charges pre-request pool before initialization (${backend}, WIDE=${wide})`, () => {
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
		assert.equal(cpu.instructionBudgetRemaining, 1 - 24 - 4 - bootMarkWork, 'charge NEWT, its initialized slots and the first marking step');
		assert.equal(cpu.luaHeap.usedBytes(), bootBytes + 56, 'request56 is admitted after collection and excluded from B_pre');
		assert.equal(frame.registers.getTag(0), ValueTag.Table); assert.equal(frame.registers.get(7), valueNil());
		assert.equal(cpu.runUntilDepth(0, 2), RunResult.Yielded); assert.equal(cpu.instructionBudgetRemaining, 0);
		assert.equal(frame.registers.get(7), valueInteger(37));
	});
}

test('failed allocation retains the collection debit, not pending request bytes', () => {
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32(source()));
	cpu.instructionBudgetRemaining = 1;
	assert.throws(() => cpu.luaHeap.admit(cpu.luaHeap.capacity() + 1), e => e === LUA_OUT_OF_MEMORY_SIGNAL);
	assert.equal(cpu.instructionBudgetRemaining, 1 - bootCollectionWork); assert.equal(cpu.luaHeap.usedBytes(), bootBytes);
	assert.equal(cpu.runUntilDepth(0, 1), RunResult.Halted); assert.equal(cpu.instructionBudgetRemaining, -1);
});

test('all activated image constants and unique namespace slots remain priced across restore', () => {
	const system = source();
	const first = linkRawTestBlua32Pair(system, { ...source(), constants: [null, integerConstant(1), integerConstant(2), 'card0'], globalNames: ['global', 'card0', 'card0'] });
	const second = linkRawTestBlua32Pair(system, { ...source(), constants: ['card1'], globalNames: ['global', 'card1'] });
	const memory = new Memory({ systemRom: first.systemRomBytes, cartridgeSlots: cartridgeSlots(first.cartRomBytes, second.cartRomBytes) }, PSX_MACHINE_SPEC.ramBytes);
	const irq = new IrqController(memory), cpu = new CPU(memory, irq, new ExecutionAddressSpace(memory)); cpu.reset();
	cpu.writeFrameExecution(0, 0, first.cartSymbols.functionAddresses[0], first.cartImage.functions[0].codeAddress);
	cpu.writeFrameExecution(0, 1, second.cartSymbols.functionAddresses[0], second.cartImage.functions[0].codeAddress);
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, first.systemSymbols.functionAddresses[0], first.systemImage.functions[0].codeAddress);
	cpu.collectTrackedHeapBytes(); assert.equal(cpu.luaHeap.usedBytes(), bootBytes + 24 + 8, 'each activated card charges its RAM const bank once');
	cpu.instructionBudgetRemaining = 5; cpu.luaHeap.collectRuntime();
	assert.equal(cpu.instructionBudgetRemaining, 5 - bootCollectionWork - 3 * (2 * 5 + 3 * 2), 'all three root passes include constants and registered names of both activated cards');
	const state = cpu.captureRuntimeState(); cpu.restoreRuntimeState(state);
	cpu.instructionBudgetRemaining = 5; cpu.luaHeap.collectRuntime(); assert.equal(cpu.instructionBudgetRemaining, 5 - bootCollectionWork - 3 * (2 * 5 + 3 * 2));
});

test('constant loads, compiled operands and checkpoints use the physical bank', () => {
	const program = source();
	writeInstruction(program.text, 0, OpCode.LOADK, 0, 0, 1);
	writeInstruction(program.text, 1, OpCode.ADD, 1, 0, 0);
	writeInstruction(program.text, 2, OpCode.JMP, 0, 63, 61, 255);
	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		const { cpu, memory } = createTestSystemCpu(linkRawTestSystemBlua32(program), backend);
		const base = cpu.captureRuntimeState().constantPoolBases[SYSTEM_EXECUTION_DOMAIN_ID + 1], tag = base + 3 * 4 + 1;
		assert.equal(memory.readRamRecordWord(base + 4), 12);
		assert.equal(memory.readRamRecordByte(tag), ValueTag.Integer);
		cpu.runUntilDepth(0, 4000);
		assert.equal(cpu.readFrameRegister(0, 1), valueInteger(24));
		if (backend === CpuExecutionBackend.JavaScript) assert.ok(cpu.rootThread.currentFrame!.decodedPage!.compiledBlocks);
		memory.writeRamRecordWord(base + 4, 0x3fa00000);
		memory.writeRamRecordByte(tag, ValueTag.Float);
		cpu.runUntilDepth(0, 4000);
		assert.equal(cpu.readFrameRegister(0, 1), valueFloatBits(0x40200000), 'pre-specialized code sees both changed lanes');
		const ram = memory.captureSaveState(), state = cpu.captureRuntimeState(), occupied = cpu.heapAllocator.occupiedBytes();
		memory.writeRamRecordWord(base + 4, 0x40000000);
		cpu.runUntilDepth(0, 4000);
		assert.equal(cpu.readFrameRegister(0, 1), valueFloatBits(0x40800000));
		memory.restoreSaveState(ram); cpu.restoreRuntimeState(state);
		cpu.runUntilDepth(0, 4000);
		assert.equal(cpu.readFrameRegister(0, 1), valueFloatBits(0x40200000), 'restore reattaches RAM instead of decoding ROM');
		assert.equal(cpu.heapAllocator.occupiedBytes(), occupied, 'restore does not allocate another bank');
		cpu.reset(); cpu.reset();
		assert.equal(cpu.heapAllocator.occupiedBytes(), occupied, 'reset does not leak the superseded bank');
	}
});

test('temporary roots survive charged steps; unreachable allocations pay reclamation but no mark scan', () => {
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32(source()));
	const table = cpu.createTable(), id = cpu.stringPool.intern(textToByteString('é😀'));
	const heap = [cpu.luaHeap.usedBytes(), cpu.luaHeap.collectionTarget()]; assert.equal(heap[0], bootBytes + 32 + 24);
	cpu.luaHeap.setCollectionTarget(0); cpu.instructionBudgetRemaining = 1;
	cpu.luaHeap.admit(0, valueTable(cpu.gc.reference(table)), valueString(id));
	assert.equal(cpu.instructionBudgetRemaining, 1 - bootMarkWork - 8 - 1, 'first mark with two temporary roots; atomic and reclamation remain');
	assert.equal(cpu.luaHeap.usedBytes(), bootBytes + 32 + 24); assert.equal(cpu.stringPool.toString(id), 'é😀');
	while (cpu.gc.active()) cpu.gc.step(valueTable(cpu.gc.reference(table)), valueString(id));
	cpu.instructionBudgetRemaining = 1; cpu.luaHeap.collectRuntime();
	assert.equal(cpu.instructionBudgetRemaining, 1 - bootCollectionWork - 2); assert.equal(cpu.luaHeap.usedBytes(), bootBytes);
});
