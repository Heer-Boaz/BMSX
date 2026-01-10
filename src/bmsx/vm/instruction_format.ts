export const INSTRUCTION_BYTES = 4;

export const MAX_OP_BITS = 6;
export const MAX_OPERAND_BITS = 6;
export const MAX_BX_BITS = 12;

export const EXT_A_BITS = 2;
export const EXT_B_BITS = 3;
export const EXT_C_BITS = 3;
export const EXT_BX_BITS = 8;

export const MAX_LOW_OPERAND = (1 << MAX_OPERAND_BITS) - 1;
export const MAX_LOW_BX = (1 << MAX_BX_BITS) - 1;
export const MAX_WIDE = (1 << MAX_OPERAND_BITS) - 1;

export const MAX_BASE_OPERAND_A = (1 << (MAX_OPERAND_BITS + EXT_A_BITS)) - 1;
export const MAX_BASE_OPERAND_BC = (1 << (MAX_OPERAND_BITS + EXT_B_BITS)) - 1;
export const MAX_BASE_BX = (1 << (MAX_BX_BITS + EXT_BX_BITS)) - 1;

export const MAX_EXT_REGISTER_A = (MAX_WIDE << (MAX_OPERAND_BITS + EXT_A_BITS)) | MAX_BASE_OPERAND_A;
export const MAX_EXT_REGISTER_BC = (MAX_WIDE << (MAX_OPERAND_BITS + EXT_B_BITS)) | MAX_BASE_OPERAND_BC;
export const MAX_EXT_REGISTER = MAX_EXT_REGISTER_BC;
export const MAX_EXT_CONST = (1 << (MAX_OPERAND_BITS + EXT_B_BITS - 1)) - 1;
export const MAX_EXT_BX = (MAX_WIDE << (MAX_BX_BITS + EXT_BX_BITS)) | MAX_BASE_BX;


export function packInstructionWord(op: number, a: number, b: number, c: number, ext: number = 0): number {
	return ((ext & 0xff) << 24)
		| ((op & 0x3f) << 18)
		| ((a & 0x3f) << 12)
		| ((b & 0x3f) << 6)
		| (c & 0x3f);
}

export function writeInstruction(code: Uint8Array, index: number, op: number, a: number, b: number, c: number, ext: number = 0): void {
	const word = packInstructionWord(op, a, b, c, ext);
	const offset = index * INSTRUCTION_BYTES;
	code[offset] = (word >>> 24) & 0xff;
	code[offset + 1] = (word >>> 16) & 0xff;
	code[offset + 2] = (word >>> 8) & 0xff;
	code[offset + 3] = word & 0xff;
}

export function readInstructionWord(code: Uint8Array, index: number): number {
	const offset = index * INSTRUCTION_BYTES;
	return (code[offset] << 24)
		| (code[offset + 1] << 16)
		| (code[offset + 2] << 8)
		| code[offset + 3];
}
