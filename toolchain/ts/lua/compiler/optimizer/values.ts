import { integerConstant, evaluateNumberUnary, evaluateNumberBinary, numberConstantValue, type NumberConstant } from '../../number';
import { LuaUnaryOperator, LuaBinaryOperator } from '../../syntax/ast';
// start normalized-body-acceptable -- Value-folding helpers mirror opcode cases; sharing them would hide the rewrite intent.
import { OpCode } from '../../../../../machine/ts/spec/blua32/opcode';
import { MAX_SIGNED_BX, MIN_SIGNED_BX } from '../../../../../machine/ts/spec/blua32/instruction_format';
import type { ProgramConstant } from '../program';
import type { Instruction, OptimizationContext } from './index';

export const enum ConstValueKind {
	Nil,
	Boolean,
	Number,
	String,
	Builtin,
}

export type ConstValue =
	| { kind: ConstValueKind.Nil; value: null; constIndex: number }
	| { kind: ConstValueKind.Boolean; value: boolean; constIndex: number }
	| { kind: ConstValueKind.Number; value: NumberConstant; constIndex: number }
	| { kind: ConstValueKind.String; value: string; constIndex: number }
	| { kind: ConstValueKind.Builtin; value: Extract<ProgramConstant, { kind: 'builtin' }>; constIndex: number };

export const constValueForOptimization = (value: ProgramConstant, constIndex: number): ConstValue => {
	switch (value) {
		case null:
			return { kind: ConstValueKind.Nil, value: null, constIndex };
		case false:
		case true:
			return { kind: ConstValueKind.Boolean, value, constIndex };
		default:
			if (typeof value === 'string') {
				return { kind: ConstValueKind.String, value, constIndex };
			}
			return value.kind === 'builtin' ? { kind: ConstValueKind.Builtin, value, constIndex }
				: { kind: ConstValueKind.Number, value, constIndex };
	}
};

export const constPoolValueForOptimization = (context: OptimizationContext, constIndex: number): ConstValue | null =>
	context.relocatedConstIndices.has(constIndex)
		? null
		: constValueForOptimization(context.constPool[constIndex], constIndex);

export const loadKConstValueForOptimization = (instruction: Instruction, context: OptimizationContext): ConstValue | null =>
	instruction.symbolicReloc === undefined ? constPoolValueForOptimization(context, instruction.b) : null;

export const readImmediateValue = (instruction: Instruction): ProgramConstant | undefined => {
	switch (instruction.op) {
		case OpCode.KNIL: return null;
		case OpCode.KFALSE: return false;
		case OpCode.KTRUE: return true;
		case OpCode.K0: return integerConstant(0);
		case OpCode.K1: return integerConstant(1);
		case OpCode.KSMI: return integerConstant(instruction.b);
		default: return undefined;
	}
};

export const getImmediateConstValue = (instruction: Instruction, context: OptimizationContext): ConstValue | null => {
	const value = readImmediateValue(instruction);
	return value === undefined ? null : constValueForOptimization(value, context.constIndex(value));
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
	instruction.symbolicReloc = undefined;
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
	instruction.symbolicReloc = undefined;
};

export const replaceWithConst = (instruction: Instruction, target: number, value: ProgramConstant, context: OptimizationContext): ConstValue => {
	instruction.target = null;
	instruction.rkMask = 0;
	instruction.callProtoIndex = null;
	instruction.symbolicReloc = undefined;
	const constant = constValueForOptimization(value, context.constIndex(value));
	switch (constant.kind) {
		case ConstValueKind.Nil:
			instruction.op = OpCode.KNIL;
			instruction.a = target;
			instruction.b = 0;
			instruction.c = 0;
			instruction.format = 'ABC';
			return constant;
		case ConstValueKind.Boolean:
			instruction.op = constant.value ? OpCode.KTRUE : OpCode.KFALSE;
			instruction.a = target;
			instruction.b = 0;
			instruction.c = 0;
			instruction.format = 'ABC';
			return constant;
		case ConstValueKind.String:
		case ConstValueKind.Builtin:
			instruction.op = OpCode.LOADK;
			instruction.a = target;
			instruction.b = constant.constIndex;
			instruction.c = 0;
			instruction.format = 'ABx';
			return constant;
		case ConstValueKind.Number:
			break;
	}
	if (constant.value.kind === 'integer') {
		const integer = constant.value.word | 0;
		if (integer === 0) {
			instruction.op = OpCode.K0;
			instruction.a = target;
			instruction.b = 0;
			instruction.c = 0;
			instruction.format = 'ABC';
			return constant;
		}
		if (integer === 1) {
			instruction.op = OpCode.K1;
			instruction.a = target;
			instruction.b = 0;
			instruction.c = 0;
			instruction.format = 'ABC';
			return constant;
		}
		if (integer >= MIN_SIGNED_BX && integer <= MAX_SIGNED_BX) {
			instruction.op = OpCode.KSMI;
			instruction.a = target;
			instruction.b = integer;
			instruction.c = 0;
			instruction.format = 'ABx';
			return constant;
		}
	}
	instruction.op = OpCode.LOADK;
	instruction.a = target;
	instruction.b = constant.constIndex;
	instruction.c = 0;
	instruction.format = 'ABx';
	return constant;
};

export const evaluateUnary = (op: OpCode, value: ConstValue): ProgramConstant | undefined => {
	switch (op) {
		case OpCode.UNM:
			return value.kind === ConstValueKind.Number ? evaluateNumberUnary(LuaUnaryOperator.Negate, value.value) : undefined;
		case OpCode.BNOT:
			return value.kind === ConstValueKind.Number ? evaluateNumberUnary(LuaUnaryOperator.BitwiseNot, value.value) : undefined;
		case OpCode.NOT:
			return value.kind === ConstValueKind.Nil
				|| (value.kind === ConstValueKind.Boolean && !value.value);
		case OpCode.LEN:
			return value.kind === ConstValueKind.String
				? integerConstant(value.value.length)
				: undefined;
		default:
			return undefined;
	}
};

const binaryOperators: Partial<Record<OpCode, LuaBinaryOperator>> = {
	[OpCode.ADD]: LuaBinaryOperator.Add, [OpCode.SUB]: LuaBinaryOperator.Subtract, [OpCode.MUL]: LuaBinaryOperator.Multiply,
	[OpCode.DIV]: LuaBinaryOperator.Divide, [OpCode.MOD]: LuaBinaryOperator.Modulus, [OpCode.FLOORDIV]: LuaBinaryOperator.FloorDivide,
	[OpCode.POW]: LuaBinaryOperator.Exponent, [OpCode.BAND]: LuaBinaryOperator.BitwiseAnd, [OpCode.BOR]: LuaBinaryOperator.BitwiseOr,
	[OpCode.BXOR]: LuaBinaryOperator.BitwiseXor, [OpCode.SHL]: LuaBinaryOperator.ShiftLeft, [OpCode.SHR]: LuaBinaryOperator.ShiftRight,
};
export const evaluateBinary = (op: OpCode, left: ConstValue, right: ConstValue): ProgramConstant | undefined => {
	if (left.kind !== ConstValueKind.Number || right.kind !== ConstValueKind.Number) return undefined;
	const operator = binaryOperators[op];
	return operator === undefined ? null : evaluateNumberBinary(operator, left.value, right.value);
};

export const evaluateComparison = (op: OpCode, left: ConstValue, right: ConstValue): boolean | null => {
	switch (op) {
		case OpCode.EQ:
			if (left.kind === ConstValueKind.Builtin)
				return right.kind === ConstValueKind.Builtin && left.value.word === right.value.word;
			return left.kind === ConstValueKind.Number && right.kind === ConstValueKind.Number
				? numberConstantValue(left.value) === numberConstantValue(right.value) : left.value === right.value;
		case OpCode.LT:
		case OpCode.LE:
			if (left.kind === ConstValueKind.Number && right.kind === ConstValueKind.Number) {
				return op === OpCode.LT
					? numberConstantValue(left.value) < numberConstantValue(right.value)
					: numberConstantValue(left.value) <= numberConstantValue(right.value);
			}
			if (left.kind === ConstValueKind.String && right.kind === ConstValueKind.String) {
				const order = left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
				return op === OpCode.LT
					? order < 0
					: order <= 0;
			}
			return null;
		default:
			return null;
	}
};
