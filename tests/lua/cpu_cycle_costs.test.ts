import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { createBuiltinFunction } from '../../machine/ts/machine/cpu/value';

import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { LUA_OUT_OF_MEMORY_SIGNAL } from '../../machine/ts/machine/cpu/errors';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { MAPPED_PAGE_BYTE_MASK } from '../../machine/ts/machine/memory/mapped_page';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { blua32TestFunctionAddress, createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { ValueTag, type Value } from '../../machine/ts/machine/cpu/value';

test('every executed opcode has the same additional instruction charge, not a WIDE-prefix charge', () => {
	const beforeFetchAllowance = [
		0, 1, 1, 1, 2, 1, 1, 1,
		1, 1, 1, 1, 2, 2, 3, 4,
		3, 1, 1, 1, 31, 33, 32, 127,
		1, 1, 1, 1, 1, 1, 2, 1,
		1, 2, 1, 1, 1, 1, 1, 1,
		1, 1, 1, 7, 2, 3, 2, 5,
		5, 2, 2, 2, 1, 1, 2, 3,
		2, 3, 3, 4, 3, 4, 4, 1,
	];
	assert.equal(BASE_CYCLES[OpCode.WIDE], 0);
	for (let op = 1; op < BASE_CYCLES.length; ++op) {
		assert.equal(BASE_CYCLES[op], beforeFetchAllowance[op] + 1, `opcode ${op}`);
	}
});

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
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
			const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: word, maxStack: quotient + 6 }] });
			const { cpu } = createTestSystemCpu(image, backend);
			const frame = cpu.rootThread.frameAtDepth(0), base = frame.pc;
			frame.registers.setNumber(3, 9); frame.registers.setNumber(4, -7); frame.registers.setNumber(5, 3);
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
				assert.equal(frame.registers.getTag(quotient), completed >= 2 ? ValueTag.Number : ValueTag.Nil);
				assert.equal(frame.registers.getTag(floor), completed >= 3 ? ValueTag.Number : ValueTag.Nil);
				if (completed >= 2) assert.ok(Object.is(frame.registers.getNumber(quotient), -7 / 3));
				if (completed >= 3) assert.equal(frame.registers.getNumber(floor), -3);
				assert.equal(frame.registers.getTag(2), completed >= 4 ? ValueTag.True : completed >= 1 ? ValueTag.Number : ValueTag.Nil);
			}
			for (const [left, right, divided, floored] of [[-0, 3, -0, -0], [1, 0, Infinity, Infinity], [0, 0, NaN, NaN], [Infinity, -2, -Infinity, -Infinity]]) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], base);
				frame.registers.setNumber(4, left); frame.registers.setNumber(5, right);
				assert.equal(cpu.runUntilDepth(0, 71), RunResult.Yielded);
				assert.equal(cpu.instructionBudgetRemaining, 0);
				assert.equal(frame.pc, base);
				assert.ok(Object.is(frame.registers.getNumber(quotient), divided));
				assert.ok(Object.is(frame.registers.getNumber(floor), floored));
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
			const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: word, maxStack: 258 }] });
			const { cpu } = createTestSystemCpu(image, backend);
			const frame = cpu.rootThread.frameAtDepth(0), base = frame.pc;
			frame.registers.setNumber(4, -7); frame.registers.setNumber(5, 3);
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
	assert.deepEqual(createBuiltinFunction(BuiltinFunctionId.Next).cost, { base: 1, perArg: 0, perRet: 0 });
	assert.deepEqual(createBuiltinFunction(BuiltinFunctionId.Error).cost, { base: 2, perArg: 0, perRet: 0 });
	assert.deepEqual(createBuiltinFunction(BuiltinFunctionId.PCall).cost, { base: 4, perArg: 0, perRet: 0 });
	assert.deepEqual(createBuiltinFunction(BuiltinFunctionId.StringChar).cost, { base: 2, perArg: 0, perRet: 0 });
});


for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
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
			const image = linkRawTestSystemBlua32({ text, constants: [17, 29], functions: [
				{ firstWord: 0, wordCount: 7, maxStack: 16 },
				{ firstWord: 7, wordCount: 1, numParams: 2, maxStack: 2 },
			], closureRelocations: [{ wordIndex: 1, functionAddress: blua32TestFunctionAddress(0, 1) }] });
			const { cpu } = createTestSystemCpu(image, backend);
			cpu.runUntilDepth(0, 1000);
			const produced = producedOperand === 0 ? 2 : producedOperand - 1;
			const placed = wantedOperand === 0 ? produced : wantedOperand - 1;
			for (const grant of [1, 2, 3, 2 + placed]) {
				cpu.runUntilDepth(1, 100);
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress + 2 * INSTRUCTION_BYTES);
				while (cpu.getFrameDepth() !== 2) cpu.runUntilDepth(0, 1);
				assert.equal(cpu.runUntilDepth(1, grant), RunResult.Halted);
				assert.equal(cpu.instructionBudgetRemaining, grant - BASE_CYCLES[OpCode.RET] - placed, 'the admitted RET completes atomically, including an overrun');
				const caller = cpu.rootThread.currentFrame!;
				assert.equal(caller.pc, image.image.functions[0].codeAddress + 6 * INSTRUCTION_BYTES);
				assert.equal(caller.top, 4 + placed);
				for (let i = 0; i < placed; ++i) assert.equal(caller.registers.get(4 + i), i < produced ? [17, 29][i] : null);
			}
		});
	}
	for (const producedOperand of [0, 1, 3]) {
		test(`root completion RET charges its produced range (${backend}, B=${producedOperand})`, () => {
			const text = new Uint8Array(3 * INSTRUCTION_BYTES);
			writeInstruction(text, 0, OpCode.LOADK, 0, 0, 0);
			writeInstruction(text, 1, OpCode.LOADK, 1, 0, 1);
			writeInstruction(text, 2, OpCode.RET, 0, producedOperand, 0);
			const image = linkRawTestSystemBlua32({ text, constants: [17, 29], functions: [{ firstWord: 0, wordCount: 3, maxStack: 2 }] });
			const { cpu } = createTestSystemCpu(image, backend);
			cpu.runUntilDepth(0, 2 * BASE_CYCLES[OpCode.LOADK]);
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Halted);
			const count = producedOperand === 0 ? 2 : producedOperand - 1;
			assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.RET] - count);
			const values: Value[] = []; cpu.readCompletionValues(values);
			assert.deepEqual(values, [17, 29].slice(0, count));
		});
	}
	for (const wanted of [0, 1, 2, 6, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.ramBytes + 1]) {
		test(`nested protected RET accounts each completed receiving range (${backend}, C=${wanted})`, () => {
			const text = new Uint8Array(7 * INSTRUCTION_BYTES);
			writeInstruction(text, 0, OpCode.GETSYS, 0, 0, 0);
			writeInstruction(text, 1, OpCode.GETSYS, 1, 0, 0);
			writeInstruction(text, 2, OpCode.WIDE, 0, 0, 0);
			writeInstruction(text, 3, OpCode.CLOSURE, 2, 0, 0);
			writeInstruction(text, 4, OpCode.CALL, 0, 3, 0);
			writeInstruction(text, 5, OpCode.JMP, 0, 63, 63, 255);
			writeInstruction(text, 6, OpCode.RET, 0, 3, 0);
			const image = linkRawTestSystemBlua32({ text, systemGlobalNames: ['pcall'], functions: [
				{ firstWord: 0, wordCount: 6, maxStack: 8 }, { firstWord: 6, wordCount: 1, maxStack: 2 },
			], closureRelocations: [{ wordIndex: 3, functionAddress: blua32TestFunctionAddress(0, 1) }] });
			const { cpu } = createTestSystemCpu(image, backend);
			cpu.setSystemGlobalByKey(cpu.stringPool.intern('pcall'), ValueTag.BuiltinFunction, BuiltinFunctionId.PCall, null);
			while (cpu.getFrameDepth() !== 2) cpu.runUntilDepth(0, 1);
			const thread = cpu.rootThread;
			assert.equal(thread.protectedCallDepth, 2);
			thread.currentFrame!.registers.setNumber(0, 17); thread.currentFrame!.registers.setNumber(1, 29);
			const failFirst = wanted === PSX_MACHINE_SPEC.ramBytes + 1;
			thread.protectedCallContinuations.peek(failFirst ? 1 : 0).returnCount = failFirst ? PSX_MACHINE_SPEC.ramBytes : wanted;
			const fault = wanted >= PSX_MACHINE_SPEC.ramBytes;
			if (fault) assert.throws(() => cpu.runUntilDepth(1, 2), error => error === LUA_OUT_OF_MEMORY_SIGNAL);
			else assert.equal(cpu.runUntilDepth(1, 2), RunResult.Halted);
			const outer = wanted === 0 ? 4 : wanted - 1;
			assert.equal(cpu.instructionBudgetRemaining, 2 - BASE_CYCLES[OpCode.RET] - (failFirst ? 0 : 3) - (fault ? 0 : outer), 'the inner status plus two values remains charged if outer admission throws');
			if (!fault) assert.deepEqual(Array.from({ length: outer }, (_, i) => thread.currentFrame!.registers.get(i)), [true, true, 17, 29, null].slice(0, outer));
		});
	}
}

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	for (const wanted of [0, 1, 2, 6]) test(`coroutine root RET counts status and selected receiver slots (${backend}, C=${wanted})`, () => {
		const text = new Uint8Array(9 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.GETSYS, 0, 0, 0);
		writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 2, OpCode.CLOSURE, 1, 0, 0);
		writeInstruction(text, 3, OpCode.CALL, 0, 2, 2);
		writeInstruction(text, 4, OpCode.GETSYS, 4, 0, 1);
		writeInstruction(text, 5, OpCode.MOV, 5, 0, 0);
		writeInstruction(text, 6, OpCode.CALL, 4, 2, wanted);
		writeInstruction(text, 7, OpCode.JMP, 0, 63, 63, 255);
		writeInstruction(text, 8, OpCode.RET, 0, 3, 0);
		const image = linkRawTestSystemBlua32({ text, systemGlobalNames: ['create', 'resume'], functions: [
			{ firstWord: 0, wordCount: 8, maxStack: 12 }, { firstWord: 8, wordCount: 1, maxStack: 2 },
		], closureRelocations: [{ wordIndex: 2, functionAddress: blua32TestFunctionAddress(0, 1) }] });
		const { cpu } = createTestSystemCpu(image, backend);
		cpu.setSystemGlobalByKey(cpu.stringPool.intern('create'), ValueTag.BuiltinFunction, BuiltinFunctionId.CoroutineCreate, null);
		cpu.setSystemGlobalByKey(cpu.stringPool.intern('resume'), ValueTag.BuiltinFunction, BuiltinFunctionId.CoroutineResume, null);
		while (cpu.activeThread === cpu.rootThread) cpu.runUntilDepth(0, 1);
		cpu.activeThread.currentFrame!.registers.setNumber(0, 17); cpu.activeThread.currentFrame!.registers.setNumber(1, 29);
		assert.equal(cpu.runUntilDepth(0, 2), RunResult.Yielded);
		const placed = wanted === 0 ? 3 : wanted - 1;
		assert.equal(cpu.instructionBudgetRemaining, 2 - BASE_CYCLES[OpCode.RET] - placed);
		assert.equal(cpu.activeThread, cpu.rootThread);
		assert.deepEqual(Array.from({ length: placed }, (_, i) => cpu.rootThread.currentFrame!.registers.get(4 + i)), [true, 17, 29, null, null].slice(0, placed));
	});

	test(`builtin CALL result placement charges copied and padded slots (${backend})`, () => {
		const text = new Uint8Array(5 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.GETSYS, 0, 0, 0);
		writeInstruction(text, 1, OpCode.LOADK, 1, 0, 0);
		writeInstruction(text, 2, OpCode.LOADK, 2, 0, 1);
		writeInstruction(text, 3, OpCode.CALL, 0, 3, 5);
		writeInstruction(text, 4, OpCode.JMP, 0, 63, 63, 255);
		const image = linkRawTestSystemBlua32({ text, constants: ['#', 17], systemGlobalNames: ['select'], functions: [{ firstWord: 0, wordCount: 5, maxStack: 8 }] });
		const { cpu } = createTestSystemCpu(image, backend);
		cpu.setSystemGlobalByKey(cpu.stringPool.intern('select'), ValueTag.BuiltinFunction, BuiltinFunctionId.Select, null);
		while (cpu.rootThread.currentFrame!.pc !== image.image.functions[0].codeAddress + 3 * INSTRUCTION_BYTES) cpu.runUntilDepth(0, 1);
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.CALL] - 1 - 4, 'CALL base, select tier and four placed slots');
		assert.deepEqual(Array.from({ length: 4 }, (_, i) => cpu.rootThread.currentFrame!.registers.get(i)), [1, null, null, null]);
	});

	test(`xpcall handler RET charges its error receiving range (${backend})`, () => {
		const text = new Uint8Array(12 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.GETSYS, 0, 0, 0);
		writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 2, OpCode.CLOSURE, 1, 0, 0);
		writeInstruction(text, 3, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, 4, OpCode.CLOSURE, 2, 0, 0);
		writeInstruction(text, 5, OpCode.CALL, 0, 3, 6);
		writeInstruction(text, 6, OpCode.JMP, 0, 63, 63, 255);
		writeInstruction(text, 7, OpCode.GETSYS, 0, 0, 1);
		writeInstruction(text, 8, OpCode.LOADK, 1, 0, 0);
		writeInstruction(text, 9, OpCode.CALL, 0, 2, 1);
		writeInstruction(text, 10, OpCode.RET, 0, 1, 0);
		writeInstruction(text, 11, OpCode.RET, 0, 2, 0);
		const image = linkRawTestSystemBlua32({ text, constants: [17], systemGlobalNames: ['xpcall', 'error'], functions: [
			{ firstWord: 0, wordCount: 7, maxStack: 8 }, { firstWord: 7, wordCount: 4, maxStack: 4 }, { firstWord: 11, wordCount: 1, numParams: 1, maxStack: 1 },
		], closureRelocations: [{ wordIndex: 2, functionAddress: blua32TestFunctionAddress(0, 1) }, { wordIndex: 4, functionAddress: blua32TestFunctionAddress(0, 2) }] });
		const { cpu } = createTestSystemCpu(image, backend);
		cpu.setSystemGlobalByKey(cpu.stringPool.intern('xpcall'), ValueTag.BuiltinFunction, BuiltinFunctionId.XPCall, null);
		cpu.setSystemGlobalByKey(cpu.stringPool.intern('error'), ValueTag.BuiltinFunction, BuiltinFunctionId.Error, null);
		while (cpu.activeThread.currentFrame!.functionAddress !== image.symbols.functionAddresses[2]) cpu.runUntilDepth(0, 1);
		assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.CALL] - 2 - 1, 'error CALL, error primitive and one handler argument placement');
		assert.equal(cpu.runUntilDepth(1, 1), RunResult.Halted);
		assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.RET] - 5);
		assert.deepEqual(Array.from({ length: 5 }, (_, i) => cpu.rootThread.currentFrame!.registers.get(i)), [false, 17, null, null, null]);
	});
}

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) test(`completion-latch RET charges its result range (${backend})`, () => {
	const text = new Uint8Array(4 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 0, 0, 0);
	writeInstruction(text, 2, OpCode.JMP, 0, 63, 63, 255);
	writeInstruction(text, 3, OpCode.RET, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 3, maxStack: 8 }, { firstWord: 3, wordCount: 1, numParams: 2, maxStack: 2 },
	], closureRelocations: [{ wordIndex: 1, functionAddress: blua32TestFunctionAddress(0, 1) }] });
	const { cpu } = createTestSystemCpu(image, backend);
	cpu.runUntilDepth(0, 1);
	const closure = cpu.rootThread.currentFrame!.registers.getClosure(0);
	for (let call = 0; call < 16; ++call) {
		cpu.beginCompletionCall(closure, [17, 29]);
		assert.equal(cpu.runUntilDepth(1, 1), RunResult.Halted);
		assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.RET] - 2);
		const values: Value[] = []; cpu.readCompletionValues(values);
		assert.deepEqual(values, [17, 29]);
	}
});
