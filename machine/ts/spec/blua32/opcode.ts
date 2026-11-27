export const INLINE_STRING_COMPARE_BYTES = 64;

export const enum OpCode {
	WIDE,
	MOV,
	LOADK,
	LOADNIL,
	LOAD_MEM_D,
	KNIL,
	KFALSE,
	KTRUE,
	K0,
	K1,
	ITERN,
	KSMI,
	STORE_MEM_D,
	STORE_MEM_WORDS_D,
	GETT,
	SETT,
	RESERVED_10,
	ADD,
	SUB,
	MUL,
	DIV,
	MOD,
	FLOORDIV,
	POW,
	BAND,
	BOR,
	BXOR,
	SHL,
	SHR,
	ARGC,
	RESERVED_1E,
	UNM,
	NOT,
	LEN,
	BNOT,
	EQ,
	LT,
	LE,
	MFC0,
	MTC0,
	JMP,
	JMPIF,
	JMPIFNOT,
	CLOSURE,
	GETUP,
	SETUP,
	VARARG,
	CALL,
	RET,
	LOAD_MEM,
	STORE_MEM,
	STORE_MEM_WORDS,
	RFE,
	LOADKR,
	GETSYS,
	SETSYS,
	GETGL,
	SETGL,
	GETI,
	SETI,
	GETFIELD,
	SETFIELD,
	SELF,
	HALT,
}

export const OPCODE_COUNT = 64;

// Select the next Table-valued __index target and test its own mapping.
// This semantic traversal stage does not fetch another instruction.
export const TABLE_INDEX_VISIT_CYCLES = 8;
// One logical own-integer presence test; no instruction-supply allowance.

export const encodeFixedValueCount = (count: number): number => count + 1;

export const decodeValueCount = (operand: number, openCount: number): number =>
	operand === 0 ? openCount : operand - 1;

// The base prices include a uniform cycle allowance for instruction supply.
// WIDE is a prefix, not a separately executed instruction.
export const BASE_CYCLES = new Uint8Array([
	0, 2, 2, 2, 3, 2, 2, 2,
	2, 2, 8, 2, 3, 3, 16, 16,
	2, 2, 2, 2, 32, 34, 33, 128,
	2, 2, 2, 2, 2, 2, 2, 2,
	2, 3, 2, 2, 2, 2, 2, 2,
	2, 2, 2, 8, 3, 4, 3, 32,
	16, 3, 3, 3, 2, 2, 3, 4,
	3, 4, 8, 8, 16, 16, 17, 2,
]);

export const OPCODE_USES_BX = new Uint8Array([
	0, 0, 1, 0, 0, 0, 0, 0,
	0, 0, 0, 1, 0, 0, 0, 0,
	0, 0, 0, 0, 0, 0, 0, 0,
	0, 0, 0, 0, 0, 0, 0, 0,
	0, 0, 0, 0, 0, 0, 0, 0,
	1, 1, 1, 1, 0, 0, 0, 0,
	0, 0, 0, 0, 0, 0, 1, 1,
	1, 1, 0, 0, 0, 0, 0, 0,
]);

export const OPCODE_USES_DISP = new Uint8Array([
	0, 0, 0, 0, 1, 0, 0, 0,
	0, 0, 0, 0, 1, 1, 0, 0,
	0, 0, 0, 0, 0, 0, 0, 0,
	0, 0, 0, 0, 0, 0, 0, 0,
	0, 0, 0, 0, 0, 0, 0, 0,
	0, 0, 0, 0, 0, 0, 0, 0,
	0, 0, 0, 0, 0, 0, 0, 0,
	0, 0, 0, 0, 0, 0, 0, 0,
]);

export const RK_OPERAND_B = 1;
export const RK_OPERAND_C = 2;
export const OPCODE_RK_OPERANDS = new Uint8Array([
	0, 0, 0, 0, 0, 0, 0, 0,
	0, 0, 0, 0, 0, 0, 2, 3,
	0, 3, 3, 3, 3, 3, 3, 3,
	3, 3, 3, 3, 3, 0, 0, 0,
	0, 0, 0, 3, 3, 3, 0, 0,
	0, 0, 0, 0, 0, 0, 0, 0,
	0, 1, 1, 1, 0, 0, 0, 0,
	0, 0, 0, 2, 0, 2, 0, 0,
]);

// Scalar register operands only; register/count ranges are interpreted by their operation.
export const REGISTER_OPERAND_A = 1;
export const REGISTER_OPERAND_B = 2;
export const REGISTER_OPERAND_C = 4;
export const OPCODE_SCALAR_REGISTER_READS = new Uint8Array([
	0, 2, 0, 0, 2, 0, 0, 0,
	0, 0, 1, 0, 3, 2, 6, 7,
	0, 6, 6, 6, 6, 6, 6, 6,
	6, 6, 6, 6, 6, 0, 0, 2,
	2, 2, 2, 6, 6, 6, 0, 1,
	0, 1, 1, 0, 0, 1, 0, 1,
	0, 2, 3, 2, 0, 2, 0, 1,
	0, 1, 2, 5, 2, 5, 2, 0,
]);
export const OPCODE_WRITES_REGISTER_A = new Uint8Array([
	0, 1, 1, 0, 1, 1, 1, 1,
	1, 1, 0, 1, 0, 0, 1, 0,
	0, 1, 1, 1, 1, 1, 1, 1,
	1, 1, 1, 1, 1, 1, 0, 1,
	1, 1, 1, 0, 0, 0, 1, 0,
	0, 0, 0, 1, 1, 0, 0, 0,
	0, 1, 0, 0, 0, 1, 1, 0,
	1, 0, 1, 0, 1, 0, 1, 0,
]);
