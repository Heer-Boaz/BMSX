import { LuaBinaryOperator } from '../syntax/ast';
import { luaFloorDivide, luaModulo } from '../../spec/blua32/numeric';

export function evaluateCompileTimeNumberBinaryOperator(operator: LuaBinaryOperator, left: number, right: number): number | undefined {
	switch (operator) {
		case LuaBinaryOperator.BitwiseOr:
			return left | right;
		case LuaBinaryOperator.BitwiseXor:
			return left ^ right;
		case LuaBinaryOperator.BitwiseAnd:
			return left & right;
		case LuaBinaryOperator.ShiftLeft:
			return left << (right & 31);
		case LuaBinaryOperator.ShiftRight:
			return left >> (right & 31);
		case LuaBinaryOperator.Add:
			return left + right;
		case LuaBinaryOperator.Subtract:
			return left - right;
		case LuaBinaryOperator.Multiply:
			return left * right;
		case LuaBinaryOperator.Divide:
			return left / right;
		case LuaBinaryOperator.FloorDivide:
			return luaFloorDivide(left, right);
		case LuaBinaryOperator.Modulus:
			return luaModulo(left, right);
		case LuaBinaryOperator.Exponent:
			return Math.pow(left, right);
	}
}
