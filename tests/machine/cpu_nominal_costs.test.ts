import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compiledBlockSupports, CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { bindOpen } from '../../machine/ts/machine/cpu/upvalue';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { integerConstant } from '../../toolchain/ts/lua/number';
import { ValueTag, valueInteger, valueFloat, valueNil, valueTable, valueBool } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_MASK, MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { CPU_CAUSE_CODE_RESERVED_INSTRUCTION } from '../../machine/ts/spec/blua32/cop0';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { createTestSystemCpu, linkRawTestSystemBlua32, seedTestCapturedClosure, seedTestRomClosure } from '../helpers/blua32';

for (const backend of [CpuExecutionBackend.Interpreter]) for (const wide of [false, true]) {
	test(`nominal work classes retain every admitted effect, prefix and debt (${backend}, WIDE=${wide})`, () => {
		// Literal contract oracle, independent of BASE_CYCLES. The two POWs also
		// force the generated segment's accumulated debit beyond one byte.
		const instructions = [
			[OpCode.K1, 9, 0, 0, 2], [OpCode.POW, 10, 4, 5, 128], [OpCode.POW, 11, 4, 5, 128],
			[OpCode.MOD, 12, 6, 7, 34], [OpCode.LEN, 13, 8, 0, 3],
			[OpCode.GETT, 14, 0, 2, 16], [OpCode.GETI, 15, 0, 1, 8], [OpCode.GETFIELD, 16, 0, 0, 16],
			[OpCode.SETT, 0, 2, 3, 16], [OpCode.SETI, 0, 1, 3, 8], [OpCode.SETFIELD, 0, 0, 3, 16],
			[OpCode.SELF, 17, 0, 0, 17],
			[OpCode.GETSYS, 20, 0, 0, 3], [OpCode.SETSYS, 3, 0, 0, 4],
			[OpCode.GETGL, 21, 0, 0, 3], [OpCode.SETGL, 3, 0, 0, 4],
		] as const;
		const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE), starts: number[] = [];
		let word = 0;
		for (const [op, a, b, c] of instructions) {
			starts.push(word);
			if (wide) writeInstruction(text, word++, OpCode.WIDE, 0, 0, 0);
			writeInstruction(text, word++, op, a, b, c);
		}
		starts.push(word);
		writeInstruction(text, word, OpCode.JMP, 0, 63, (-(word + 1)) & 63, 255);
		const image = linkRawTestSystemBlua32({ text, constants: ['field'], globalNames: ['value'], systemGlobalNames: ['value'],
			functions: [{ firstWord: 0, wordCount: word + 1, maxStack: 24 }] });
		const { cpu } = createTestSystemCpu(image, backend), frame = cpu.rootThread.currentFrame!, r = frame.registers;
		const base = frame.pc, key = cpu.stringPool.intern('field'), global = cpu.stringPool.intern('value');
		const table = cpu.createTable(1, 1); cpu.gc.tables.setInteger(table, 1, valueInteger(11)); cpu.gc.tables.setStringKey(table, key, valueInteger(17));
		r.setTable(0, table); r.setInteger(1, 1); r.setString(2, key); r.setInteger(3, 23);
		r.setInteger(4, 2); r.setInteger(5, 3); r.setInteger(6, 7); r.setInteger(7, 3); r.setString(8, cpu.stringPool.intern('abc'));
		const charges = [...instructions.map(row => row[4]), 2], total = charges.reduce((a, b) => a + b, 0);
		cpu.runUntilDepth(0, total * 32);
		if (backend === CpuExecutionBackend.JavaScript) assert.ok(frame.decodedPage!.compiledBlocks!.entries[(base & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]);
		for (let grant = 0; grant <= total; ++grant) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], base);
			r.clear(13, 9); cpu.gc.tables.setInteger(table, 1, valueInteger(11)); cpu.gc.tables.setStringKey(table, key, valueInteger(17));
			cpu.setSystemGlobalByKey(global, valueInteger(31)); cpu.setGlobalByKey(global, valueInteger(37));
			assert.equal(cpu.runUntilDepth(0, grant), RunResult.Yielded);
			let remaining = grant, completed = 0;
			while (remaining > 0) remaining -= charges[completed++];
			assert.equal(cpu.instructionBudgetRemaining, remaining, `debt at grant ${grant}`);
			assert.equal(frame.pc, base + (completed === charges.length ? 0 : starts[completed]) * INSTRUCTION_BYTES);
			for (const [after, slot, value] of [[1, 9, valueInteger(1)], [2, 10, valueFloat(8)], [3, 11, valueFloat(8)], [4, 12, valueInteger(1)], [5, 13, valueInteger(3)], [6, 14, valueInteger(17)], [7, 15, valueInteger(11)], [8, 16, valueInteger(17)], [12, 17, valueInteger(23)], [13, 20, valueInteger(31)], [15, 21, valueInteger(37)]]) {
				assert.equal(r.get(slot), completed >= after ? value : valueNil(), `R${slot} at grant ${grant}`);
			}
			assert.equal(cpu.gc.tables.getStringKey(table, key), valueInteger(completed >= 9 ? 23 : 17));
			assert.equal(cpu.gc.tables.getInteger(table, 1), valueInteger(completed >= 10 ? 23 : 11));
			assert.equal(r.get(18), completed >= 12 ? valueTable(table) : valueNil());
			assert.equal(cpu.getSystemGlobalByKey(global), valueInteger(completed >= 14 ? 23 : 31));
			assert.equal(cpu.getGlobalByKey(global), valueInteger(completed >= 16 ? 23 : 37));
		}
	});

	test(`cached closure, upvalue, call and return work is charged once (${backend}, WIDE=${wide})`, () => {
		const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE), rootStarts: number[] = [], childStarts: number[] = [];
		let word = 0, closureBody = 0;
		for (const [op, a, b, c] of [[OpCode.LOADK, 4, 0, 0], [OpCode.CLOSURE, 6, 0, 0], [OpCode.CALL, 0, 1, 1], [OpCode.KTRUE, 5, 0, 0]]) {
			rootStarts.push(word); if (wide || op === OpCode.CLOSURE) writeInstruction(text, word++, OpCode.WIDE, 0, 0, 0);
			if (op === OpCode.CLOSURE) closureBody = word;
			writeInstruction(text, word++, op, a, b, c);
		}
		rootStarts.push(word); writeInstruction(text, word, OpCode.JMP, 0, 63, (-(word + 1)) & 63, 255);
		const rootWords = word + 1; word = 32;
		for (const [op, a, b, c] of [[OpCode.GETUP, 1, 0, 0], [OpCode.LOADK, 2, 0, 1], [OpCode.SETUP, 2, 0, 0], [OpCode.RET, 0, 1, 0]]) {
			childStarts.push(word); if (wide) writeInstruction(text, word++, OpCode.WIDE, 0, 0, 0);
			writeInstruction(text, word++, op, a, b, c);
		}
		writeInstruction(text, 64, OpCode.RET, 0, 1, 0);
		const image = linkRawTestSystemBlua32({ text, constants: [integerConstant(17), integerConstant(29)], functions: [{ firstWord: 0, wordCount: rootWords, maxStack: 8 },
			{ firstWord: 32, wordCount: word - 32, maxStack: 4, staticClosure: false, upvalueDescs: [{ inStack: true, index: 4 }] },
			{ firstWord: 64, wordCount: 1 }],
			closureRelocations: [{ wordIndex: closureBody, functionIndex: 2 }] });
		const { cpu } = createTestSystemCpu(image, backend), root = cpu.rootThread.currentFrame!, base = root.pc;
		const cells = new Uint32Array(1);
		const captured = seedTestCapturedClosure(cpu, image.symbols.functionAddresses[1], cells);
		root.registers.setClosure(0, captured);
		bindOpen(cpu.memory, cells[0], root.thread.address, root.stackBase + 4, 0);
		root.openUpvalueHead = cells[0];
		const cached = seedTestRomClosure(cpu, image.symbols.functionAddresses[2]);
		const charges = [2, 8, 32, 3, 2, 4, 16, 2, 2]; // Cached CLOSURE8; RET16 + zero receiving slots.
		const total = charges.reduce((a, b) => a + b, 0);
		cpu.runUntilDepth(0, total * 32);
		if (backend === CpuExecutionBackend.JavaScript) assert.ok(root.decodedPage!.compiledBlocks!.entries[(base & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]);
		for (let grant = 0; grant <= total; ++grant) {
			cpu.runUntilDepth(1, 100);
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], base);
			root.registers.setNil(4); root.registers.setNil(5); root.registers.setNil(6);
			assert.equal(cpu.runUntilDepth(0, grant), RunResult.Yielded);
			let remaining = grant, completed = 0;
			while (remaining > 0) remaining -= charges[completed++];
			assert.equal(cpu.instructionBudgetRemaining, remaining);
			assert.equal(cpu.getFrameDepth(), completed >= 3 && completed < 7 ? 2 : 1);
			const next = [rootStarts[0], rootStarts[1], rootStarts[2], ...childStarts, rootStarts[3], rootStarts[4], 0][completed];
			assert.equal(cpu.rootThread.currentFrame!.pc, base + next * INSTRUCTION_BYTES);
			assert.equal(root.registers.get(4), completed >= 6 ? valueInteger(29) : completed >= 1 ? valueInteger(17) : valueNil());
			assert.equal(root.registers.getClosure(0, cpu.gc), captured);
			assert.equal(root.registers.getTag(6), completed >= 2 ? ValueTag.Closure : ValueTag.Nil);
			if (completed >= 2) assert.equal(root.registers.getClosure(6, cpu.gc), cached);
			assert.equal(root.registers.get(5), completed >= 8 ? valueBool(true) : valueNil());
			if (completed >= 3 && completed < 7) {
				const r = cpu.rootThread.currentFrame!.registers;
				if (completed >= 4) assert.equal(r.get(1), valueInteger(17));
				if (completed >= 5) assert.equal(r.get(2), valueInteger(29));
			}
		}
	});
}


for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) for (const wide of [false, true]) {
	test(`reserved 10H traps without reading an operand (${backend}, WIDE=${wide})`, () => {
		const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
		const body = wide ? 1 : 0;
		if (wide) writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, body, 0x10, 63, 63, 63, 255);
		writeInstruction(text, body + 1, OpCode.K1, 0, 0, 0);
		writeInstruction(text, 32, OpCode.HALT, 0, 0, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [
			{ firstWord: 0, wordCount: body + 2, maxStack: 3 },
			{ firstWord: 32, wordCount: 1 },
		], exceptionFunctionIndex: 1 });
		const { cpu } = createTestSystemCpu(image, backend), frame = cpu.rootThread.frameAtDepth(0);
		const pc = frame.pc;
		cpu.rootThread.resizeStack(32); // Reserve the exception frame independently of the opcode.
		seedTestRomClosure(cpu, image.vectors.exceptionFunctionAddress);
		const before = cpu.heapAllocator.occupiedBytes();
		frame.registers.setInteger(0, 17);
		frame.registers.setInteger(1, 2);
		frame.registers.setInteger(2, 3);
		frame.top = 3;
		assert.equal(compiledBlockSupports(0x10, 63, 63), false);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, -1, 'one instruction-supply charge');
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
		assert.equal(cpu.readEpcWord(), pc, 'EPC points to WIDE, not the body');
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.heapAllocator.occupiedBytes(), before);
		assert.deepEqual([frame.registers.get(0), frame.registers.get(1), frame.registers.get(2)],
			[valueInteger(17), valueInteger(2), valueInteger(3)]);
	});
}

const changed = [OpCode.GETT, OpCode.GETI, OpCode.GETFIELD, OpCode.SETT, OpCode.SETI, OpCode.SETFIELD, OpCode.SELF,
	OpCode.CALL, OpCode.RET, 0x10, OpCode.CLOSURE, OpCode.GETUP, OpCode.SETUP, OpCode.GETSYS, OpCode.GETGL,
	OpCode.SETSYS, OpCode.SETGL, OpCode.LEN, OpCode.MOD, OpCode.POW];
for (const backend of [CpuExecutionBackend.Interpreter]) for (const wide of [false, true]) for (const op of changed) {
	test(`skipping work-class opcode ${op} charges neither body nor WIDE (${backend}, WIDE=${wide})`, () => {
		const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
		writeInstruction(text, 0, OpCode.EQ, 0, 4, 4);
		let word = 1; if (wide || op === OpCode.CLOSURE) writeInstruction(text, word++, OpCode.WIDE, 0, 0, 0);
		const body = word; writeInstruction(text, word++, op, 0, 0, 0);
		const marker = word; writeInstruction(text, word++, OpCode.KTRUE, 7, 0, 0);
		const jump = word; writeInstruction(text, word, OpCode.JMP, 0, 63, (-(word + 1)) & 63, 255); ++word;
		writeInstruction(text, 32, OpCode.RET, 0, 1, 0);
		const image = linkRawTestSystemBlua32({ text, constants: ['field'], globalNames: ['value'], systemGlobalNames: ['value'],
			functions: [{ firstWord: 0, wordCount: word, maxStack: 8 }, { firstWord: 32, wordCount: 1 }],
			closureRelocations: op === OpCode.CLOSURE ? [{ wordIndex: body, functionIndex: 1 }] : [] });
		const { cpu } = createTestSystemCpu(image, backend), frame = cpu.rootThread.currentFrame!, base = frame.pc;
		frame.registers.setInteger(4, 1); cpu.runUntilDepth(0, 96);
		if (backend === CpuExecutionBackend.JavaScript) assert.ok(frame.decodedPage!.compiledBlocks!.entries[(base & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]);
		for (let grant = 0; grant <= 6; ++grant) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], base); frame.registers.setNil(7);
			assert.equal(cpu.runUntilDepth(0, grant), RunResult.Yielded);
			const completed = (grant + 1) >> 1;
			assert.equal(cpu.instructionBudgetRemaining, grant - 2 * completed);
			assert.equal(frame.pc, base + [0, marker, jump, 0][completed] * INSTRUCTION_BYTES);
			assert.equal(frame.registers.get(0), valueNil()); assert.equal(frame.registers.get(7), completed >= 2 ? valueBool(true) : valueNil());
			assert.equal(cpu.getFrameDepth(), 1); assert.equal(cpu.readCauseWord(), 0);
		}
	});
}
