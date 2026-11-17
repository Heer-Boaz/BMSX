import { LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../spec/blua32/cop0';
import { luaIntegerFloorDivide, luaIntegerModulo, luaFloatFloorDivideBits, luaFloatModuloBits, luaFloatNegateBits } from '../../spec/blua32/numeric';
import { numberToF32Bits } from '../../common/float32';
import { luaPow } from '../../spec/blua32/pow';
import { LuaExecutionError } from './errors';
import { valueToInteger, valueToWord, valueIsNumber, numberAsFloat, valueIsInteger, asInteger, valuePayload, valueInteger, valueFloat, valueFloatBits, valueIsFloat, type Value } from './value';

export function integerOperand(value: Value): number {
	const integer = valueToInteger(value);
	if (integer === null) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	return integer;
}
export function wordOperand(value: Value): number {
	const word = valueToWord(value);
	if (word === null) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	return word;
}
export function floatOperand(value: Value): number {
	if (!valueIsNumber(value)) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	return numberAsFloat(value);
}
export function valueAdd(a: Value, b: Value): Value {
	return valueIsInteger(a) && valueIsInteger(b) ? valueInteger((asInteger(a) + asInteger(b)) | 0) : valueFloat(floatOperand(a) + floatOperand(b));
}
export function valueSubtract(a: Value, b: Value): Value {
	return valueIsInteger(a) && valueIsInteger(b) ? valueInteger((asInteger(a) - asInteger(b)) | 0) : valueFloat(floatOperand(a) - floatOperand(b));
}
export function valueMultiply(a: Value, b: Value): Value {
	return valueIsInteger(a) && valueIsInteger(b) ? valueInteger(Math.imul(asInteger(a), asInteger(b))) : valueFloat(floatOperand(a) * floatOperand(b));
}
export function valueDivide(a: Value, b: Value): Value { return valueFloat(floatOperand(a) / floatOperand(b)); }
export function valueFloorDivide(a: Value, b: Value): Value {
	if (valueIsInteger(a) && valueIsInteger(b)) {
		if (asInteger(b) === 0) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		return valueInteger(luaIntegerFloorDivide(asInteger(a), asInteger(b)));
	}
	return valueFloatBits(luaFloatFloorDivideBits(numberToF32Bits(floatOperand(a)), numberToF32Bits(floatOperand(b))));
}
export function valueModulo(a: Value, b: Value): Value {
	if (valueIsInteger(a) && valueIsInteger(b)) {
		if (asInteger(b) === 0) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		return valueInteger(luaIntegerModulo(asInteger(a), asInteger(b)));
	}
	return valueFloatBits(luaFloatModuloBits(numberToF32Bits(floatOperand(a)), numberToF32Bits(floatOperand(b))));
}
export function valuePower(a: Value, b: Value): Value { return valueFloat(luaPow(floatOperand(a), floatOperand(b))); }
export function valueNegate(value: Value): Value {
	if (valueIsInteger(value)) return valueInteger((-asInteger(value)) | 0);
	if (valueIsFloat(value)) return valueFloatBits(luaFloatNegateBits(valuePayload(value)));
	throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
}
