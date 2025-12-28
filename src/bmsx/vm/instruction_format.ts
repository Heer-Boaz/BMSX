export const INSTRUCTION_BYTES = 3;

export const MAX_OP_BITS = 6;
export const MAX_OPERAND_BITS = 6;
export const MAX_BX_BITS = 12;

export const MAX_LOW_OPERAND = (1 << MAX_OPERAND_BITS) - 1;
export const MAX_LOW_BX = (1 << MAX_BX_BITS) - 1;
export const MAX_WIDE = (1 << MAX_OPERAND_BITS) - 1;

export const MAX_EXT_REGISTER = (MAX_WIDE << MAX_OPERAND_BITS) | MAX_LOW_OPERAND;
export const MAX_EXT_CONST = (MAX_WIDE << 5) | 0x1f;
export const MAX_EXT_BX = (MAX_WIDE << MAX_BX_BITS) | MAX_LOW_BX;


export function packInstructionWord(op: number, a: number, b: number, c: number): number {
	return ((op & 0x3f) << 18) | ((a & 0x3f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f);
}

export function writeInstruction(code: Uint8Array, index: number, op: number, a: number, b: number, c: number): void {
	const word = packInstructionWord(op, a, b, c);
	const offset = index * INSTRUCTION_BYTES;
	code[offset] = (word >>> 16) & 0xff;
	code[offset + 1] = (word >>> 8) & 0xff;
	code[offset + 2] = word & 0xff;
}

export function readInstructionWord(code: Uint8Array, index: number): number {
	const offset = index * INSTRUCTION_BYTES;
	return (code[offset] << 16) | (code[offset + 1] << 8) | code[offset + 2];
}
