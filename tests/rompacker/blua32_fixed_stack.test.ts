import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeLE32 } from '../../machine/ts/common/endian';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE } from '../../machine/ts/spec/blua32/image_format';
import {
	BASE_OPERAND_BC_BITS, INSTRUCTION_BYTES,
	MAX_LOW_OPERAND, MAX_OPERAND_BITS, RegisterJumpMode, ValueMoveKind, writeInstruction,
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
	writeInstruction(text, 2, OpCode.LOADK, 1, 0, 0);
	writeInstruction(text, 3, OpCode.JMP, 0, 0, 2);
	writeInstruction(text, 4, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 5, OpCode.LOADK, 1, 0, 1);
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
		constants: [integerConstant(0), integerConstant(0)],
		constValueRelocs: [
			{ constIndex: 0, kind: 'code_function', target: { kind: 'proto', protoIndex: 1 } },
			{ constIndex: 1, kind: 'code_function', target: { kind: 'proto', protoIndex: alternate } },
		],
	}).image;
}

test('fixed stack follows the shared A+1 argument window across converging static edges', () => {
	assert.deepEqual(deriveBlua32FixedStack(branchToCall(1), [0]), { valueSlots: 6, frames: 2 });
});

test('fixed stack rejects ambiguous call targets and open transfers', () => {
	assert.throws(() => deriveBlua32FixedStack(branchToCall(2), [0]), /no single static callee/);
	assert.throws(() => deriveBlua32FixedStack(branchToCall(1, 0), [0]), /open call window/);
});

test('fixed stack follows both linked register returns without allocating another frame', () => {
	const text = new Uint8Array(10 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.JMPIF, 0, 0, 3);
	writeInstruction(text, 1, OpCode.LOADK, 1, 0, 0);
	writeInstruction(text, 2, OpCode.JREG, 1, 1, 1);
	writeInstruction(text, 3, OpCode.RET, 0, 1, 0);
	writeInstruction(text, 4, OpCode.LOADK, 1, 0, 0);
	writeInstruction(text, 5, OpCode.JREG, 1, 1, 1);
	writeInstruction(text, 6, OpCode.RET, 0, 1, 0);
	writeInstruction(text, 7, OpCode.MOV, 2, 1, ValueMoveKind.Copy);
	writeInstruction(text, 8, OpCode.JREG, 2, 0, 0);
	writeInstruction(text, 9, OpCode.RET, 0, 1, 0);
	const { image } = linkRawTestSystemBlua32({
		text, verifiedControlFlow: true, constants: [integerConstant(0)],
		functions: [{ firstWord: 0, wordCount: 9, numParams: 1, maxStack: 3 }, { firstWord: 9, wordCount: 1, maxStack: 2 }],
	});
	const address = image.header.constantTableAddress - image.address + BLUA32_CONSTANT_PAYLOAD_OFFSET;
	writeLE32(image.bytes, address, image.functions[0].codeAddress + 7 * INSTRUCTION_BYTES);
	assert.deepEqual(deriveBlua32FixedStack(image, [0]), { valueSlots: 3, frames: 1 });
	for (const continuation of [3, 6]) {
		writeInstruction(image.textBytes, continuation, OpCode.RET, 3, 2, 0);
		assert.throws(() => deriveBlua32FixedStack(image, [0]), /return window exceeds/);
		writeInstruction(image.textBytes, continuation, OpCode.RET, 0, 1, 0);
	}
	writeInstruction(image.textBytes, 7, OpCode.K0, 2, 0, 0);
	assert.throws(() => deriveBlua32FixedStack(image, [0]), /no finite local target/);
	writeInstruction(image.textBytes, 7, OpCode.MOV, 2, 1, ValueMoveKind.Copy);
	writeLE32(image.bytes, address, image.functions[1].codeAddress);
	assert.throws(() => deriveBlua32FixedStack(image, [0]), /register link has not returned to the owning frame/);
});

test('linked TEXT uses one physical frame across nested register bases', () => {
	const text = new Uint8Array(10 * INSTRUCTION_BYTES);
	// The parent link remains in physical R2 while the nested leaf borrows R3 onward.
	writeInstruction(text, 0, OpCode.MOV, 63, 2, ValueMoveKind.AddBase);
	writeInstruction(text, 1, OpCode.JAL, 0, 0, 2);
	writeInstruction(text, 2, OpCode.MOV, 63, 62, ValueMoveKind.AddBase, 56);
	writeInstruction(text, 3, OpCode.RET, 0, 1, 0);
	writeInstruction(text, 4, OpCode.MOV, 63, 1, ValueMoveKind.AddBase);
	writeInstruction(text, 5, OpCode.JAL, 0, 0, 2);
	writeInstruction(text, 6, OpCode.MOV, 63, 63, ValueMoveKind.AddBase, 56);
	writeInstruction(text, 7, OpCode.JREG, 0, 0, RegisterJumpMode.Jump);
	writeInstruction(text, 8, OpCode.MOV, 2, 0, ValueMoveKind.Copy);
	writeInstruction(text, 9, OpCode.JREG, 2, 0, RegisterJumpMode.Jump);
	const { image } = linkRawTestSystemBlua32({ text, verifiedControlFlow: true,
		functions: [
			{ firstWord: 0, wordCount: 4, maxStack: 6 },
			{ firstWord: 4, wordCount: 4, maxStack: 4 },
			{ firstWord: 8, wordCount: 2, maxStack: 3 },
		] });
	assert.deepEqual(deriveBlua32FixedStack(image, [0]), { valueSlots: 6, frames: 1 });
	writeInstruction(image.textBytes, 8, OpCode.MOV, 3, 0, ValueMoveKind.Copy);
	assert.throws(() => deriveBlua32FixedStack(image, [0]), /destination exceeds the function record/);
	writeInstruction(image.textBytes, 8, OpCode.MOV, 2, 0, ValueMoveKind.Copy);
	writeInstruction(image.textBytes, 2, OpCode.MOV, 0, 61, ValueMoveKind.AddBase, 56);
	assert.throws(() => deriveBlua32FixedStack(image, [0]), /basis exceeds the admitted frame/);
});

test('fixed TEXT uses high link slots without changing the basis or clobbering the caller link', () => {
	const text = new Uint8Array(6 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.JAL, 1, 0, 1);
	writeInstruction(text, 1, OpCode.RET, 0, 1, 0);
	writeInstruction(text, 2, OpCode.JAL, 3, 0, 1);
	writeInstruction(text, 3, OpCode.JREG, 1, 0, RegisterJumpMode.Jump);
	writeInstruction(text, 4, OpCode.K1, 4, 0, 0);
	writeInstruction(text, 5, OpCode.JREG, 3, 0, RegisterJumpMode.Jump);
	const { image } = linkRawTestSystemBlua32({ text, verifiedControlFlow: true,
		functions: [
			{ firstWord: 0, wordCount: 2, maxStack: 5 },
			{ firstWord: 2, wordCount: 2, maxStack: 5 },
			{ firstWord: 4, wordCount: 2, maxStack: 5 },
		] });
	assert.deepEqual(deriveBlua32FixedStack(image, [0]), { valueSlots: 5, frames: 1 });
	writeInstruction(image.textBytes, 4, OpCode.K1, 1, 0, 0);
	assert.throws(() => deriveBlua32FixedStack(image, [0]), /no finite local target/);
	writeInstruction(image.textBytes, 4, OpCode.MOV, 1, 0, ValueMoveKind.SetTopImmediate);
	assert.throws(() => deriveBlua32FixedStack(image, [0]), /no finite local target/);
});

test('a finite linked register jump uses the same extent for each TEXT target', () => {
	const text = new Uint8Array(12 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.JMPIF, 0, 0, 2);
	writeInstruction(text, 1, OpCode.LOADK, 2, 0, 0);
	writeInstruction(text, 2, OpCode.JMP, 0, 0, 1);
	writeInstruction(text, 3, OpCode.LOADK, 2, 0, 1);
	writeInstruction(text, 4, OpCode.MOV, 0, 2, ValueMoveKind.AddBase);
	writeInstruction(text, 5, OpCode.JREG, 0, 0, RegisterJumpMode.Link);
	writeInstruction(text, 6, OpCode.MOV, 0, 62, ValueMoveKind.AddBase, 56);
	writeInstruction(text, 7, OpCode.RET, 0, 1, 0);
	for (const entry of [8, 10]) {
		writeInstruction(text, entry, OpCode.MOV, 1, 0, ValueMoveKind.Copy);
		writeInstruction(text, entry + 1, OpCode.JREG, 1, 0, RegisterJumpMode.Jump);
	}
	const { image } = linkRawTestSystemBlua32({ text, verifiedControlFlow: true,
		constants: [integerConstant(0), integerConstant(0)],
		functions: [
			{ firstWord: 0, wordCount: 8, numParams: 1, maxStack: 4 },
			{ firstWord: 8, wordCount: 2, maxStack: 2 },
			{ firstWord: 10, wordCount: 2, maxStack: 2 },
		] });
	const constants = image.header.constantTableAddress - image.address + BLUA32_CONSTANT_PAYLOAD_OFFSET;
	for (let i = 0; i < 2; ++i)
		writeLE32(image.bytes, constants + i * BLUA32_CONSTANT_RECORD_SIZE, image.functions[i + 1].codeAddress);
	assert.deepEqual(deriveBlua32FixedStack(image, [0]), { valueSlots: 4, frames: 1 });
	writeInstruction(image.textBytes, 5, OpCode.JREG, 0, 0, RegisterJumpMode.Jump);
	assert.throws(() => deriveBlua32FixedStack(image, [0]), /no finite local target/);
});

test('fixed stack rejects recursion and a call without a linked CodeFunction', () => {
	const text = new Uint8Array(4 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.LOADK, 0, 0, 0);
	writeInstruction(text, 2, OpCode.CALL, 0, 1, 1);
	writeInstruction(text, 3, OpCode.RET, 0, 1, 0);
	const functions = [{ firstWord: 0, wordCount: 4, maxStack: 1 }];
	const recursive = linkRawTestSystemBlua32({
		text, functions, constants: [integerConstant(0)], verifiedControlFlow: true,
		constValueRelocs: [{ constIndex: 0, kind: 'code_function', target: { kind: 'proto', protoIndex: 0 } }],
	});
	assert.throws(() => deriveBlua32FixedStack(recursive.image, [0]), /Recursive fixed-stack function/);
	const dynamic = linkRawTestSystemBlua32({ text, functions, constants: [integerConstant(0)], verifiedControlFlow: true });
	assert.throws(() => deriveBlua32FixedStack(dynamic.image, [0]), /no single static callee/);
});

function scalarInstruction(op: OpCode, b: number, c: number, ext = 0, constants: readonly ProgramConstant[] = []) {
	const text = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, op, 0, b, c, ext);
	writeInstruction(text, 1, OpCode.RET, 0, 1, 0);
	return linkRawTestSystemBlua32({ text, constants, verifiedControlFlow: true,
		functions: [{ firstWord: 0, wordCount: 2, numParams: 1, maxStack: 2 }] }).image;
}

test('fixed stack uses ordinary bus formats and permits the issuing context only as a direct read', () => {
	const ordinary = [MemoryAccessKind.Word, MemoryAccessKind.U8, MemoryAccessKind.U16LE, MemoryAccessKind.U32LE,
		MemoryAccessKind.F32LE, MemoryAccessKind.F64LE, MemoryAccessKind.Value];
	for (const op of [OpCode.LOAD_MEM, OpCode.LOAD_MEM_D, OpCode.STORE_MEM, OpCode.STORE_MEM_D]) {
		for (const kind of ordinary)
			assert.deepEqual(deriveBlua32FixedStack(scalarInstruction(op, 0, kind), [0]), { valueSlots: 2, frames: 1 });
		if (op !== OpCode.LOAD_MEM)
			assert.throws(() => deriveBlua32FixedStack(scalarInstruction(op, 0, MemoryAccessKind.ContextWord), [0]), /not an ordinary CPU memory format/);
	}
	assert.deepEqual(deriveBlua32FixedStack(scalarInstruction(OpCode.LOAD_MEM, 0, MemoryAccessKind.ContextWord), [0]),
		{ valueSlots: 2, frames: 1 });
});

test('fixed stack admits the ordinary scalar moves', () => {
	for (const kind of [ValueMoveKind.Copy, ValueMoveKind.FloatBits, ValueMoveKind.FloatFromBits, ValueMoveKind.Tag,
		ValueMoveKind.ReadIndexed, ValueMoveKind.WriteIndexed, ValueMoveKind.SetTop, ValueMoveKind.Payload])
		assert.deepEqual(deriveBlua32FixedStack(scalarInstruction(OpCode.MOV, 0, kind), [0]), { valueSlots: 2, frames: 1 });
	assert.deepEqual(deriveBlua32FixedStack(scalarInstruction(OpCode.MOV, 63, ValueMoveKind.ReadTop), [0]), { valueSlots: 2, frames: 1 });
	assert.throws(() => deriveBlua32FixedStack(scalarInstruction(OpCode.MOV, 0, ValueMoveKind.Payload + 1), [0]), /invalid register move format/);
});

test('indexed transfers preserve proved targets only when their physical lanes are known', () => {
	const text = new Uint8Array(7 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.LOADK, 0, 0, 0);
	writeInstruction(text, 1, OpCode.KSMI, 1, 0, 2);
	writeInstruction(text, 2, OpCode.MOV, 1, 0, ValueMoveKind.WriteIndexed);
	writeInstruction(text, 3, OpCode.MOV, 3, 1, ValueMoveKind.ReadIndexed);
	writeInstruction(text, 4, OpCode.MOV, 63, 1, ValueMoveKind.SetTop);
	writeInstruction(text, 5, OpCode.JREG, 3, 0, RegisterJumpMode.Jump);
	writeInstruction(text, 6, OpCode.RET, 0, 1, 0);
	const { image } = linkRawTestSystemBlua32({ text, verifiedControlFlow: true, constants: [integerConstant(0)],
		functions: [{ firstWord: 0, wordCount: 7, maxStack: 4 }] });
	writeLE32(image.bytes, image.header.constantTableAddress - image.address + BLUA32_CONSTANT_PAYLOAD_OFFSET,
		image.functions[0].codeAddress + 6 * INSTRUCTION_BYTES);
	assert.deepEqual(deriveBlua32FixedStack(image, [0]), { valueSlots: 4, frames: 1 });
	writeInstruction(image.textBytes, 1, OpCode.MOV, 1, 63, ValueMoveKind.ReadTop);
	writeInstruction(image.textBytes, 5, OpCode.JREG, 0, 0, RegisterJumpMode.Jump);
	assert.throws(() => deriveBlua32FixedStack(image, [0]), /no finite local target/);
});

test('fixed stack admits a WIDE immediate frontier at exactly the full window width', () => {
	const text = new Uint8Array(3 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.WIDE, 1, 0, 0);
	// B decodes as 511, outside the window; this mode does not read it.
	writeInstruction(text, 1, OpCode.MOV, 0, 63, ValueMoveKind.SetTopImmediate, 7 << 3);
	writeInstruction(text, 2, OpCode.RET, 0, 1, 0);
	const { image } = linkRawTestSystemBlua32({ text, verifiedControlFlow: true,
		functions: [{ firstWord: 0, wordCount: 3, maxStack: 256 }] });
	assert.deepEqual(deriveBlua32FixedStack(image, [0]), { valueSlots: 256, frames: 1 });

	writeInstruction(image.textBytes, 1, OpCode.MOV, 1, 63, ValueMoveKind.SetTopImmediate, 7 << 3);
	assert.throws(() => deriveBlua32FixedStack(image, [0]), /frontier exceeds the owning register window/);
});

test('an ordinary vector inspecting a tag does not retain a callable proof', () => {
	const text = new Uint8Array(6 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 1, OpCode.LOADK, 0, 0, 0);
	writeInstruction(text, 2, OpCode.MOV, 0, 0, ValueMoveKind.Tag);
	writeInstruction(text, 3, OpCode.CALL, 0, 1, 1);
	writeInstruction(text, 4, OpCode.RET, 0, 1, 0);
	writeInstruction(text, 5, OpCode.RET, 0, 1, 0);
	const { image } = linkRawTestSystemBlua32({
		text, verifiedControlFlow: true, constants: [integerConstant(0)],
		constValueRelocs: [{ constIndex: 0, kind: 'code_function', target: { kind: 'proto', protoIndex: 1 } }],
		functions: [{ firstWord: 0, wordCount: 5 }, { firstWord: 5, wordCount: 1 }],
	});
	assert.throws(() => deriveBlua32FixedStack(image, [0]), /no single static callee/);
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
