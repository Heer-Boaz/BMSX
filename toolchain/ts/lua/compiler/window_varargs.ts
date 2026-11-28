import { RegisterJumpMode, ValueMoveKind } from '../../../../machine/ts/spec/blua32/instruction_format';
import { decodeValueCount, OpCode } from '../../../../machine/ts/spec/blua32/opcode';
import type { Instruction } from './optimizer';
import { controlInstruction } from './window_instructions';

export const WINDOW_VARARG_SCRATCH_WORDS = 5;

type WindowVarargLayout = {
	bias: number;
	parameters: number;
	extras: { min: number; max: number };
	max: number;
	sealed: boolean;
	scratch: number;
	argumentCountSlot: number;
	argumentCount: number;
	publishesCount: boolean;
};

export function windowVarargRange(extras: WindowVarargLayout['extras'], skip: number): WindowVarargLayout['extras'] {
	return { min: Math.max(0, extras.min - skip), max: Math.max(0, extras.max - skip) };
}

/**
 * R0 holds the link and the bounded original tuple starts at R1. The
 * optional actual count follows it; locals and scratch don't alias it.
 */
export function lowerWindowVararg(
	instructions: Instruction[], origin: Instruction, layout: WindowVarargLayout,
	linkSlots: { instruction: number; slot: number }[], skip = 0,
): void {
	const { bias, parameters, extras, scratch, argumentCountSlot } = layout;
	if (origin.op === OpCode.ARGC) {
		instructions.push(argumentCountSlot === 0
			? controlInstruction(origin, OpCode.KSMI, origin.a + bias, layout.argumentCount)
			: controlInstruction(origin, OpCode.MOV, origin.a + bias, argumentCountSlot));
		return;
	}
	const returning = origin.op === OpCode.RET;
	const destination = returning ? 0 : origin.a + bias;
	const first = parameters + 1 + skip;
	const { min: minimum, max: maximum } = windowVarargRange(extras, skip);
	const requested = returning ? -1 : decodeValueCount(origin.b, -1);
	if (requested !== -1 || minimum === maximum) {
		const count = requested === -1 ? maximum : requested;
		const copied = Math.min(count, maximum);
		for (let slot = 0; slot < copied; ++slot)
			instructions.push(controlInstruction(origin, OpCode.MOV, destination + slot, first + slot));
		if (copied < count)
			instructions.push(controlInstruction(origin, OpCode.LOADNIL, destination + copied, count - copied));
		if (requested === -1)
			instructions.push(controlInstruction(origin, OpCode.MOV, destination + count, 0, ValueMoveKind.SetTopImmediate));
		return;
	}

	// Scratch lives in the initialized prefix, clear of the returned Values.
	const input = scratch, output = scratch + 1, limit = scratch + 2, one = scratch + 3, value = scratch + 4;
	const link = scratch + WINDOW_VARARG_SCRATCH_WORDS;
	instructions.push(controlInstruction(origin, OpCode.KSMI, input, first));
	instructions.push(controlInstruction(origin, OpCode.KSMI, output, destination));
	instructions.push(controlInstruction(origin, OpCode.MOV, limit, argumentCountSlot));
	instructions.push(controlInstruction(origin, OpCode.K1, one, 0));
	if (returning) {
		instructions.push(controlInstruction(origin, OpCode.MOV, link, 0));
		linkSlots.push({ instruction: instructions.length, slot: link });
	}
	const copy = instructions.length;
	instructions.push(controlInstruction(origin, OpCode.LE, 0, input, limit));
	const endCopy = controlInstruction(origin, OpCode.JMP, 0, 0);
	instructions.push(endCopy);
	instructions.push(controlInstruction(origin, OpCode.MOV, value, input, ValueMoveKind.ReadIndexed));
	instructions.push(controlInstruction(origin, OpCode.MOV, output, value, ValueMoveKind.WriteIndexed));
	instructions.push(controlInstruction(origin, OpCode.ADD, input, input, one));
	instructions.push(controlInstruction(origin, OpCode.ADD, output, output, one));
	instructions.push({ ...endCopy, target: copy });
	endCopy.target = instructions.length;

	const sealedEnd = returning ? (layout.sealed ? layout.max : 0) : destination + maximum;
	if (sealedEnd !== 0) {
		instructions.push(controlInstruction(origin, OpCode.MOV, input, output));
		instructions.push(controlInstruction(origin, OpCode.KSMI, limit, sealedEnd));
		instructions.push(controlInstruction(origin, OpCode.KNIL, value, 0));
		const clear = instructions.length;
		instructions.push(controlInstruction(origin, OpCode.LT, 0, input, limit));
		const endClear = controlInstruction(origin, OpCode.JMP, 0, 0);
		instructions.push(endClear);
		instructions.push(controlInstruction(origin, OpCode.MOV, input, value, ValueMoveKind.WriteIndexed));
		instructions.push(controlInstruction(origin, OpCode.ADD, input, input, one));
		instructions.push({ ...endClear, target: clear });
		endClear.target = instructions.length;
	}
	if (returning) {
		if (layout.publishesCount) instructions.push(controlInstruction(origin, OpCode.MOV, layout.max, output));
		instructions.push(controlInstruction(origin, OpCode.JREG, link, 0, RegisterJumpMode.Jump));
		linkSlots.push({ instruction: instructions.length, slot: 0 });
	}
	else instructions.push(controlInstruction(origin, OpCode.MOV, 0, output, ValueMoveKind.SetTop));
}
