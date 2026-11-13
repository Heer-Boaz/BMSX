import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CompiledBlockExit, CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { Closure, type Upvalue } from '../../machine/ts/machine/cpu/closure';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { DYNAMIC_RAM_BASE, IO_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';

test('both open and closed upvalue paths define output-only region bindings', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.MOV, 8, 2, 0);
	writeInstruction(text, 1, OpCode.GETUP, 20, 0, 0);
	writeInstruction(text, 2, OpCode.JMP, 0, 0, 0);
	writeInstruction(text, 3, OpCode.MOV, 21, 20, 0);
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: 22 }] });
	const { cpu } = createTestSystemCpu(image, CpuExecutionBackend.JavaScript);
	const frame = cpu.rootThread.frameAtDepth(0), r = frame.registers;
	const upvalue: Upvalue = { hashId: 100, open: true, index: 8, frame,
		valueTag: ValueTag.Nil, valueScalar: NaN, valueReference: null, nextOpen: null };
	const bound = frame.closure;
	frame.closure = new Closure(bound.functionAddress, [upvalue], 0, bound.codeAddress,
		bound.numParams, bound.maxStack, bound.flags, bound.upvalueTableAddress, bound.executionDomainId, bound.recordUpvalueCount, false);
	cpu.runUntilDepth(0, 1024);
	const page = frame.decodedPage!, first = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const block = page.compiledBlocks!.entries[first]!;
	const other = { ...frame, registers: new ValueSlots(22) };
	const table = cpu.createTable(), string = cpu.stringPool.intern('upvalue');
	for (const source of ['own', 'other', 'closed']) for (const tag of [ValueTag.False, ValueTag.Number, ValueTag.String, ValueTag.Table]) {
		const scalar = tag === ValueTag.False ? 37 : tag === ValueTag.Number ? -0 : tag === ValueTag.String ? string : NaN;
		const reference = tag === ValueTag.Table ? table : null;
		upvalue.open = source !== 'closed'; upvalue.frame = source === 'own' ? frame : source === 'other' ? other : null;
		upvalue.valueTag = tag; upvalue.valueScalar = scalar; upvalue.valueReference = reference;
		other.registers.setEncoded(8, tag, scalar, reference);
		for (const grant of [1, 64]) {
			r.setEncoded(2, tag, scalar, reference);
			r.setNumber(8, 73); r.setNumber(20, 74); r.setNumber(21, 75);
			const state = { remainingCycles: grant, registerTop: 3, memoryAddress: 0 };
			block.region.execute(r, frame.executionImage.constScalars, page, frame, block.entry, state);
			for (const register of grant === 1 ? [8, 20] : [8, 20, 21]) {
				assert.equal(r.getTag(register), tag, `${source} upvalue tag R${register}`);
				assert.ok(Object.is(r.getScalar(register), scalar), `${source} upvalue raw scalar R${register}`);
				assert.equal(r.getReference(register), reference, `${source} upvalue reference R${register}`);
			}
			if (grant === 1) assert.equal(r.getNumber(21), 75, 'an unexecuted successor leaves its destination intact');
		}
	}
});

test('output locals become observable only after their definition, including helper continuations', () => {
	const text = new Uint8Array(MAPPED_PAGE_BYTE_SIZE);
	writeInstruction(text, 0, OpCode.LOAD_MEM, 0, 1, MemoryAccessKind.U32LE);
	writeInstruction(text, 1, OpCode.MOV, 20, 2, 0);
	writeInstruction(text, 2, OpCode.JMP, 0, 0, 0);
	writeInstruction(text, 3, OpCode.MOV, 21, 20, 0);
	writeInstruction(text, 4, OpCode.JMP, 0, 63, 59, 255);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5, maxStack: 22 }] });
	const { cpu, memory } = createTestSystemCpu(image, CpuExecutionBackend.JavaScript);
	const frame = cpu.rootThread.frameAtDepth(0);
	frame.registers.setNumber(1, DYNAMIC_RAM_BASE);
	cpu.runUntilDepth(0, 1024);
	const page = frame.decodedPage!, first = (image.image.functions[0].codeAddress & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const block = page.compiledBlocks!.entries[first]!;
	const old = cpu.createTable(), source = cpu.createTable();
	for (const mapped of [false, true]) for (const grant of [1, 64]) {
		const r = new ValueSlots(22);
		r.setEncoded(0, ValueTag.False, 37, null);
		r.setNumber(1, mapped ? DYNAMIC_RAM_BASE : IO_BASE);
		r.setTable(2, source); r.setTable(20, old);
		r.setNumber(21, -0);
		memory.writeMappedWord(DYNAMIC_RAM_BASE, 71);
		const writes = new Uint32Array(22), store = r.setEncoded.bind(r);
		r.setEncoded = (register, tag, scalar, reference) => { ++writes[register]; store(register, tag, scalar, reference); };
		const state = { remainingCycles: grant, registerTop: 3, memoryAddress: 0 };
		const exit = block.region.exits[block.region.execute(r, frame.executionImage.constScalars, page, frame, block.entry, state)];
		if (!mapped) {
			assert.equal(exit.exit, CompiledBlockExit.ReadMemory);
			assert.equal(r.getTag(0), ValueTag.False); assert.equal(r.getScalar(0), 37);
			assert.equal(r.getTable(20), old); assert.equal(writes[20], 0);
			assert.ok(Object.is(r.getNumber(21), -0)); assert.equal(state.registerTop, 3);
		} else {
			assert.equal(r.getNumber(0), 71); assert.equal(r.getTable(20), source);
			if (grant === 1) {
				assert.ok(Object.is(r.getNumber(21), -0)); assert.equal(state.registerTop, 21);
			} else {
				assert.equal(r.getTable(21), source); assert.equal(state.registerTop, 22);
			}
		}
	}
});
