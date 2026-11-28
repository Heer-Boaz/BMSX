import { EXT_A_BITS, EXT_B_BITS, EXT_BX_BITS, EXT_C_BITS, INSTRUCTION_BYTES, MAX_BX_BITS, MAX_OPERAND_BITS, instructionFieldExtraHashSlots, readInstructionWord, signExtend } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode, OPCODE_USES_BX, OPCODE_USES_DISP } from '../../../machine/ts/spec/blua32/opcode';

export type DecodedInstruction = {
	pc: number;
	op: OpCode;
	a: number;
	b: number;
	c: number;
	bx: number;
	sbx: number;
	rkBitsB: number;
	rkBitsC: number;
	disp: number;
	extraHashSlots: number;
};

const decodeInstruction = (code: Uint8Array, codeAddress: number, pc: number): DecodedInstruction => {
	const wordIndex = (pc - codeAddress) / INSTRUCTION_BYTES;
	const word = readInstructionWord(code, wordIndex);
	const ext = word >>> 24;
	const op = (word >>> 18) & 0x3f;
	const aLow = (word >>> 12) & 0x3f;
	const bLow = (word >>> 6) & 0x3f;
	const cLow = word & 0x3f;
	if (op === OpCode.WIDE) {
		const wideB = bLow;
		const hasWide = true;
		const nextWord = readInstructionWord(code, wordIndex + 1);
		const nextExt = nextWord >>> 24;
		const nextOp = (nextWord >>> 18) & 0x3f;
		const nextA = (nextWord >>> 12) & 0x3f;
		const nextB = (nextWord >>> 6) & 0x3f;
		const nextC = nextWord & 0x3f;
		const usesDisp = OPCODE_USES_DISP[nextOp] !== 0;
		const usesBx = !usesDisp && OPCODE_USES_BX[nextOp] !== 0;
		const extA = usesBx || usesDisp ? 0 : (nextExt >>> 6) & 0x3;
		const extB = usesBx || usesDisp ? 0 : (nextExt >>> 3) & 0x7;
		const extC = usesBx || usesDisp ? 0 : (nextExt & 0x7);
		const aShift = usesDisp ? MAX_OPERAND_BITS : MAX_OPERAND_BITS + (usesBx ? 0 : EXT_A_BITS);
		const bShift = usesDisp ? MAX_OPERAND_BITS : MAX_OPERAND_BITS + EXT_B_BITS;
		const cShift = usesDisp ? MAX_OPERAND_BITS : MAX_OPERAND_BITS + EXT_C_BITS;
		const a = (aLow << aShift) | (extA << MAX_OPERAND_BITS) | nextA;
		const b = (wideB << bShift) | (extB << MAX_OPERAND_BITS) | nextB;
		const c = (cLow << cShift) | (extC << MAX_OPERAND_BITS) | nextC;
		const bxLow = (nextB << 6) | nextC;
		const bxExt = usesBx ? nextExt : 0;
		const bx = (wideB << (MAX_BX_BITS + EXT_BX_BITS)) | (bxExt << MAX_BX_BITS) | bxLow;
		const sbxBits = MAX_BX_BITS + EXT_BX_BITS + (hasWide ? MAX_OPERAND_BITS : 0);
		const sbx = signExtend(bx, sbxBits);
		const rkBitsB = MAX_OPERAND_BITS + EXT_B_BITS + (hasWide ? MAX_OPERAND_BITS : 0);
		const rkBitsC = MAX_OPERAND_BITS + EXT_C_BITS + (hasWide ? MAX_OPERAND_BITS : 0);
		return {
			pc: pc + INSTRUCTION_BYTES,
			op: nextOp as OpCode,
			a,
			b,
			c,
			bx,
			sbx,
			rkBitsB,
			rkBitsC,
			disp: nextExt,
			extraHashSlots: nextOp === OpCode.SETFIELD ? instructionFieldExtraHashSlots(word, 2) : 0,
		};
	}
	const usesDisp = OPCODE_USES_DISP[op] !== 0;
	const usesBx = !usesDisp && OPCODE_USES_BX[op] !== 0;
	const extA = usesBx || usesDisp ? 0 : (ext >>> 6) & 0x3;
	const extB = usesBx || usesDisp ? 0 : (ext >>> 3) & 0x7;
	const extC = usesBx || usesDisp ? 0 : (ext & 0x7);
	const a = (extA << MAX_OPERAND_BITS) | aLow;
	const b = (extB << MAX_OPERAND_BITS) | bLow;
	const c = (extC << MAX_OPERAND_BITS) | cLow;
	const bxLow = (bLow << 6) | cLow;
	const bxExt = usesBx ? ext : 0;
	const bx = (bxExt << MAX_BX_BITS) | bxLow;
	const sbx = signExtend(bx, MAX_BX_BITS + EXT_BX_BITS);
	const rkBitsB = MAX_OPERAND_BITS + EXT_B_BITS;
	const rkBitsC = MAX_OPERAND_BITS + EXT_C_BITS;
	return {
		pc,
		op: op as OpCode,
		a,
		b,
		c,
		bx,
		sbx,
		rkBitsB,
		rkBitsC,
		disp: ext,
		extraHashSlots: 0,
	};
};

export const decodeBlua32InstructionAtPc = (
	code: Uint8Array,
	codeAddress: number,
	pc: number,
): DecodedInstruction => {
	if ((pc % INSTRUCTION_BYTES) !== 0) {
		throw new Error(`[Disassembler] Instruction pc ${pc} is not aligned.`);
	}
	if (pc < codeAddress || pc >= codeAddress + code.length) {
		throw new Error(`[Disassembler] Instruction pc ${pc} is out of bounds.`);
	}
	const wordIndex = (pc - codeAddress) / INSTRUCTION_BYTES;
	const word = readInstructionWord(code, wordIndex);
	const op = (word >>> 18) & 0x3f;
	if (op === OpCode.WIDE) {
		return decodeInstruction(code, codeAddress, pc);
	}
	if (wordIndex > 0) {
		const previous = readInstructionWord(code, wordIndex - 1);
		const previousOp = (previous >>> 18) & 0x3f;
		if (previousOp === OpCode.WIDE) {
			return decodeInstruction(code, codeAddress, pc - INSTRUCTION_BYTES);
		}
	}
	return decodeInstruction(code, codeAddress, pc);
};
