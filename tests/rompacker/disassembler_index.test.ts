import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INSTRUCTION_BYTES, RegisterJumpMode, ValueMoveKind, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { describeBlua32InstructionAtPc, indexBlua32FunctionInstructions } from '../../toolchain/ts/rompack/disassembler';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';

test('function browsing indexes WIDE as one instruction and excludes neighbouring functions', () => {
	const text = new Uint8Array(5 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.RET, 0, 0, 0, 0);
	writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0, 0);
	writeInstruction(text, 2, OpCode.MOV, 1, 2, 0, 0);
	writeInstruction(text, 3, OpCode.RET, 0, 0, 0, 0);
	writeInstruction(text, 4, OpCode.RET, 0, 0, 0, 0);
	const { image } = linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 1 }, { firstWord: 1, wordCount: 3 }, { firstWord: 4, wordCount: 1 },
	] });
	const fn = image.functions[1];
	const addresses = indexBlua32FunctionInstructions(image, 1);
	assert.deepEqual([...addresses], [fn.codeAddress, fn.codeAddress + 2 * INSTRUCTION_BYTES]);
	assert.equal(describeBlua32InstructionAtPc(image, null, addresses[0]).op, OpCode.MOV);
	assert.equal(describeBlua32InstructionAtPc(image, null, addresses[1]).op, OpCode.RET);
	assert.deepEqual([...indexBlua32FunctionInstructions(image, 2)], [image.functions[2].codeAddress]);
});

test('register window disassembly distinguishes indirect lanes, frontier operands, and ignored registers', () => {
	const text = new Uint8Array(5 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.MOV, 1, 63, ValueMoveKind.ReadTop);
	writeInstruction(text, 1, OpCode.MOV, 1, 2, ValueMoveKind.ReadIndexed);
	writeInstruction(text, 2, OpCode.MOV, 1, 2, ValueMoveKind.WriteIndexed);
	writeInstruction(text, 3, OpCode.MOV, 63, 2, ValueMoveKind.SetTop);
	writeInstruction(text, 4, OpCode.JREG, 63, 2, RegisterJumpMode.LeaveWindowFromRegister);
	const { image } = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 5 }] });
	const instructions = [...indexBlua32FunctionInstructions(image, 0)].map(pc => describeBlua32InstructionAtPc(image, null, pc));
	assert.deepEqual(instructions.map(instruction => instruction.instructionText),
		['MOV r1, top', 'MOV r1, r[r2]', 'MOV r[r1], r2', 'MOV top, r2', 'JREG leave r2']);
	assert.deepEqual(instructions.map(instruction => instruction.operands.map(operand => operand.registerIndex)),
		[[1], [1, 2], [1, 2], [2], [2]]);
});
