import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
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
