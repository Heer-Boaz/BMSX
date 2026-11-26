import {
	BASE_OPERAND_A_BITS, BASE_OPERAND_BC_BITS, EXT_A_BITS, EXT_B_BITS, EXT_C_BITS, INSTRUCTION_BYTES,
	MAX_EXT_REGISTER_A, MAX_LOW_OPERAND, MAX_OPERAND_BITS, writeInstruction,
} from '../../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../../machine/ts/spec/blua32/opcode';

/** ABx spends the instruction extension on Bx; only WIDE adds bits to A. */
export const MAX_ABX_REGISTER_A = (1 << (2 * MAX_OPERAND_BITS)) - 1;

/**
 * Materialize an Integer in a high ABC register, without a spare slot or a
 * constant-pool index. For each binary digit, the running result holds either
 * x or ~x. Doubling ~x gives ~(2*x+1); doubling x gives 2*x. BNOT switches
 * between the two representations where the next digit requires it.
 */
export function encodeWideIntegerLoad(register: number, value: number, skipTarget: boolean): Uint8Array {
	if (register > MAX_EXT_REGISTER_A) throw new Error(`[FunctionBuilder] A operand exceeds range: ${register}`);
	const inverted = value < 0;
	const magnitude = inverted ? ~value : value;
	const first = 31 - Math.clz32(magnitude);
	const ops: OpCode[] = [first < 0 ? OpCode.K0 : OpCode.K1];
	let complement = false;
	for (let bit = first - 1; bit >= 0; --bit) {
		const one = ((magnitude >>> bit) & 1) !== 0;
		if (complement !== one) ops.push(OpCode.BNOT);
		ops.push(OpCode.ADD);
		complement = one;
	}
	if (complement !== inverted) ops.push(OpCode.BNOT);

	const wordCount = ops.length * 2;
	let cursor = 0;
	const branch = skipTarget && ops.length > 1;
	const bytes = new Uint8Array((wordCount + (branch ? 2 : 0)) * INSTRUCTION_BYTES);
	if (branch) {
		// An ISA skip skips one instruction, not a materialization. The first
		// jump enters the sequence; skipping that jump lands on the bypass.
		writeInstruction(bytes, cursor++, OpCode.JMP, 0, 0, 1);
		writeInstruction(bytes, cursor++, OpCode.JMP, 0, wordCount >>> MAX_OPERAND_BITS, wordCount & MAX_LOW_OPERAND);
	}
	const low = register & MAX_LOW_OPERAND;
	const wideA = register >>> BASE_OPERAND_A_BITS, wideBC = register >>> BASE_OPERAND_BC_BITS;
	const extA = ((register >>> MAX_OPERAND_BITS) & ((1 << EXT_A_BITS) - 1)) << (EXT_B_BITS + EXT_C_BITS);
	const extB = ((register >>> MAX_OPERAND_BITS) & ((1 << EXT_B_BITS) - 1)) << EXT_C_BITS;
	const extC = (register >>> MAX_OPERAND_BITS) & ((1 << EXT_C_BITS) - 1);
	for (const op of ops) {
		const read = op === OpCode.ADD || op === OpCode.BNOT;
		const double = op === OpCode.ADD;
		// ADD's signed 15-bit RK reads have the same positive register limit
		// as the 14-bit destination. BNOT reads only B.
		writeInstruction(bytes, cursor++, OpCode.WIDE, wideA, read ? wideBC : 0, double ? wideBC : 0);
		writeInstruction(bytes, cursor++, op, low, read ? low : 0, double ? low : 0,
			extA | (read ? extB : 0) | (double ? extC : 0));
	}
	return bytes;
}
