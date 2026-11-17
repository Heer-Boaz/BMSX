#pragma once

#include "machine/cpu/errors.h"
#include "spec/blua32/numeric.h"
#include "spec/blua32/pow.h"

namespace bmsx {
// Language operand admission is distinct from raw-word conversion. Bitwise
// instructions require an exact signed Integer; memory operands accept finite
// Float truncation modulo 2^32. A failed admission is a guest fault, never 0.
inline i32 integerOperand(Value value) {
	i32 integer;
	if (!valueToInteger(value, integer)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	return integer;
}
inline u32 wordOperand(Value value) {
	u32 word;
	if (!valueToWord(value, word)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	return word;
}
inline float floatOperand(Value value) {
	if (!valueIsNumber(value)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	return numberAsFloat(value);
}
inline Value valueAdd(Value a, Value b) {
	if (valueIsInteger(a) && valueIsInteger(b)) return valueInteger(static_cast<i32>(valuePayload(a) + valuePayload(b)));
	return valueFloat(floatOperand(a) + floatOperand(b));
}
inline Value valueSubtract(Value a, Value b) {
	if (valueIsInteger(a) && valueIsInteger(b)) return valueInteger(static_cast<i32>(valuePayload(a) - valuePayload(b)));
	return valueFloat(floatOperand(a) - floatOperand(b));
}
inline Value valueMultiply(Value a, Value b) {
	if (valueIsInteger(a) && valueIsInteger(b)) return valueInteger(static_cast<i32>(valuePayload(a) * valuePayload(b)));
	return valueFloat(floatOperand(a) * floatOperand(b));
}
inline Value valueDivide(Value a, Value b) { return valueFloat(floatOperand(a) / floatOperand(b)); }
inline Value valueFloorDivide(Value a, Value b) {
	if (valueIsInteger(a) && valueIsInteger(b)) {
		if (asInteger(b) == 0) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		return valueInteger(luaIntegerFloorDivide(asInteger(a), asInteger(b)));
	}
	const float left = floatOperand(a), right = floatOperand(b);
	return valueFloatBits(luaFloatFloorDivideBits(numberToF32Bits(left), numberToF32Bits(right)));
}
inline Value valueModulo(Value a, Value b) {
	if (valueIsInteger(a) && valueIsInteger(b)) {
		if (asInteger(b) == 0) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		return valueInteger(luaIntegerModulo(asInteger(a), asInteger(b)));
	}
	const float left = floatOperand(a), right = floatOperand(b);
	return valueFloatBits(luaFloatModuloBits(numberToF32Bits(left), numberToF32Bits(right)));
}
inline Value valuePower(Value a, Value b) { return valueFloat(static_cast<float>(luaPow(floatOperand(a), floatOperand(b)))); }
inline Value valueNegate(Value value) {
	if (valueIsInteger(value)) return valueInteger(static_cast<i32>(0u - valuePayload(value)));
	if (valueIsFloat(value)) return valueFloatBits(luaFloatNegateBits(valuePayload(value)));
	throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
}
} // namespace bmsx
