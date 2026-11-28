import { nativeHeapReference } from '../helpers/native_heap/reference';
import { setReferenceSystemGlobal } from '../helpers/global_bank_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { integerConstant } from '../../toolchain/ts/lua/number';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { BUILTIN_FUNCTIONS } from '../../machine/ts/machine/cpu/builtin_values';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { MAPPED_PAGE_BYTE_MASK } from '../../machine/ts/machine/memory/mapped_page';
import { seedTestRomClosure } from '../helpers/blua32';
import { createManagedTestOpcodeCpu, linkManagedTestOpcodes } from '../helpers/managed_opcode';
import { valueBool, valueBuiltinFunction, valueInteger, valueNil, ValueTag, type Value } from '../../machine/ts/machine/cpu/value';
import { runGuestToHalt } from '../helpers/cpu_test_harness';

test('all nominal opcode prices include instruction issue, while WIDE remains free', () => {
	const expected = [
		0, 2, 2, 2, 3, 2, 2, 2,
		2, 2, 8, 2, 3, 3, 16, 16,
		2, 2, 2, 2, 32, 34, 33, 128,
		2, 2, 2, 2, 2, 2, 3, 2,
		2, 3, 2, 2, 2, 2, 2, 2,
		2, 2, 2, 8, 3, 4, 3, 32,
		16, 3, 3, 3, 2, 2, 3, 4,
		3, 4, 8, 8, 16, 16, 17, 2,
	];
	assert.deepEqual([...BASE_CYCLES], expected);
});

for (const backend of [CpuExecutionBackend.Interpreter]) {
	for (const wide of [false, true]) {
		test(`fixed division budgets preserve every admission boundary and debt (${backend}, WIDE=${wide})`, () => {
			const text = new Uint8Array(7 * INSTRUCTION_BYTES);
			const quotient = wide ? 256 : 0, floor = quotient + 1;
			writeInstruction(text, 0, OpCode.MOV, 2, 3, 0);
			let word = 1;
			const divWord = word;
			if (wide) writeInstruction(text, word++, OpCode.WIDE, 1, 0, 0);
			writeInstruction(text, word++, OpCode.DIV, 0, 4, 5);
			const floorWord = word;
			if (wide) writeInstruction(text, word++, OpCode.WIDE, 1, 0, 0);
			writeInstruction(text, word++, OpCode.FLOORDIV, 1, 4, 5);
			const markerWord = word;
			writeInstruction(text, word++, OpCode.KTRUE, 2, 0, 0);
			const jumpWord = word;
			writeInstruction(text, word, OpCode.JMP, 0, 63, (-(word + 1)) & 63, 255);
			++word;
			const image = linkManagedTestOpcodes({ text, functions: [{ firstWord: 0, wordCount: word, maxStack: quotient + 6 }] });
			const { cpu } = createManagedTestOpcodeCpu(image, backend);
			const frame = cpu.rootThread.frameAtDepth(0), base = frame.pc;
			frame.registers.setInteger(3, 9); frame.registers.setInteger(4, -7); frame.registers.setInteger(5, 3);
			cpu.runUntilDepth(0, 7100);
			if (backend === CpuExecutionBackend.JavaScript) {
				const page = frame.decodedPage!;
				assert.ok(page.compiledBlocks!.entries[(base & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES], 'the measured loop really has generated code');
			}
			const boundaries = [0, divWord, floorWord, markerWord, jumpWord, 0];
			const charges = [2, 32, 33, 2, 2];
			for (let grant = 0; grant <= 71; ++grant) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], base);
				frame.registers.clear(1, quotient); frame.registers.clear(1, floor); frame.registers.clear(1, 2);
				assert.equal(cpu.runUntilDepth(0, grant), RunResult.Yielded);
				let remaining = grant, completed = 0;
				while (remaining > 0) remaining -= charges[completed++];
				assert.equal(cpu.instructionBudgetRemaining, remaining, `full admitted charge including debt at grant ${grant}`);
				assert.equal(frame.pc, base + boundaries[completed] * INSTRUCTION_BYTES, `next instruction at grant ${grant}`);
				assert.equal(frame.registers.getTag(quotient), completed >= 2 ? ValueTag.Float : ValueTag.Nil);
				assert.equal(frame.registers.getTag(floor), completed >= 3 ? ValueTag.Integer : ValueTag.Nil);
				if (completed >= 2) assert.ok(Object.is(frame.registers.getFloat(quotient), Math.fround(-7 / 3)));
				if (completed >= 3) assert.equal(frame.registers.getInteger(floor), -3);
				assert.equal(frame.registers.getTag(2), completed >= 4 ? ValueTag.True : completed >= 1 ? ValueTag.Integer : ValueTag.Nil);
			}
			for (const [left, right, divided, floored] of [[-0, 3, -0, -0], [1, 0, Infinity, Infinity], [0, 0, NaN, NaN], [Infinity, -2, -Infinity, -Infinity]]) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], base);
				frame.registers.setFloat(4, left); frame.registers.setFloat(5, right);
				assert.equal(cpu.runUntilDepth(0, 71), RunResult.Yielded);
				assert.equal(cpu.instructionBudgetRemaining, 0);
				assert.equal(frame.pc, base);
				assert.equal(frame.registers.getTag(quotient), ValueTag.Float);
				assert.equal(frame.registers.getTag(floor), ValueTag.Float);
				assert.ok(Object.is(frame.registers.getFloat(quotient), divided));
				assert.ok(Object.is(frame.registers.getFloat(floor), floored));
			}
		});
		test(`skipped division bodies pay no execution budget (${backend}, WIDE=${wide})`, () => {
			const text = new Uint8Array(7 * INSTRUCTION_BYTES);
			let word = 0;
			writeInstruction(text, word++, OpCode.EQ, 0, 4, 4);
			if (wide) writeInstruction(text, word++, OpCode.WIDE, 1, 0, 0);
			writeInstruction(text, word++, OpCode.DIV, 0, 4, 5);
			const second = word;
			writeInstruction(text, word++, OpCode.EQ, 0, 4, 4);
			if (wide) writeInstruction(text, word++, OpCode.WIDE, 1, 0, 0);
			writeInstruction(text, word++, OpCode.FLOORDIV, 1, 4, 5);
			const jump = word;
			writeInstruction(text, word, OpCode.JMP, 0, 63, (-(word + 1)) & 63, 255);
			++word;
			const image = linkManagedTestOpcodes({ text, functions: [{ firstWord: 0, wordCount: word, maxStack: 258 }] });
			const { cpu } = createManagedTestOpcodeCpu(image, backend);
			const frame = cpu.rootThread.frameAtDepth(0), base = frame.pc;
			frame.registers.setInteger(4, -7); frame.registers.setInteger(5, 3);
			cpu.runUntilDepth(0, 600);
			if (backend === CpuExecutionBackend.JavaScript) assert.ok(frame.decodedPage!.compiledBlocks!.entries[(base & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]);
			for (let grant = 0; grant <= 6; ++grant) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], base);
				assert.equal(cpu.runUntilDepth(0, grant), RunResult.Yielded);
				const completed = (grant + 1) >> 1;
				assert.equal(cpu.instructionBudgetRemaining, grant - 2 * completed);
				assert.equal(frame.pc, base + [0, second, jump, 0][completed] * INSTRUCTION_BYTES);
				assert.equal(frame.registers.getTag(wide ? 256 : 0), ValueTag.Nil);
				assert.equal(frame.registers.getTag(wide ? 257 : 1), ValueTag.Nil);
			}
		});
	}
}

test('builtin cost resolution uses fixed VM primitive tiers', () => {
	assert.deepEqual(BUILTIN_FUNCTIONS[BuiltinFunctionId.Next].cost, { base: 1, perArg: 0, perRet: 0 });
	assert.deepEqual(BUILTIN_FUNCTIONS[BuiltinFunctionId.Error].cost, { base: 2, perArg: 0, perRet: 0 });
});


for (const backend of [CpuExecutionBackend.Interpreter]) {
	for (const [producedOperand, wantedOperand] of [[1, 0], [3, 1], [3, 2], [2, 5], [0, 0]]) {
		test(`RET charges selected result slots including padding (${backend}, B=${producedOperand}, C=${wantedOperand})`, () => {
			const text = new Uint8Array(8 * INSTRUCTION_BYTES);
			writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
			writeInstruction(text, 1, OpCode.CLOSURE, 0, 0, 0);
			writeInstruction(text, 2, OpCode.MOV, 4, 0, 0);
			writeInstruction(text, 3, OpCode.LOADK, 5, 0, 0);
			writeInstruction(text, 4, OpCode.LOADK, 6, 0, 1);
			writeInstruction(text, 5, OpCode.CALL, 4, 3, wantedOperand);
			writeInstruction(text, 6, OpCode.JMP, 0, 63, 59, 255);
			writeInstruction(text, 7, OpCode.RET, 0, producedOperand, 0);
			const image = linkManagedTestOpcodes({ text, constants: [integerConstant(17), integerConstant(29)], functions: [
				{ firstWord: 0, wordCount: 7, maxStack: 16 },
				{ firstWord: 7, wordCount: 1, numParams: 2, maxStack: 2 },
			], closureRelocations: [{ wordIndex: 1, functionIndex: 1 }] });
			const { cpu } = createManagedTestOpcodeCpu(image, backend);
			seedTestRomClosure(cpu, image.symbols.functionAddresses[1]);
			cpu.runUntilDepth(0, 1000);
			const produced = producedOperand === 0 ? 2 : producedOperand - 1;
			const placed = wantedOperand === 0 ? produced : wantedOperand - 1;
			for (const grant of [1, 2, 3, 2 + placed]) {
				cpu.runUntilDepth(1, 100);
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress + 2 * INSTRUCTION_BYTES);
				for (let grant = 0; grant < 32 && (cpu.getFrameDepth() !== 2); ++grant) cpu.runUntilDepth(0, 1);
				assert.ok(!(cpu.getFrameDepth() !== 2), 'fixture reached its measured instruction');
				assert.equal(cpu.runUntilDepth(1, grant), RunResult.Halted);
				assert.equal(cpu.instructionBudgetRemaining, grant - BASE_CYCLES[OpCode.RET] - placed, 'the admitted RET completes atomically, including an overrun');
				const caller = cpu.rootThread.currentFrame!;
				assert.equal(caller.pc, image.image.functions[0].codeAddress + 6 * INSTRUCTION_BYTES);
				assert.equal(caller.top, 4 + placed);
				for (let i = 0; i < placed; ++i) assert.equal(caller.registers.get(4 + i), i < produced ? valueInteger([17, 29][i]) : valueNil());
			}
		});
	}
	for (const producedOperand of [0, 1, 3]) {
		test(`root completion RET charges its produced range (${backend}, B=${producedOperand})`, () => {
			const text = new Uint8Array(3 * INSTRUCTION_BYTES);
			writeInstruction(text, 0, OpCode.LOADK, 0, 0, 0);
			writeInstruction(text, 1, OpCode.LOADK, 1, 0, 1);
			writeInstruction(text, 2, OpCode.RET, 0, producedOperand, 0);
			const image = linkManagedTestOpcodes({ text, constants: [integerConstant(17), integerConstant(29)], functions: [{ firstWord: 0, wordCount: 3, maxStack: 2 }] });
			const { cpu } = createManagedTestOpcodeCpu(image, backend);
			cpu.runUntilDepth(0, 2 * BASE_CYCLES[OpCode.LOADK]);
			runGuestToHalt(cpu, 1);
			const count = producedOperand === 0 ? 2 : producedOperand - 1;
			assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.RET] - count);
			const values: Value[] = []; cpu.readCompletionValues(values);
			assert.deepEqual(values, [valueInteger(17), valueInteger(29)].slice(0, count));
		});
	}
}

for (const backend of [CpuExecutionBackend.Interpreter]) {
	test(`builtin CALL result placement charges copied and padded slots (${backend})`, () => {
		const text = new Uint8Array(5 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.GETSYS, 0, 0, 0);
		writeInstruction(text, 1, OpCode.LOADK, 1, 0, 0);
		writeInstruction(text, 2, OpCode.LOADK, 2, 0, 1);
		writeInstruction(text, 3, OpCode.CALL, 0, 3, 5);
		writeInstruction(text, 4, OpCode.JMP, 0, 63, 63, 255);
		const image = linkManagedTestOpcodes({ text, constants: [integerConstant(17), integerConstant(29)], systemGlobalNames: ['tointeger'], functions: [{ firstWord: 0, wordCount: 5, maxStack: 8 }] });
		const { cpu } = createManagedTestOpcodeCpu(image, backend);
		setReferenceSystemGlobal(cpu, nativeHeapReference(cpu).stringPool.intern('tointeger'), valueBuiltinFunction(BuiltinFunctionId.ToInteger));
		for (let grant = 0; grant < 32 && (cpu.rootThread.currentFrame!.pc !== image.image.functions[0].codeAddress + 3 * INSTRUCTION_BYTES); ++grant) cpu.runUntilDepth(0, 1);
		assert.ok(!(cpu.rootThread.currentFrame!.pc !== image.image.functions[0].codeAddress + 3 * INSTRUCTION_BYTES), 'fixture reached its measured instruction');
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.CALL] - 1 - 4, 'CALL base, builtin tier and four placed slots');
		assert.deepEqual(Array.from({ length: 4 }, (_, i) => cpu.rootThread.currentFrame!.registers.get(i)), [valueInteger(17), valueNil(), valueNil(), valueNil()]);
	});

}

for (const backend of [CpuExecutionBackend.Interpreter]) test(`completion-latch RET charges its result range (${backend})`, () => {
	const text = new Uint8Array(4 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 0, 0, 0);
	writeInstruction(text, 2, OpCode.JMP, 0, 63, 63, 255);
	writeInstruction(text, 3, OpCode.RET, 0, 0, 0);
	const image = linkManagedTestOpcodes({ text, functions: [
		{ firstWord: 0, wordCount: 3, maxStack: 8 }, { firstWord: 3, wordCount: 1, numParams: 2, maxStack: 2 },
	], closureRelocations: [{ wordIndex: 1, functionIndex: 1 }] });
	const { cpu } = createManagedTestOpcodeCpu(image, backend);
	seedTestRomClosure(cpu, image.symbols.functionAddresses[1]);
	cpu.runUntilDepth(0, 1);
	const closure = cpu.rootThread.currentFrame!.registers.getPayload(0);
	for (let call = 0; call < 16; ++call) {
		cpu.beginCompletionCall(closure, [valueInteger(17), valueInteger(29)]);
		assert.equal(cpu.runUntilDepth(1, 1), RunResult.Halted);
		assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.RET] - 2);
		const values: Value[] = []; cpu.readCompletionValues(values);
		assert.deepEqual(values, [valueInteger(17), valueInteger(29)]);
	}
});
