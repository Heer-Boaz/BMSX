import { RegisterJumpMode, ValueMoveKind } from '../../../../machine/ts/spec/blua32/instruction_format';
import { decodeValueCount, OpCode } from '../../../../machine/ts/spec/blua32/opcode';
import type { Instruction } from './optimizer';
import { controlInstruction } from './window_instructions';

export const WINDOW_VARARG_SCRATCH_WORDS = 5;

type WindowVarargLayout = {
	bias: number;
	parameters: number;
	extras: { min: number; max: number };
	maxResults: number;
	sealed: boolean;
	scratch: number;
};

/**
 * R0 holds the actual count; the original argument tuple starts at R1.
 * The compiler keeps its unused tail initialized through the admitted bound.
 * The callee's ordinary registers begin above this input area and its work
 * registers, so reading a variadic suffix never reads aliases of locals.
 */
export function lowerWindowVararg(
	instructions: Instruction[], origin: Instruction, layout: WindowVarargLayout, constantSkip?: number,
): void {
	const { bias, parameters, extras, scratch } = layout;
	if (origin.op === OpCode.ARGC) {
		instructions.push(controlInstruction(origin, OpCode.MOV, origin.a + bias, 0));
		return;
	}
	const returning = origin.op === OpCode.RET;
	const destination = returning ? 0 : origin.a + bias;
	const skip = returning ? constantSkip! : 0;
	const first = parameters + 1 + skip;
	const minimum = Math.max(0, extras.min - skip), maximum = Math.max(0, extras.max - skip);
	const requested = returning ? -1 : decodeValueCount(origin.b, -1);
	if (requested !== -1 || minimum === maximum) {
		const count = requested === -1 ? maximum : requested;
		const copied = Math.min(count, maximum);
		for (let slot = 0; slot < copied; ++slot)
			instructions.push(controlInstruction(origin, OpCode.MOV, destination + slot, first + slot));
		const initialized = returning && layout.sealed ? layout.maxResults : count;
		if (copied < initialized)
			instructions.push(controlInstruction(origin, OpCode.LOADNIL, destination + copied, initialized - copied));
		if (returning) instructions.push(controlInstruction(origin, OpCode.JREG, 0, count, RegisterJumpMode.LeaveWindow));
		else if (requested === -1) {
			instructions.push(controlInstruction(origin, OpCode.KSMI, scratch, destination + count));
			instructions.push(controlInstruction(origin, OpCode.MOV, 0, scratch, ValueMoveKind.SetTop));
		}
		return;
	}

	// Snapshot the actual count before a result can overwrite R0. All five
	// temporaries are inside the initialized prefix, not beyond the live top.
	const input = scratch, output = scratch + 1, limit = scratch + 2, one = scratch + 3, value = scratch + 4;
	instructions.push(controlInstruction(origin, OpCode.KSMI, input, first));
	instructions.push(controlInstruction(origin, OpCode.KSMI, output, destination));
	instructions.push(controlInstruction(origin, OpCode.MOV, limit, 0));
	instructions.push(controlInstruction(origin, OpCode.K1, one, 0));
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

	const sealedEnd = returning ? (layout.sealed ? layout.maxResults : 0) : destination + maximum;
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
	if (returning) instructions.push(controlInstruction(origin, OpCode.JREG, 0, output, RegisterJumpMode.LeaveWindowFromRegister));
	else instructions.push(controlInstruction(origin, OpCode.MOV, 0, output, ValueMoveKind.SetTop));
}
