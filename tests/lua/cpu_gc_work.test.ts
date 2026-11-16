import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CpuExecutionBackend, COMPILED_BLOCK_THRESHOLD } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult, CPU } from '../../machine/ts/machine/cpu/cpu';
import { LUA_OUT_OF_MEMORY_SIGNAL } from '../../machine/ts/machine/cpu/errors';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { MAPPED_PAGE_BYTE_MASK, MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { BASE_RAM_USED_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
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
	return { text, functions: [{ firstWord: 0, wordCount: word, maxStack: 8 }], constants: [null, 12, 'ROM text does not own guest text bytes'],
		systemGlobalNames: ['system', 'system'], globalNames: ['global', 'global'] };
}

test('runtime GC bills canonical precollection bytes and complete unique root ranges literally', () => {
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32(source()));
	assert.equal(cpu.luaHeap.usedBytes(), 157, '__index7 + __mode6 + Thread(64+8×8) + rootClosure16');
	cpu.instructionBudgetRemaining = 7; cpu.luaHeap.collectRuntime();
	assert.equal(cpu.instructionBudgetRemaining, -85, 'B157→40words×2, C3×2, S1+G1×3 =92');
	assert.equal(cpu.luaHeap.usedBytes(), 157, 'ROM-backed strings and host object shapes are not pool text bytes');
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, cpu.createTable(2, 3)); //32+16+4×20=128.
	frame.registers.setStringId(1, cpu.stringPool.intern('é😀')); //6 canonical UTF8 bytes, not3 UTF16 units.
	frame.top = 2;
	assert.equal(cpu.luaHeap.usedBytes(), 291);
	cpu.instructionBudgetRemaining = 7; cpu.luaHeap.collectRuntime();
	assert.equal(cpu.instructionBudgetRemaining, -151, 'B291→73words×2 +12 roots =158; round aggregate once');
	assert.equal(cpu.luaHeap.usedBytes(), 291);
	assert.equal(cpu.luaHeap.captureState().nextCollectionBytes, 1048576);
	cpu.instructionBudgetRemaining = 123; cpu.collectTrackedHeapBytes();
	assert.equal(cpu.instructionBudgetRemaining, 123, 'raw host collection is unbilled');
	const state = cpu.captureRuntimeState(); cpu.restoreRuntimeState(state);
	assert.equal(cpu.instructionBudgetRemaining, 123); assert.equal(cpu.luaHeap.usedBytes(), 291);
	cpu.reset();
	assert.equal(cpu.instructionBudgetRemaining, 123, 'reset maintenance does not implicitly collect or bill the retained transient grant');
});

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) for (const wide of [false, true]) {
	test(`explicit GC owns full short-grant debt once (${backend}, WIDE=${wide})`, () => {
		const image = linkRawTestSystemBlua32(source(OpCode.CALL, wide));
		const { cpu } = createTestSystemCpu(image, backend), frame = cpu.rootThread.currentFrame!, pc = frame.pc;
		for (let warm = 0; warm < COMPILED_BLOCK_THRESHOLD + 2; ++warm) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			frame.registers.setEncoded(0, ValueTag.BuiltinFunction, BuiltinFunctionId.CollectGarbage, null); frame.top = 1;
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		}
		if (backend === CpuExecutionBackend.JavaScript) assert.ok(frame.decodedPage!.compiledBlocks!.entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		frame.registers.setEncoded(0, ValueTag.BuiltinFunction, BuiltinFunctionId.CollectGarbage, null); frame.registers.setNil(7); frame.top = 1;
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, -127, 'CALL32 + primitive4 + literalcollection92, no receiving slots');
		assert.equal(frame.pc, pc + (wide ? 2 : 1) * INSTRUCTION_BYTES); assert.equal(frame.registers.get(7), null);
		assert.equal(cpu.runUntilDepth(0, 0), RunResult.Yielded); assert.equal(cpu.instructionBudgetRemaining, 0);
		assert.equal(frame.registers.get(7), null);
		assert.equal(cpu.runUntilDepth(0, 2), RunResult.Yielded); assert.equal(cpu.instructionBudgetRemaining, 0);
		assert.equal(frame.registers.getNumber(7), 37, 'fresh grant executes successor, not CALL/collection again');
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
		assert.equal(cpu.instructionBudgetRemaining, 123); assert.equal(cpu.luaHeap.usedBytes(), 157);
		const heap = cpu.luaHeap.captureState(); cpu.luaHeap.restoreState({ ...heap, nextCollectionBytes: 0 });
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc); frame.registers.setNil(7);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, -119, 'NEWT24 + initialized4 + literal pre-requestcollection92');
		assert.equal(cpu.luaHeap.usedBytes(), 225, 'request68 is admitted after collection and excluded from B_pre');
		assert.equal(frame.registers.getTag(0), ValueTag.Table); assert.equal(frame.registers.get(7), null);
		assert.equal(cpu.runUntilDepth(0, 2), RunResult.Yielded); assert.equal(cpu.instructionBudgetRemaining, 0);
		assert.equal(frame.registers.getNumber(7), 37);
	});
}

test('failed allocation retains the collection debit, not pending request bytes', () => {
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32(source()));
	cpu.instructionBudgetRemaining = 1;
	assert.throws(() => cpu.luaHeap.reserve(PSX_MACHINE_SPEC.ramBytes - BASE_RAM_USED_SIZE + 1), e => e === LUA_OUT_OF_MEMORY_SIGNAL);
	assert.equal(cpu.instructionBudgetRemaining, -91); assert.equal(cpu.luaHeap.usedBytes(), 157);
	assert.equal(cpu.runUntilDepth(0, 1), RunResult.Halted); assert.equal(cpu.instructionBudgetRemaining, -1);
});

test('all activated image constants and unique namespace slots remain priced across restore', () => {
	const system = source();
	const first = linkRawTestBlua32Pair(system, { ...source(), constants: [null, 1, 2, 'card0'], globalNames: ['global', 'card0', 'card0'] });
	const second = linkRawTestBlua32Pair(system, { ...source(), constants: ['card1'], globalNames: ['global', 'card1'] });
	const memory = new Memory({ systemRom: first.systemRomBytes, cartridgeSlots: cartridgeSlots(first.cartRomBytes, second.cartRomBytes) }, PSX_MACHINE_SPEC.ramBytes);
	const irq = new IrqController(memory), cpu = new CPU(memory, irq, new ExecutionAddressSpace(memory)); cpu.reset();
	cpu.writeFrameExecution(0, 0, first.cartSymbols.functionAddresses[0], first.cartImage.functions[0].codeAddress);
	cpu.writeFrameExecution(0, 1, second.cartSymbols.functionAddresses[0], second.cartImage.functions[0].codeAddress);
	cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, first.systemSymbols.functionAddresses[0], first.systemImage.functions[0].codeAddress);
	cpu.collectTrackedHeapBytes(); assert.equal(cpu.luaHeap.usedBytes(), 157);
	cpu.instructionBudgetRemaining = 5; cpu.luaHeap.collectRuntime();
	assert.equal(cpu.instructionBudgetRemaining, -103, 'B157:80 + C(3+4+1)×2:16 + S1/G3×3:12 =108');
	const state = cpu.captureRuntimeState(); cpu.restoreRuntimeState(state);
	cpu.instructionBudgetRemaining = 5; cpu.luaHeap.collectRuntime(); assert.equal(cpu.instructionBudgetRemaining, -103);
});

test('temporary roots survive charged collection; dead precollection bytes still count', () => {
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32(source()));
	const table = cpu.createTable(), id = cpu.stringPool.intern('é😀');
	const heap = cpu.luaHeap.captureState(); assert.equal(heap.trackedBytes, 195);
	cpu.luaHeap.restoreState({ ...heap, nextCollectionBytes: 0 }); cpu.instructionBudgetRemaining = 1;
	cpu.luaHeap.reserve(0, ValueTag.Table, NaN, table, ValueTag.String, id, null);
	assert.equal(cpu.instructionBudgetRemaining, -109, '2×ceil(195/4)+12 =110');
	assert.equal(cpu.luaHeap.usedBytes(), 195); assert.equal(cpu.stringPool.toString(id), 'é😀');
	cpu.instructionBudgetRemaining = 1; cpu.luaHeap.collectRuntime();
	assert.equal(cpu.instructionBudgetRemaining, -109); assert.equal(cpu.luaHeap.usedBytes(), 157);
});
