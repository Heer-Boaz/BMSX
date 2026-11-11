import assert from 'node:assert/strict';
import test from 'node:test';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { BuiltinResults } from '../../machine/ts/machine/cpu/value_slots';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../machine/ts/spec/blua32/cop0';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	for (const op of [OpCode.CONCAT, OpCode.CONCATN, OpCode.LT, OpCode.LE, OpCode.EQ]) {
		test(`text work uses logical lengths on cold and compiled execution (${backend}, op=${op})`, () => {
			const text = new Uint8Array(4 * INSTRUCTION_BYTES);
			writeInstruction(text, 0, op, 0, 1, 2);
			for (let i = 1; i < 4; ++i) writeInstruction(text, i, OpCode.JMP, 0, 63, 63, 255);
			const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 4, maxStack: 8 }] });
			const { cpu } = createTestSystemCpu(image, backend);
			for (let repeat = 0; repeat < 24; ++repeat) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
				const frame = cpu.rootThread.currentFrame!;
				// Alternating unequal/equal interned operands also proves that intern
				// hits and comparison early-outs do not determine the cycle debit.
				const right = 'a😀雪\0';
				const left = repeat % 3 === 2 ? right : repeat % 3 === 1 ? 'a😀雪' : 'z😀雪';
				frame.registers.setStringId(1, cpu.stringPool.intern(left));
				frame.registers.setStringId(2, cpu.stringPool.intern(right));
				cpu.runUntilDepth(0, 1);
				const length = Array.from(left).length + Array.from(right).length;
				const cycles = op === OpCode.CONCAT ? 1 + length : op === OpCode.CONCATN ? 4 + length : op === OpCode.EQ ? 1 : 1 + Math.min(Array.from(left).length, Array.from(right).length);
				assert.equal(cpu.instructionBudgetRemaining, 1 - cycles);
				if (op === OpCode.CONCAT || op === OpCode.CONCATN) assert.equal(cpu.stringPool.toString(frame.registers.getStringId(0)), left + right);
				else {
					const matched = op === OpCode.LT ? left < right : op === OpCode.LE ? left <= right : left === right;
					assert.equal(frame.pc, image.image.functions[0].codeAddress + (matched ? 2 : 1) * INSTRUCTION_BYTES);
				}
			}
			if (backend === CpuExecutionBackend.JavaScript) assert.ok(cpu.rootThread.currentFrame!.decodedPage!.compiledBlocks, 'the warm cases actually compile');
		});
	}

	test(`select clips INT_MIN and materializes only demanded results (${backend})`, () => {
		const text = new Uint8Array(2 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.CALL, 0, 34, 2);
		writeInstruction(text, 1, OpCode.JMP, 0, 63, 63, 255);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 40 }] });
		const { cpu } = createTestSystemCpu(image, backend);
		const originalPush = BuiltinResults.prototype.push;
		let produced = 0;
		BuiltinResults.prototype.push = function (...args: Parameters<typeof originalPush>) { produced += 1; return originalPush.apply(this, args); };
		try {
			for (const selector of [-2147483648, 0, -32, -1, 1, 32, 33]) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
				const r = cpu.rootThread.currentFrame!.registers;
				r.setEncoded(0, ValueTag.BuiltinFunction, BuiltinFunctionId.Select, null);
				r.setNumber(1, selector);
				for (let i = 1; i <= 32; ++i) r.setNumber(i + 1, i);
				produced = 0; cpu.runUntilDepth(0, 1);
				assert.equal(r.get(0), selector === 33 ? null : selector === -1 || selector === 32 ? 32 : 1);
				assert.equal(produced, selector === 33 ? 0 : 1, 'fixed one-result consumers must not copy the unused suffix');
			}
		} finally { BuiltinResults.prototype.push = originalPush; }
	});

	for (const wanted of [0, 1, 2, 6]) test(`select preserves open, discarded and padded ranges (${backend}, C=${wanted})`, () => {
		const text = new Uint8Array(2 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.CALL, 0, 5, wanted);
		writeInstruction(text, 1, OpCode.JMP, 0, 63, 63, 255);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 8 }] });
		const { cpu } = createTestSystemCpu(image, backend), frame = cpu.rootThread.currentFrame!, r = frame.registers;
		r.setEncoded(0, ValueTag.BuiltinFunction, BuiltinFunctionId.Select, null);
		r.setNumber(1, -2147483648);
		for (let i = 0; i < 3; ++i) r.setNumber(i + 2, i + 10);
		cpu.runUntilDepth(0, 1);
		const count = wanted === 0 ? 3 : wanted - 1;
		assert.equal(frame.top, count);
		assert.deepEqual(Array.from({ length: count }, (_, i) => r.get(i)), [10, 11, 12, null, null].slice(0, count));
	});

	for (const selector of ['#', 'invalid']) test(`discarded select still validates its selector (${backend}, ${selector})`, () => {
		const text = new Uint8Array(2 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.CALL, 0, 2, 1);
		writeInstruction(text, 1, OpCode.JMP, 0, 63, 63, 255);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 8 }] });
		const { cpu } = createTestSystemCpu(image, backend), frame = cpu.rootThread.currentFrame!;
		frame.registers.setEncoded(0, ValueTag.BuiltinFunction, BuiltinFunctionId.Select, null);
		frame.registers.setStringId(1, cpu.stringPool.intern(selector));
		cpu.runUntilDepth(0, 1);
		if (selector === '#') assert.equal(frame.top, 0);
		else assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
	});

	for (const invalid of [false, true]) test(`string.char charges supplied codepoints even when results are ignored (${backend}, invalid=${invalid})`, () => {
		const text = new Uint8Array(2 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.CALL, 0, 4, 1);
		writeInstruction(text, 1, OpCode.JMP, 0, 63, 63, 255);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 8 }] });
		const { cpu } = createTestSystemCpu(image, backend), r = cpu.rootThread.currentFrame!.registers;
		r.setEncoded(0, ValueTag.BuiltinFunction, BuiltinFunctionId.StringChar, null);
		r.setNumber(1, invalid ? -1 : 65); r.setNumber(2, 0); r.setNumber(3, 0x1f600);
		cpu.runUntilDepth(0, 1);
		if (invalid) assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
		assert.equal(cpu.instructionBudgetRemaining, -6, 'CALL 2 + builtin 2 + three supplied codepoints');
	});
}
