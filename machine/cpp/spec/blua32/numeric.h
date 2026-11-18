#pragma once

#include <cmath>
#include <cstdint>
#include "common/float32.h"

namespace bmsx {

inline double luaFloorDivide(double left, double right) {
	const double quotient = left / right;
	const double integer = std::trunc(quotient);
	return integer > quotient ? integer - 1.0 : integer;
}

inline double luaModulo(double left, double right) {
	double remainder = std::fmod(left, right);
	if (remainder > 0.0 ? right < 0.0 : remainder < 0.0 && right > 0.0) {
		remainder += right;
	}
	return remainder;
}

// Integer divisors are admitted as nonzero by the instruction/folding owner.
// Unsigned negation handles INT_MIN / -1 without signed overflow.
inline int32_t luaIntegerFloorDivide(int32_t left, int32_t right) {
	if (right == -1) return static_cast<int32_t>(0u - static_cast<uint32_t>(left));
	const int32_t quotient = left / right, remainder = left % right;
	return quotient - static_cast<int32_t>(remainder != 0 && ((remainder < 0) != (right < 0)));
}
inline int32_t luaIntegerModulo(int32_t left, int32_t right) {
	if (right == -1) return 0;
	const int32_t remainder = left % right;
	return remainder != 0 && ((remainder < 0) != (right < 0)) ? remainder + right : remainder;
}
inline int32_t luaShiftLeft(int32_t value, int32_t count) {
	if (count >= 32 || count <= -32) return 0;
	const uint32_t word = static_cast<uint32_t>(value);
	return static_cast<int32_t>(count < 0 ? word >> -count : word << count);
}
inline int32_t luaShiftRight(int32_t value, int32_t count) {
	if (count >= 32 || count <= -32) return 0;
	const uint32_t word = static_cast<uint32_t>(value);
	return static_cast<int32_t>(count < 0 ? word << -count : word >> count);
}

enum class NumericOrder : int { Less = -1, Equal = 0, Greater = 1, Unordered = 2 };

// Never round the Integer to binary32 before deciding its ordering. In range,
// the float-to-int truncation is defined; compare the residual only on a tie.
inline NumericOrder luaCompareIntegerFloat(int32_t integer, float value) {
	if (value >= 2147483648.0f) return NumericOrder::Less;
	if (value < -2147483648.0f) return NumericOrder::Greater;
	if (value != value) return NumericOrder::Unordered;
	const int32_t truncated = static_cast<int32_t>(value);
	if (integer < truncated) return NumericOrder::Less;
	if (integer > truncated) return NumericOrder::Greater;
	const float whole = static_cast<float>(truncated);
	return whole < value ? NumericOrder::Less : whole > value ? NumericOrder::Greater : NumericOrder::Equal;
}

inline constexpr uint32_t BLUA32_FLOAT_NAN = 0x7fc00000u;
inline uint32_t luaFloatResultBits(float value) {
	const uint32_t bits = numberToF32Bits(value);
	return (bits & 0x7fffffffu) > 0x7f800000u ? BLUA32_FLOAT_NAN : bits;
}
inline uint32_t luaFloatAddBits(uint32_t left, uint32_t right) {
	return luaFloatResultBits(f32BitsToNumber(left) + f32BitsToNumber(right));
}
inline uint32_t luaFloatSubtractBits(uint32_t left, uint32_t right) {
	return luaFloatResultBits(f32BitsToNumber(left) - f32BitsToNumber(right));
}
inline uint32_t luaFloatMultiplyBits(uint32_t left, uint32_t right) {
	return luaFloatResultBits(f32BitsToNumber(left) * f32BitsToNumber(right));
}
inline uint32_t luaFloatDivideBits(uint32_t left, uint32_t right) {
	return luaFloatResultBits(f32BitsToNumber(left) / f32BitsToNumber(right));
}
inline uint32_t luaFloatFloorDivideBits(uint32_t left, uint32_t right) {
	const float quotient = f32BitsToNumber(left) / f32BitsToNumber(right);
	const float integer = std::trunc(quotient);
	return luaFloatResultBits(integer > quotient ? integer - 1.0f : integer);
}
inline uint32_t luaFloatModuloBits(uint32_t left, uint32_t right) {
	const float divisor = f32BitsToNumber(right);
	float remainder = std::fmod(f32BitsToNumber(left), divisor);
	if (remainder > 0.0f ? divisor < 0.0f : remainder < 0.0f && divisor > 0.0f) remainder += divisor;
	return luaFloatResultBits(remainder);
}
inline uint32_t luaFloatNegateBits(uint32_t bits) { return bits ^ 0x80000000u; }

// Word transfers truncate finite Floats, then retain their low 32 bits. Failure
// is INVALID_ARGUMENT at the consumer, not a substituted zero word.
inline bool luaFloatToWord(uint32_t bits, uint32_t& word) {
	const int encodedExponent = static_cast<int>((bits >> 23) & 0xffu);
	if (encodedExponent == 255) return false;
	const int exponent = encodedExponent - 127;
	uint32_t magnitude = 0;
	if (exponent >= 0 && exponent < 55) {
		const uint32_t significand = (bits & 0x7fffffu) | 0x800000u;
		magnitude = exponent < 23 ? significand >> (23 - exponent) : significand << (exponent - 23);
	}
	word = bits >> 31 ? 0u - magnitude : magnitude;
	return true;
}
inline bool luaFloatToInteger(uint32_t bits, int32_t& integer) {
	const float value = f32BitsToNumber(bits);
	if (!(value >= -2147483648.0f && value < 2147483648.0f) || std::trunc(value) != value) return false;
	integer = static_cast<int32_t>(value);
	return true;
}

} // namespace bmsx
