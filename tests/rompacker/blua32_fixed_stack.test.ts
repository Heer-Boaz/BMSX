import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	BASE_OPERAND_BC_BITS, CLOSURE_ADDRESS_REGISTER_WIDE_C, INSTRUCTION_BYTES,
	MAX_LOW_OPERAND, MAX_OPERAND_BITS, ValueMoveKind, writeInstruction,
} from '../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { integerConstant, numberConstantFromHost } from '../../toolchain/ts/lua/number';
import type { ProgramConstant } from '../../toolchain/ts/lua/compiler/program';
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

function scalarInstruction(op: OpCode, b: number, c: number, ext = 0, constants: readonly ProgramConstant[] = []) {
	const text = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, op, 0, b, c, ext);
	writeInstruction(text, 1, OpCode.RET, 0, 1, 0);
	return linkRawTestSystemBlua32({ text, constants, verifiedControlFlow: true,
		functions: [{ firstWord: 0, wordCount: 2, numParams: 1, maxStack: 2 }] }).image;
}

test('fixed stack admits only the service port memory formats', () => {
	for (const op of [OpCode.LOAD_MEM, OpCode.LOAD_MEM_D, OpCode.STORE_MEM, OpCode.STORE_MEM_D]) {
		for (const kind of [MemoryAccessKind.Word, MemoryAccessKind.U32LE, MemoryAccessKind.U8])
			assert.deepEqual(deriveBlua32FixedStack(scalarInstruction(op, 0, kind), [0]), { valueSlots: 2, frames: 1 });
		for (const kind of [MemoryAccessKind.U16LE, MemoryAccessKind.F32LE, MemoryAccessKind.F64LE])
			assert.throws(() => deriveBlua32FixedStack(scalarInstruction(op, 0, kind), [0]), /not a heap-service memory format/);
	}
});

test('fixed stack admits register copies but not Float reinterpretation', () => {
	assert.deepEqual(deriveBlua32FixedStack(scalarInstruction(OpCode.MOV, 0, ValueMoveKind.Copy), [0]), { valueSlots: 2, frames: 1 });
	for (const kind of [ValueMoveKind.FloatBits, ValueMoveKind.FloatFromBits])
		assert.throws(() => deriveBlua32FixedStack(scalarInstruction(OpCode.MOV, 0, kind), [0]), /not a scalar register copy/);
});

test('fixed stack checks the linked constant kind for LOADK and both signed RK lanes', () => {
	// All bits of the signed operand set encodes -1, i.e. linked constant 0.
	const rk = (1 << BASE_OPERAND_BC_BITS) - 1;
	const uses = [
		[OpCode.LOADK, 0, 0, 0],
		[OpCode.ADD, rk & MAX_LOW_OPERAND, 0, (rk >>> MAX_OPERAND_BITS) << 3],
		[OpCode.ADD, 0, rk & MAX_LOW_OPERAND, rk >>> MAX_OPERAND_BITS],
		[OpCode.FLOORDIV, 0, rk & MAX_LOW_OPERAND, rk >>> MAX_OPERAND_BITS],
	] as const;
	for (const [op, b, c, ext] of uses) {
		for (const constant of [null, false, true, integerConstant(-1)])
			assert.deepEqual(deriveBlua32FixedStack(scalarInstruction(op, b, c, ext, [constant]), [0]), { valueSlots: 2, frames: 1 });
		for (const constant of ['heap', numberConstantFromHost(1.5)])
			assert.throws(() => deriveBlua32FixedStack(scalarInstruction(op, b, c, ext, [constant]), [0]), /constant is not an Integer, nil or Boolean/);
		assert.throws(() => deriveBlua32FixedStack(scalarInstruction(op, b, c, ext), [0]), /constant index exceeds the linked pool/);
	}
});

test('fixed stack checks the constant index selected by a WIDE RK operand', () => {
	const constantIndex = 1 << (BASE_OPERAND_BC_BITS - 1);
	const operand = (1 << (BASE_OPERAND_BC_BITS + MAX_OPERAND_BITS)) - 1 - constantIndex;
	const low = operand & ((1 << BASE_OPERAND_BC_BITS) - 1);
	const text = new Uint8Array(3 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.WIDE, 0, operand >>> BASE_OPERAND_BC_BITS, 0);
	writeInstruction(text, 1, OpCode.ADD, 0, low & MAX_LOW_OPERAND, 0, (low >>> MAX_OPERAND_BITS) << 3);
	writeInstruction(text, 2, OpCode.RET, 0, 1, 0);
	const image = linkRawTestSystemBlua32({ text, verifiedControlFlow: true,
		constants: [...Array.from({ length: constantIndex }, (_, index) => integerConstant(index)), 'wide'],
		functions: [{ firstWord: 0, wordCount: 3, maxStack: 1 }] }).image;
	assert.throws(() => deriveBlua32FixedStack(image, [0]), /constant is not an Integer, nil or Boolean/);
});
