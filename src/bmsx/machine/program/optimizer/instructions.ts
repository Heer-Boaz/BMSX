import { OpCode } from '../cpu/cpu';
import type { Instruction } from './optimizer';

const RK_B = 1;

export const isRegisterOperand = (instruction: Instruction, rkBit: number, operand: number): boolean =>
	(instruction.rkMask & rkBit) === 0 || operand >= 0;

const lastRegisterInRange = (base: number, count: number): number => base + Math.max(count - 1, 0);

export const cloneInstruction = (instruction: Instruction): Instruction => ({
	op: instruction.op,
	a: instruction.a,
	b: instruction.b,
	c: instruction.c,
	format: instruction.format,
	rkMask: instruction.rkMask,
	target: instruction.target,
	callProtoIndex: instruction.callProtoIndex,
});

export const computeMaxRegister = (instructions: Instruction[]): number => {
	let maxRegister = 0;
	const updateMax = (register: number): void => {
		if (register > maxRegister) {
			maxRegister = register;
		}
	};
	for (const instruction of instructions) {
		switch (instruction.op) {
			case OpCode.KNIL:
			case OpCode.KFALSE:
			case OpCode.KTRUE:
			case OpCode.K0:
			case OpCode.K1:
			case OpCode.KM1:
			case OpCode.KSMI:
			case OpCode.LOADK:
			case OpCode.LOADNIL:
			case OpCode.LOADBOOL:
			case OpCode.GETG:
			case OpCode.GETSYS:
			case OpCode.GETGL:
			case OpCode.GETI:
			case OpCode.GETFIELD:
			case OpCode.NEWT:
			case OpCode.CLOSURE:
			case OpCode.GETUP:
				updateMax(instruction.a);
				break;
			case OpCode.SETG:
			case OpCode.SETSYS:
			case OpCode.SETGL:
			case OpCode.SETUP:
			case OpCode.TEST:
			case OpCode.JMPIF:
			case OpCode.JMPIFNOT:
			case OpCode.BR_TRUE:
			case OpCode.BR_FALSE:
			case OpCode.LOAD_MEM:
				updateMax(instruction.a);
				if (instruction.op === OpCode.LOAD_MEM && isRegisterOperand(instruction, RK_B, instruction.b)) {
					updateMax(instruction.b);
				}
				break;
			case OpCode.STORE_MEM_WORDS:
				updateMax(instruction.a);
				updateMax(lastRegisterInRange(instruction.a, instruction.c));
				if (isRegisterOperand(instruction, RK_B, instruction.b)) {
					updateMax(instruction.b);
				}
				break;
			case OpCode.MOV:
			case OpCode.UNM:
			case OpCode.NOT:
			case OpCode.LEN:
			case OpCode.BNOT:
				updateMax(instruction.a);
				updateMax(instruction.b);
				break;
			case OpCode.ADD:
			case OpCode.SUB:
			case OpCode.MUL:
			case OpCode.DIV:
			case OpCode.MOD:
			case OpCode.FLOORDIV:
			case OpCode.POW:
			case OpCode.BAND:
			case OpCode.BOR:
			case OpCode.BXOR:
			case OpCode.SHL:
			case OpCode.SHR:
			case OpCode.CONCAT:
			case OpCode.EQ:
			case OpCode.LT:
			case OpCode.LE:
			case OpCode.GETT:
			case OpCode.SETT:
				updateMax(instruction.a);
				if (instruction.b >= 0) {
					updateMax(instruction.b);
				}
				if (instruction.c >= 0) {
					updateMax(instruction.c);
				}
				break;
			case OpCode.SETI:
			case OpCode.SETFIELD:
				updateMax(instruction.a);
				if (instruction.c >= 0) {
					updateMax(instruction.c);
				}
				break;
			case OpCode.SELF:
				updateMax(instruction.a);
				updateMax(instruction.a + 1);
				updateMax(instruction.b);
				break;
			case OpCode.CONCATN:
				updateMax(instruction.a);
				updateMax(instruction.b);
				updateMax(lastRegisterInRange(instruction.b, instruction.c));
				break;
			case OpCode.TESTSET:
				updateMax(instruction.a);
				updateMax(instruction.b);
				break;
			case OpCode.VARARG:
				updateMax(instruction.a);
				updateMax(lastRegisterInRange(instruction.a, instruction.b));
				break;
			case OpCode.CALL:
			case OpCode.RET:
				updateMax(instruction.a);
				if (instruction.b > 0) {
					updateMax(instruction.a + instruction.b - 1);
				}
				if (instruction.op === OpCode.CALL && instruction.c > 0) {
					updateMax(instruction.a + instruction.c - 1);
				}
				break;
			case OpCode.STORE_MEM:
				updateMax(instruction.a);
				if (isRegisterOperand(instruction, RK_B, instruction.b)) {
					updateMax(instruction.b);
				}
				break;
			default:
				break;
		}
	}
	return maxRegister;
};

export const isPureInstruction = (instruction: Instruction): boolean => {
	switch (instruction.op) {
		case OpCode.MOV:
		case OpCode.KNIL:
		case OpCode.KFALSE:
		case OpCode.KTRUE:
		case OpCode.K0:
		case OpCode.K1:
		case OpCode.KM1:
		case OpCode.KSMI:
		case OpCode.LOADK:
		case OpCode.LOADNIL:
		case OpCode.NEWT:
		case OpCode.ADD:
		case OpCode.SUB:
		case OpCode.MUL:
		case OpCode.DIV:
		case OpCode.MOD:
		case OpCode.FLOORDIV:
		case OpCode.POW:
		case OpCode.BAND:
		case OpCode.BOR:
		case OpCode.BXOR:
		case OpCode.SHL:
		case OpCode.SHR:
		case OpCode.CONCAT:
		case OpCode.CONCATN:
		case OpCode.UNM:
		case OpCode.NOT:
		case OpCode.BNOT:
		case OpCode.CLOSURE:
		case OpCode.GETUP:
		case OpCode.VARARG:
			return true;
		case OpCode.LOADBOOL:
			return instruction.c === 0;
		default:
			return false;
	}
};

export const pushRegister = (registers: number[], register: number): void => {
	if (register >= 0) {
		registers.push(register);
	}
};

export const pushRegisterRange = (registers: number[], base: number, count: number): void => {
	for (let offset = 0; offset < count; offset += 1) {
		pushRegister(registers, base + offset);
	}
};
