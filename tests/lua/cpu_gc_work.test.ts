import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CpuExecutionBackend, COMPILED_BLOCK_THRESHOLD } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult, CPU } from '../../machine/ts/machine/cpu/cpu';
import { LUA_OUT_OF_MEMORY_SIGNAL } from '../../machine/ts/machine/cpu/errors';
import { integerConstant } from '../../toolchain/ts/lua/number';
import { ValueTag, valueNil, valueInteger, valueTable, valueString } from '../../machine/ts/machine/cpu/value';
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

test('runtime GC bills actual canonical scans, reclamation and three unique root passes', () => {
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32(source()));
	assert.equal(cpu.luaHeap.usedBytes(), 133, '__index7 + __mode6 + Thread(64+8×5) + rootClosure16');
	cpu.instructionBudgetRemaining = 7; cpu.luaHeap.collectRuntime();
	assert.equal(cpu.instructionBudgetRemaining, -162, 'Thread26×4 + Closure4×2 + roots12×3 + directory17 + text(2+2) =169');
	assert.equal(cpu.luaHeap.usedBytes(), 133, 'ROM-backed strings and host object shapes are not pool text bytes');
	const frame = cpu.rootThread.currentFrame!;
	frame.registers.setTable(0, cpu.gc.reference(cpu.createTable(2, 3))); //32+S(10+4×14)=112.
	frame.registers.setString(1, cpu.stringPool.intern('é😀')); //6 canonical UTF8 bytes, not3 UTF16 units.
	frame.top = 2;
	assert.equal(cpu.luaHeap.usedBytes(), 251);
	cpu.instructionBudgetRemaining = 7; cpu.luaHeap.collectRuntime();
	assert.equal(cpu.instructionBudgetRemaining, -184, 'base169 + Table(8+2+8 scan, 1 sweep) + String(1slot+2words) =191');
	assert.equal(cpu.luaHeap.usedBytes(), 251);
	assert.equal(cpu.luaHeap.captureState().nextCollectionBytes, 1048576);
	cpu.instructionBudgetRemaining = 123; cpu.collectTrackedHeapBytes();
	assert.equal(cpu.instructionBudgetRemaining, 123, 'raw host collection is unbilled');
	const state = cpu.captureRuntimeState(); cpu.restoreRuntimeState(state);
	assert.equal(cpu.instructionBudgetRemaining, 123); assert.equal(cpu.luaHeap.usedBytes(), 251);
	cpu.reset();
	assert.equal(cpu.instructionBudgetRemaining, 123, 'reset maintenance does not implicitly collect or bill the retained transient grant');
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
		assert.equal(cpu.instructionBudgetRemaining, -204, 'CALL32 + primitive4 + collection169, no receiving slots');
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
		assert.equal(cpu.instructionBudgetRemaining, 123); assert.equal(cpu.luaHeap.usedBytes(), 133);
		const heap = cpu.luaHeap.captureState(); cpu.luaHeap.restoreState({ ...heap, nextCollectionBytes: 0 });
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc); frame.registers.setNil(7);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, -107, 'NEWT24 + initialized4 + first mark26+4+26 + roots12×2 =108');
		assert.equal(cpu.luaHeap.usedBytes(), 189, 'request56 is admitted after collection and excluded from B_pre');
		assert.equal(frame.registers.getTag(0), ValueTag.Table); assert.equal(frame.registers.get(7), valueNil());
		assert.equal(cpu.runUntilDepth(0, 2), RunResult.Yielded); assert.equal(cpu.instructionBudgetRemaining, 0);
		assert.equal(frame.registers.get(7), valueInteger(37));
	});
}

test('failed allocation retains the collection debit, not pending request bytes', () => {
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32(source()));
	cpu.instructionBudgetRemaining = 1;
	assert.throws(() => cpu.luaHeap.reserve(cpu.luaHeap.capacity() + 1), e => e === LUA_OUT_OF_MEMORY_SIGNAL);
	assert.equal(cpu.instructionBudgetRemaining, -168); assert.equal(cpu.luaHeap.usedBytes(), 133);
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
	cpu.collectTrackedHeapBytes(); assert.equal(cpu.luaHeap.usedBytes(), 133);
	cpu.instructionBudgetRemaining = 5; cpu.luaHeap.collectRuntime();
	assert.equal(cpu.instructionBudgetRemaining, -214, 'Thread104 + Closure8 + roots28×3 + directory19 + text4 =219');
	const state = cpu.captureRuntimeState(); cpu.restoreRuntimeState(state);
	cpu.instructionBudgetRemaining = 5; cpu.luaHeap.collectRuntime(); assert.equal(cpu.instructionBudgetRemaining, -214);
});

test('temporary roots survive charged steps; unreachable allocations pay reclamation but no mark scan', () => {
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32(source()));
	const table = cpu.createTable(), id = cpu.stringPool.intern('é😀');
	const heap = cpu.luaHeap.captureState(); assert.equal(heap.trackedBytes, 171);
	cpu.luaHeap.restoreState({ ...heap, nextCollectionBytes: 0 }); cpu.instructionBudgetRemaining = 1;
	cpu.luaHeap.reserve(0, valueTable(cpu.gc.reference(table)), valueString(id));
	assert.equal(cpu.instructionBudgetRemaining, -87, 'first mark80 + live Table8 =88; atomic and reclamation remain');
	assert.equal(cpu.luaHeap.usedBytes(), 171); assert.equal(cpu.stringPool.toString(id), 'é😀');
	while (cpu.gc.active()) cpu.gc.step(valueTable(cpu.gc.reference(table)), valueString(id));
	cpu.instructionBudgetRemaining = 1; cpu.luaHeap.collectRuntime();
	assert.equal(cpu.instructionBudgetRemaining, -172); assert.equal(cpu.luaHeap.usedBytes(), 133);
});
