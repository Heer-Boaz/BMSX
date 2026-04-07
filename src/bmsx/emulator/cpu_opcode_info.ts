export const enum OpCode {
	WIDE,
	MOV,
	LOADK,
	LOADNIL,
	LOADBOOL,
	KNIL,
	KFALSE,
	KTRUE,
	K0,
	K1,
	KM1,
	KSMI,
	GETG,
	SETG,
	GETT,
	SETT,
	NEWT,
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
	CONCAT,
	CONCATN,
	UNM,
	NOT,
	LEN,
	BNOT,
	EQ,
	LT,
	LE,
	TEST,
	TESTSET,
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
	BR_TRUE,
	BR_FALSE,
	GETSYS,
	SETSYS,
	GETGL,
	SETGL,
	GETI,
	SETI,
	GETFIELD,
	SETFIELD,
	SELF,
}

export const OPCODE_COUNT = 64;

export const OPCODE = {
	WIDE: OpCode.WIDE,
	MOV: OpCode.MOV,
	LOADK: OpCode.LOADK,
	LOADNIL: OpCode.LOADNIL,
	LOADBOOL: OpCode.LOADBOOL,
	KNIL: OpCode.KNIL,
	KFALSE: OpCode.KFALSE,
	KTRUE: OpCode.KTRUE,
	K0: OpCode.K0,
	K1: OpCode.K1,
	KM1: OpCode.KM1,
	KSMI: OpCode.KSMI,
	GETG: OpCode.GETG,
	SETG: OpCode.SETG,
	GETT: OpCode.GETT,
	SETT: OpCode.SETT,
	NEWT: OpCode.NEWT,
	ADD: OpCode.ADD,
	SUB: OpCode.SUB,
	MUL: OpCode.MUL,
	DIV: OpCode.DIV,
	MOD: OpCode.MOD,
	FLOORDIV: OpCode.FLOORDIV,
	POW: OpCode.POW,
	BAND: OpCode.BAND,
	BOR: OpCode.BOR,
	BXOR: OpCode.BXOR,
	SHL: OpCode.SHL,
	SHR: OpCode.SHR,
	CONCAT: OpCode.CONCAT,
	CONCATN: OpCode.CONCATN,
	UNM: OpCode.UNM,
	NOT: OpCode.NOT,
	LEN: OpCode.LEN,
	BNOT: OpCode.BNOT,
	EQ: OpCode.EQ,
	LT: OpCode.LT,
	LE: OpCode.LE,
	TEST: OpCode.TEST,
	TESTSET: OpCode.TESTSET,
	JMP: OpCode.JMP,
	JMPIF: OpCode.JMPIF,
	JMPIFNOT: OpCode.JMPIFNOT,
	CLOSURE: OpCode.CLOSURE,
	GETUP: OpCode.GETUP,
	SETUP: OpCode.SETUP,
	VARARG: OpCode.VARARG,
	CALL: OpCode.CALL,
	RET: OpCode.RET,
	LOAD_MEM: OpCode.LOAD_MEM,
	STORE_MEM: OpCode.STORE_MEM,
	STORE_MEM_WORDS: OpCode.STORE_MEM_WORDS,
	BR_TRUE: OpCode.BR_TRUE,
	BR_FALSE: OpCode.BR_FALSE,
	GETSYS: OpCode.GETSYS,
	SETSYS: OpCode.SETSYS,
	GETGL: OpCode.GETGL,
	SETGL: OpCode.SETGL,
	GETI: OpCode.GETI,
	SETI: OpCode.SETI,
	GETFIELD: OpCode.GETFIELD,
	SETFIELD: OpCode.SETFIELD,
	SELF: OpCode.SELF,
} as const;

export const OPCODE_NAMES: ReadonlyArray<string> = [
	'WIDE',
	'MOV',
	'LOADK',
	'LOADNIL',
	'LOADBOOL',
	'KNIL',
	'KFALSE',
	'KTRUE',
	'K0',
	'K1',
	'KM1',
	'KSMI',
	'GETG',
	'SETG',
	'GETT',
	'SETT',
	'NEWT',
	'ADD',
	'SUB',
	'MUL',
	'DIV',
	'MOD',
	'FLOORDIV',
	'POW',
	'BAND',
	'BOR',
	'BXOR',
	'SHL',
	'SHR',
	'CONCAT',
	'CONCATN',
	'UNM',
	'NOT',
	'LEN',
	'BNOT',
	'EQ',
	'LT',
	'LE',
	'TEST',
	'TESTSET',
	'JMP',
	'JMPIF',
	'JMPIFNOT',
	'CLOSURE',
	'GETUP',
	'SETUP',
	'VARARG',
	'CALL',
	'RET',
	'LOAD_MEM',
	'STORE_MEM',
	'STORE_MEM_WORDS',
	'BR_TRUE',
	'BR_FALSE',
	'GETSYS',
	'SETSYS',
	'GETGL',
	'SETGL',
	'GETI',
	'SETI',
	'GETFIELD',
	'SETFIELD',
	'SELF',
	'OP_63',
];

export const BASE_CYCLES = new Uint8Array([
	0, 1, 1, 1, 1, 1, 1, 1,
	1, 1, 1, 1, 1, 2, 1, 2,
	1, 1, 1, 1, 1, 1, 1, 1,
	1, 1, 1, 1, 1, 1, 2, 1,
	1, 1, 1, 1, 1, 1, 1, 2,
	1, 1, 1, 1, 1, 2, 2, 2,
	2, 1, 2, 2, 1, 1, 1, 2,
	1, 2, 1, 2, 1, 2, 1, 1,
]);

export const OPCODE_CATEGORY: ReadonlyArray<string> = (() => {
	const categories = new Array<string>(OPCODE_COUNT).fill('?');

	for (const op of [OpCode.MOV, OpCode.LOADK, OpCode.LOADBOOL, OpCode.LOADNIL, OpCode.KNIL, OpCode.KFALSE, OpCode.KTRUE, OpCode.K0, OpCode.K1, OpCode.KM1, OpCode.KSMI]) {
		categories[op] = 'load/move';
	}
	for (const op of [OpCode.GETG, OpCode.SETG, OpCode.GETT, OpCode.SETT, OpCode.GETI, OpCode.SETI, OpCode.GETFIELD, OpCode.SETFIELD, OpCode.SELF]) {
		categories[op] = 'table get/set';
	}
	for (const op of [OpCode.GETGL, OpCode.SETGL, OpCode.GETSYS, OpCode.SETSYS]) {
		categories[op] = 'global/sys access';
	}
	for (const op of [OpCode.GETUP, OpCode.SETUP]) {
		categories[op] = 'upvalue';
	}
	for (const op of [OpCode.ADD, OpCode.SUB, OpCode.MUL, OpCode.DIV, OpCode.MOD, OpCode.FLOORDIV, OpCode.POW, OpCode.UNM]) {
		categories[op] = 'arithmetic';
	}
	for (const op of [OpCode.BAND, OpCode.BOR, OpCode.BXOR, OpCode.SHL, OpCode.SHR, OpCode.BNOT]) {
		categories[op] = 'bitwise';
	}
	for (const op of [OpCode.CONCAT, OpCode.CONCATN]) {
		categories[op] = 'string concat';
	}
	for (const op of [OpCode.EQ, OpCode.LT, OpCode.LE, OpCode.TEST, OpCode.TESTSET]) {
		categories[op] = 'comparison';
	}
	for (const op of [OpCode.JMP, OpCode.JMPIF, OpCode.JMPIFNOT, OpCode.BR_TRUE, OpCode.BR_FALSE]) {
		categories[op] = 'branch/jump';
	}
	for (const op of [OpCode.CALL, OpCode.RET]) {
		categories[op] = 'call/return';
	}
	for (const op of [OpCode.LOAD_MEM, OpCode.STORE_MEM, OpCode.STORE_MEM_WORDS]) {
		categories[op] = 'memory I/O';
	}

	categories[OpCode.WIDE] = 'wide prefix';
	categories[OpCode.CLOSURE] = 'closure creation';
	categories[OpCode.NEWT] = 'table creation';
	categories[OpCode.LEN] = 'length';
	categories[OpCode.NOT] = 'logical';
	categories[OpCode.VARARG] = 'vararg';

	return categories;
})();

export function getOpcodeName(opcode: number): string {
	return opcode >= 0 && opcode < OPCODE_NAMES.length ? OPCODE_NAMES[opcode] : `OP_${opcode}`;
}
