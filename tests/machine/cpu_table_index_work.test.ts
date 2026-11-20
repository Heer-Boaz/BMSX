import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { RunResult, type CPU } from '../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';

import { valueBuiltinFunction, valueBool, valueInteger, valueNil, valueTable, valueString, type Value } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_SIZE, MAPPED_PAGE_BYTE_MASK } from '../../machine/ts/machine/memory/mapped_page';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { LUA_FAULT_REASON_METATABLE_LOOP } from '../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

const forms = [[OpCode.GETFIELD, 'string'], [OpCode.SELF, 'string'], [OpCode.GETT, 'string'],
	[OpCode.GETI, 'number'], [OpCode.GETT, 'number'], [OpCode.GETT, 'boolean']] as const;

function readProgram(op: OpCode, wide: boolean, stringReceiver = false) {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE), starts: number[] = [];
	let word = 0;
	if (stringReceiver) writeInstruction(text, word++, OpCode.CALL, 20, 2, 1);
	for (const [code, a, b, c] of [[OpCode.MOV, 6, 0, 0], [op, 6, 6, op === OpCode.GETFIELD || op === OpCode.SELF ? 0 : 1],
		[OpCode.MOV, 8, 6, 0]]) {
		starts.push(word); if (wide) writeInstruction(text, word++, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, word++, code, a, b, c);
	}
	starts.push(word);
	writeInstruction(text, word, OpCode.JMP, 0, 63, (starts[0] - word - 1) & 63, 255);
	writeInstruction(text, 64, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, constants: ['field'], functions: [
		{ firstWord: 0, wordCount: word + 1, maxStack: 24 }, { firstWord: 64, wordCount: 1 }], exceptionFunctionIndex: 1 });
	return { image, starts };
}

function chain(cpu: CPU, root: number, depth: number, key: Value, value: Value): number {
	let current = root;
	for (let i = 1; i < depth; ++i) {
		const next = cpu.createTable(2, 2), meta = cpu.createTable(0, 1);
		cpu.gc.tables.setStringKey(meta, cpu.stringPool.intern('__index'), valueTable(next)); cpu.gc.tables.setMetatableAddress(current, meta); current = next;
	}
	cpu.gc.tables.set(current, key, value);
	return current;
}

for (const backend of [CpuExecutionBackend.Interpreter]) for (const wide of [false, true]) {
	test(`semantic inherited visits retain every grant frontier and aliased read (${backend}, WIDE=${wide})`, () => {
		for (const [op, kind] of forms) for (const depth of [1, 2, 5, 32]) {
			const { image, starts } = readProgram(op, wide), { cpu } = createTestSystemCpu(image, backend);
			let frame = cpu.rootThread.currentFrame!;
			const base = frame.pc, loop = base + starts[0] * INSTRUCTION_BYTES;
			const key = kind === 'string' ? valueString(cpu.stringPool.intern('field')) : kind === 'number' ? valueInteger(1) : valueBool(false);
			const root = cpu.createTable(2, 2); cpu.gc.tables.set(root, key, valueBool(false));
			frame.registers.setTable(0, root); frame.registers.set(1, key);
			const ownLoop = 2 + (op === OpCode.SELF ? 17 : op === OpCode.GETI ? 8 : 16) + 2 + 2;
			cpu.runUntilDepth(0, ownLoop * 64);
			if (backend === CpuExecutionBackend.JavaScript) assert.ok(frame.decodedPage!.compiledBlocks!.entries[(loop & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES]);
			cpu.gc.tables.set(root, key, valueNil()); chain(cpu, root, depth, key, valueBool(false));
			if (depth === 1) {
				const meta = cpu.createTable(0, 1); cpu.gc.tables.setStringKey(meta, cpu.stringPool.intern('__index'), valueTable(root)); cpu.gc.tables.setMetatableAddress(root, meta);
			}
			const lookup = (op === OpCode.SELF ? 17 : op === OpCode.GETI ? 8 : 16) + 8 * (depth - 1);
			const charges = [2, lookup, 2, 2], total = charges.reduce((a, b) => a + b, 0);
			const heap = cpu.luaHeap.usedBytes();
			for (let grant = 0; grant <= total; ++grant) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], loop);
				frame.registers.setInteger(6, 91); frame.registers.setNil(7); frame.registers.setInteger(8, 57);
				assert.equal(cpu.runUntilDepth(0, grant), RunResult.Yielded);
				let remaining = grant, completed = 0;
				while (remaining > 0) remaining -= charges[completed++];
				assert.equal(cpu.instructionBudgetRemaining, remaining, `${op}/${kind}/${depth}/${grant}: complete semantic debt`);
				assert.equal(frame.pc, base + starts[completed === 4 ? 0 : completed] * INSTRUCTION_BYTES);
				assert.equal(frame.registers.get(6), completed >= 2 ? valueBool(false) : completed === 1 ? valueTable(root) : valueInteger(91));
				assert.equal(frame.registers.get(8), completed >= 3 ? valueBool(false) : valueInteger(57), 'following marker obeys the inherited-read frontier');
				assert.equal(frame.registers.get(7), op === OpCode.SELF && completed >= 2 ? valueTable(root) : valueNil());
			}
			assert.equal(cpu.luaHeap.usedBytes(), heap, 'warm/cold hints and repeated reads allocate no guest storage');
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], loop);
			const memory = cpu.memory.captureSaveState(), saved = cpu.captureRuntimeState();
			cpu.runUntilDepth(0, 3); const debt = cpu.instructionBudgetRemaining, after = cpu.captureRuntimeState();
			cpu.memory.restoreSaveState(memory); cpu.restoreRuntimeState(saved); cpu.runUntilDepth(0, 3);
			frame = cpu.rootThread.currentFrame!;
			assert.equal(cpu.instructionBudgetRemaining, debt);
			assert.ok(isDeepStrictEqual(cpu.captureRuntimeState(), after), 'restore reproduces depth/work without derived slot-cache state');
		}
	});

	test(`attempted32 visits fault once without destination or following-instruction commit (${backend}, WIDE=${wide})`, () => {
		for (const [op, kind] of forms) for (const cyclic of [false, true]) {
			const { image, starts } = readProgram(op, wide), { cpu } = createTestSystemCpu(image, backend);
			const frame = cpu.rootThread.currentFrame!, base = frame.pc;
			const key = kind === 'string' ? valueString(cpu.stringPool.intern('field')) : kind === 'number' ? valueInteger(1) : valueBool(false);
			const root = cpu.createTable(2, 2); cpu.gc.tables.set(root, key, valueInteger(73));
			frame.registers.setTable(0, root); frame.registers.set(1, key);
			cpu.runUntilDepth(0, (2 + (op === OpCode.SELF ? 17 : op === OpCode.GETI ? 8 : 16) + 2 + 2) * 64);
			cpu.gc.tables.set(root, key, valueNil());
			if (cyclic) {
				const meta = cpu.createTable(0, 1); cpu.gc.tables.setStringKey(meta, cpu.stringPool.intern('__index'), valueTable(root)); cpu.gc.tables.setMetatableAddress(root, meta);
			} else chain(cpu, root, 33, key, valueInteger(73));
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], base);
			frame.registers.setInteger(8, 57);
			cpu.runUntilDepth(0, 3);
			assert.equal(3 - cpu.instructionBudgetRemaining, 2 + (op === OpCode.SELF ? 17 : op === OpCode.GETI ? 8 : 16) + 248);
			assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_METATABLE_LOOP);
			assert.equal(cpu.readEpcWord(), base + starts[1] * INSTRUCTION_BYTES, 'WIDE fault belongs to prefix start');
			assert.equal(frame.registers.get(6), valueTable(root), 'failed inherited read retains original aliased destination');
			assert.equal(frame.registers.getInteger(8), 57);
			if (op === OpCode.SELF) assert.equal(frame.registers.get(7), valueTable(root), 'SELF retains its preceding receiver publication');
		}
	});

	test(`String receiver starts at installed index Table and follows live prototype replacement (${backend}, WIDE=${wide})`, () => {
		const { image, starts } = readProgram(OpCode.GETFIELD, wide, true), { cpu } = createTestSystemCpu(image, backend);
		const frame = cpu.rootThread.currentFrame!, base = frame.pc, key = valueString(cpu.stringPool.intern('field'));
		const installed = cpu.createTable(0, 2); cpu.gc.tables.set(installed, key, valueInteger(19));
		frame.registers.set(20, valueBuiltinFunction(BuiltinFunctionId.SetStringIndex)); frame.registers.setTable(21, installed);
		frame.registers.set(0, valueString(cpu.stringPool.intern('receiver')));
		cpu.runUntilDepth(0, 7);
		assert.equal(frame.pc, base + INSTRUCTION_BYTES);
		cpu.runUntilDepth(0, 22 * 64);
		cpu.gc.tables.set(installed, key, valueNil()); chain(cpu, installed, 3, key, valueInteger(73));
		const loop = base + starts[0] * INSTRUCTION_BYTES;
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], loop);
		frame.registers.setInteger(8, 57); cpu.runUntilDepth(0, 3);
		assert.equal(cpu.instructionBudgetRemaining, 3 - 2 - 32);
		assert.equal(frame.registers.getInteger(6), 73); assert.equal(frame.registers.getInteger(8), 57);
		cpu.gc.tables.setStringKey(cpu.gc.tables.metatableAddress(installed), cpu.stringPool.intern('__index'), valueTable(cpu.createTable()));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], loop);
		cpu.runUntilDepth(0, 3);
		assert.equal(cpu.instructionBudgetRemaining, 3 - 2 - 24);
		assert.equal(frame.registers.get(6), valueNil(), 'missing terminal mapping is resolved nil, not a fault');
	});
}
