// start normalized-body-acceptable -- Value-folding helpers mirror opcode cases; sharing them would hide the rewrite intent.
import { isTruthyValue, OpCode, type Value } from '../../cpu/cpu';
import { MAX_SIGNED_BX, MIN_SIGNED_BX } from '../../cpu/instruction_format';
import { isStringValue, stringValueToString } from '../../memory/string/pool';
import type { Instruction, OptimizationContext } from './index';

export type ConstValue = {
	value: Value;
	constIndex: number;
};

export { isTruthyValue as isTruthy };

export const isConstPoolValue = (value: Value): boolean =>
	value === null || typeof value === 'boolean' || typeof value === 'number' || isStringValue(value);

export const getImmediateConstValue = (instruction: Instruction, context: OptimizationContext): ConstValue | null => {
	switch (instruction.op) {
		case OpCode.KNIL:
			return { value: null, constIndex: context.constIndex(null) };
		case OpCode.KFALSE:
			return { value: false, constIndex: context.constIndex(false) };
		case OpCode.KTRUE:
			return { value: true, constIndex: context.constIndex(true) };
		case OpCode.K0:
			return { value: 0, constIndex: context.constIndex(0) };
		case OpCode.K1:
			return { value: 1, constIndex: context.constIndex(1) };
		case OpCode.KM1:
			return { value: -1, constIndex: context.constIndex(-1) };
		case OpCode.KSMI:
			return { value: instruction.b, constIndex: context.constIndex(instruction.b) };
		default:
			return null;
	}
};
// end normalized-body-acceptable

export const replaceWithJump = (instruction: Instruction, target: number): void => {
	instruction.op = OpCode.JMP;
	instruction.a = 0;
	instruction.b = 0;
	instruction.c = 0;
	instruction.format = 'AsBx';
	instruction.rkMask = 0;
	instruction.target = target;
	instruction.callProtoIndex = null;
};

export const replaceWithMov = (instruction: Instruction, dst: number, src: number): void => {
	instruction.op = OpCode.MOV;
	instruction.a = dst;
	instruction.b = src;
	instruction.c = 0;
	instruction.format = 'ABC';
	instruction.rkMask = 0;
	instruction.target = null;
	instruction.callProtoIndex = null;
};

export const replaceWithConst = (instruction: Instruction, target: number, value: Value, context: OptimizationContext): ConstValue => {
	instruction.target = null;
	instruction.rkMask = 0;
	instruction.callProtoIndex = null;
	if (value === null) {
		instruction.op = OpCode.KNIL;
		instruction.a = target;
		instruction.b = 0;
		instruction.c = 0;
		instruction.format = 'ABC';
		return { value, constIndex: context.constIndex(null) };
	}
	if (typeof value === 'boolean') {
		instruction.op = value ? OpCode.KTRUE : OpCode.KFALSE;
		instruction.a = target;
		instruction.b = 0;
		instruction.c = 0;
		instruction.format = 'ABC';
		return { value, constIndex: context.constIndex(value) };
	}
	if (typeof value === 'number' && Number.isInteger(value)) {
		if (value === 0) {
			instruction.op = OpCode.K0;
			instruction.a = target;
			instruction.b = 0;
			instruction.c = 0;
			instruction.format = 'ABC';
			return { value, constIndex: context.constIndex(value) };
		}
		if (value === 1) {
			instruction.op = OpCode.K1;
			instruction.a = target;
			instruction.b = 0;
			instruction.c = 0;
			instruction.format = 'ABC';
			return { value, constIndex: context.constIndex(value) };
		}
		if (value === -1) {
			instruction.op = OpCode.KM1;
			instruction.a = target;
			instruction.b = 0;
			instruction.c = 0;
			instruction.format = 'ABC';
			return { value, constIndex: context.constIndex(value) };
		}
		if (value >= MIN_SIGNED_BX && value <= MAX_SIGNED_BX) {
			instruction.op = OpCode.KSMI;
			instruction.a = target;
			instruction.b = value;
			instruction.c = 0;
			instruction.format = 'ABx';
			return { value, constIndex: context.constIndex(value) };
		}
	}
	const constIndex = context.constIndex(value);
	instruction.op = OpCode.LOADK;
	instruction.a = target;
	instruction.b = constIndex;
	instruction.c = 0;
	instruction.format = 'ABx';
	return { value, constIndex };
};

export const evaluateUnary = (op: OpCode, value: Value): Value | null => {
	switch (op) {
		case OpCode.UNM:
			return -(value as number);
		case OpCode.BNOT:
			return ~(value as number);
		case OpCode.NOT:
			return !isTruthyValue(value);
		case OpCode.LEN:
			if (isStringValue(value)) {
				return value.codepointCount;
			}
			return null;
		default:
			return null;
	}
};

export const evaluateBinary = (op: OpCode, left: Value, right: Value): Value | null => {
	const leftNum = Number(left as number);
	const rightNum = Number(right as number);
	switch (op) {
		case OpCode.ADD:
			return leftNum + rightNum;
		case OpCode.SUB:
			return leftNum - rightNum;
		case OpCode.MUL:
			return leftNum * rightNum;
		case OpCode.DIV:
			return leftNum / rightNum;
		case OpCode.MOD:
			return leftNum % rightNum;
		case OpCode.FLOORDIV:
			return Math.floor(leftNum / rightNum);
		case OpCode.POW:
			return Math.pow(leftNum, rightNum);
		case OpCode.BAND:
			return leftNum & rightNum;
		case OpCode.BOR:
			return leftNum | rightNum;
		case OpCode.BXOR:
			return leftNum ^ rightNum;
		case OpCode.SHL:
			return leftNum << (rightNum & 31);
		case OpCode.SHR:
			return leftNum >> (rightNum & 31);
		default:
			return null;
	}
};

export const evaluateComparison = (op: OpCode, left: Value, right: Value): boolean | null => {
	switch (op) {
		case OpCode.EQ:
			return left === right;
		case OpCode.LT:
		case OpCode.LE: {
			const bothStrings = isStringValue(left) && isStringValue(right);
			if (bothStrings) {
				const leftText = stringValueToString(left);
				const rightText = stringValueToString(right);
				return op === OpCode.LT ? leftText < rightText : leftText <= rightText;
			}
			return op === OpCode.LT ? (left as number) < (right as number) : (left as number) <= (right as number);
		}
		default:
			return null;
	}
};
