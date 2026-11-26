import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLOSURE_ADDRESS_REGISTER_WIDE_C, INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';

function branchToCall(alternate: number, args = 1) {
	const text = new Uint8Array(12 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.JMPIFNOT, 0, 0, 3);
	writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 2, OpCode.CLOSURE, 1, 0, 0);
	writeInstruction(text, 3, OpCode.JMP, 0, 0, 2);
	writeInstruction(text, 4, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 5, OpCode.CLOSURE, 1, 0, 0);
	writeInstruction(text, 6, OpCode.CALL, 1, args, 2);
	writeInstruction(text, 7, OpCode.RET, 1, 2, 0);
	writeInstruction(text, 8, OpCode.K0, 0, 0, 0);
	writeInstruction(text, 9, OpCode.RET, 0, 2, 0);
	writeInstruction(text, 10, OpCode.K1, 0, 0, 0);
	writeInstruction(text, 11, OpCode.RET, 0, 2, 0);
	return linkRawTestSystemBlua32({
		text,
		verifiedControlFlow: true,
		functions: [
			{ firstWord: 0, wordCount: 8, numParams: 1, maxStack: 3 },
			{ firstWord: 8, wordCount: 2, maxStack: 4 },
			{ firstWord: 10, wordCount: 2, maxStack: 2 },
		],
		closureRelocations: [{ wordIndex: 2, functionIndex: 1 }, { wordIndex: 5, functionIndex: alternate }],
	}).image;
}

test('fixed stack follows the shared A+1 argument window across converging static edges', () => {
	assert.deepEqual(deriveBlua32FixedStack(branchToCall(1), [0]), { valueSlots: 6, frames: 2 });
});

test('fixed stack rejects ambiguous call targets and open transfers', () => {
	assert.throws(() => deriveBlua32FixedStack(branchToCall(2), [0]), /no single static callee/);
	assert.throws(() => deriveBlua32FixedStack(branchToCall(1, 0), [0]), /open call window/);
});

test('fixed stack rejects recursion and register-address CLOSURE', () => {
	const text = new Uint8Array(4 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.CLOSURE, 0, 0, 0);
	writeInstruction(text, 2, OpCode.CALL, 0, 1, 1);
	writeInstruction(text, 3, OpCode.RET, 0, 1, 0);
	const functions = [{ firstWord: 0, wordCount: 4, maxStack: 1 }];
	const recursive = linkRawTestSystemBlua32({
		text, functions, closureRelocations: [{ wordIndex: 1, functionIndex: 0 }], verifiedControlFlow: true,
	});
	assert.throws(() => deriveBlua32FixedStack(recursive.image, [0]), /Recursive fixed-stack function/);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, CLOSURE_ADDRESS_REGISTER_WIDE_C);
	const dynamic = linkRawTestSystemBlua32({ text, functions, verifiedControlFlow: true });
	assert.throws(() => deriveBlua32FixedStack(dynamic.image, [0]), /requires a local ROM function record/);
});
