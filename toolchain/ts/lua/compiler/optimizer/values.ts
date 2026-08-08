// start normalized-body-acceptable -- Value-folding helpers mirror opcode cases; sharing them would hide the rewrite intent.
import { OpCode } from '../../../../../machine/ts/spec/blua32/opcode';
import { MAX_SIGNED_BX, MIN_SIGNED_BX } from '../../../../../machine/ts/spec/blua32/instruction_format';
import { utf8CodepointCount, utf8Compare } from '../../../../../machine/ts/common/utf8';
import type { ProgramConstant } from '../program';
import type { Instruction, OptimizationContext } from './index';
import { luaFloorDivide, luaModulo } from '../../../../../machine/ts/spec/blua32/numeric';

export const enum ConstValueKind {
	Nil,
	Boolean,
	Number,
	String,
}

export type ConstValue =
	| { kind: ConstValueKind.Nil; value: null; constIndex: number }
	| { kind: ConstValueKind.Boolean; value: boolean; constIndex: number }
	| { kind: ConstValueKind.Number; value: number; constIndex: number }
	| { kind: ConstValueKind.String; value: string; constIndex: number };

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
			return { kind: ConstValueKind.Number, value, constIndex };
	}
};

export const constPoolValueForOptimization = (context: OptimizationContext, constIndex: number): ConstValue | null =>
	context.relocatedConstIndices.has(constIndex)
		? null
		: constValueForOptimization(context.constPool[constIndex], constIndex);

export const loadKConstValueForOptimization = (instruction: Instruction, context: OptimizationContext): ConstValue | null =>
	instruction.symbolicReloc === undefined ? constPoolValueForOptimization(context, instruction.b) : null;

export const getImmediateConstValue = (instruction: Instruction, context: OptimizationContext): ConstValue | null => {
	switch (instruction.op) {
		case OpCode.KNIL:
			return constValueForOptimization(null, context.constIndex(null));
		case OpCode.KFALSE:
			return constValueForOptimization(false, context.constIndex(false));
		case OpCode.KTRUE:
			return constValueForOptimization(true, context.constIndex(true));
		case OpCode.K0:
			return constValueForOptimization(0, context.constIndex(0));
		case OpCode.K1:
			return constValueForOptimization(1, context.constIndex(1));
		case OpCode.KM1:
			return constValueForOptimization(-1, context.constIndex(-1));
		case OpCode.KSMI:
			return constValueForOptimization(instruction.b, context.constIndex(instruction.b));
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
			instruction.op = OpCode.LOADK;
			instruction.a = target;
			instruction.b = constant.constIndex;
			instruction.c = 0;
			instruction.format = 'ABx';
			return constant;
		case ConstValueKind.Number:
			break;
	}
	if (Number.isInteger(constant.value)) {
		if (constant.value === 0) {
			instruction.op = OpCode.K0;
			instruction.a = target;
			instruction.b = 0;
			instruction.c = 0;
			instruction.format = 'ABC';
			return constant;
		}
		if (constant.value === 1) {
			instruction.op = OpCode.K1;
			instruction.a = target;
			instruction.b = 0;
			instruction.c = 0;
			instruction.format = 'ABC';
			return constant;
		}
		if (constant.value === -1) {
			instruction.op = OpCode.KM1;
			instruction.a = target;
			instruction.b = 0;
			instruction.c = 0;
			instruction.format = 'ABC';
			return constant;
		}
		if (constant.value >= MIN_SIGNED_BX && constant.value <= MAX_SIGNED_BX) {
			instruction.op = OpCode.KSMI;
			instruction.a = target;
			instruction.b = constant.value;
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

export const evaluateUnary = (op: OpCode, value: ConstValue): ProgramConstant | null => {
	switch (op) {
		case OpCode.UNM:
			return value.kind === ConstValueKind.Number ? -value.value : null;
		case OpCode.BNOT:
			return value.kind === ConstValueKind.Number ? ~value.value : null;
		case OpCode.NOT:
			return value.kind === ConstValueKind.Nil
				|| (value.kind === ConstValueKind.Boolean && !value.value);
		case OpCode.LEN:
			return value.kind === ConstValueKind.String
				? utf8CodepointCount(value.value)
				: null;
		default:
			return null;
	}
};

export const evaluateBinary = (op: OpCode, left: ConstValue, right: ConstValue): ProgramConstant | null => {
	if (left.kind !== ConstValueKind.Number || right.kind !== ConstValueKind.Number) {
		return null;
	}
	switch (op) {
		case OpCode.ADD:
			return left.value + right.value;
		case OpCode.SUB:
			return left.value - right.value;
		case OpCode.MUL:
			return left.value * right.value;
		case OpCode.DIV:
			return left.value / right.value;
		case OpCode.MOD:
			return luaModulo(left.value, right.value);
		case OpCode.FLOORDIV:
			return luaFloorDivide(left.value, right.value);
		case OpCode.POW:
			return Math.pow(left.value, right.value);
		case OpCode.BAND:
			return left.value & right.value;
		case OpCode.BOR:
			return left.value | right.value;
		case OpCode.BXOR:
			return left.value ^ right.value;
		case OpCode.SHL:
			return left.value << (right.value & 31);
		case OpCode.SHR:
			return left.value >> (right.value & 31);
		default:
			return null;
	}
};

export const evaluateComparison = (op: OpCode, left: ConstValue, right: ConstValue): boolean | null => {
	switch (op) {
		case OpCode.EQ:
			return left.value === right.value;
		case OpCode.LT:
		case OpCode.LE:
			if (left.kind === ConstValueKind.Number && right.kind === ConstValueKind.Number) {
				return op === OpCode.LT
					? left.value < right.value
					: left.value <= right.value;
			}
			if (left.kind === ConstValueKind.String && right.kind === ConstValueKind.String) {
				const order = utf8Compare(left.value, right.value);
				return op === OpCode.LT
					? order < 0
					: order <= 0;
			}
			return null;
		default:
			return null;
	}
};
