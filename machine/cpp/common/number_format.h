#pragma once
#include <array>
#include <bit>
#include <charconv>
#include <cstdint>
#include <string>
#include "common/float32.h"

namespace bmsx {
namespace number_format_detail {
// Fixed-precision conversion: scale the exact binary32 rational, then round
// its integer quotient to even. Five 32-bit limbs cover the entire range.
// This is the counted-digit strategy used by double-conversion/Dragon4;
// binary32 bounds let us use fixed stack storage instead of a general bignum.
using Limbs = std::array<uint32_t, 5>;
// First binary32 word not less than each exact decimal power 10^-45..10^39.
inline constexpr uint32_t powers[] = {0x00000001, 0x00000008, 0x00000048, 0x000002ca, 0x00001be1, 0x000116c3, 0x000ae398, 0x006ce3ef, 0x02081ceb, 0x03aa2425, 0x0554ad2e, 0x0704ec3d, 0x08a6274c, 0x0a4fb11f, 0x0c01ceb4, 0x0da24260, 0x0f4ad2f8, 0x10fd87b6, 0x129e74d2, 0x14461207, 0x15f79688, 0x179abe15, 0x19416d9b, 0x1af1c901, 0x1c971da1, 0x1e3ce509, 0x1fec1e4b, 0x219392ef, 0x233877ab, 0x24e69595, 0x26901d7d, 0x283424dd, 0x29e12e14, 0x2b8cbccd, 0x2d2fec00, 0x2edbe6ff, 0x30897060, 0x322bcc78, 0x33d6bf95, 0x358637be, 0x3727c5ad, 0x38d1b718, 0x3a83126f, 0x3c23d70b, 0x3dcccccd, 0x3f800000, 0x41200000, 0x42c80000, 0x447a0000, 0x461c4000, 0x47c35000, 0x49742400, 0x4b189680, 0x4cbebc20, 0x4e6e6b28, 0x501502f9, 0x51ba43b8, 0x5368d4a6, 0x551184e8, 0x56b5e621, 0x58635faa, 0x5a0e1bca, 0x5bb1a2bd, 0x5d5e0b6c, 0x5f0ac724, 0x60ad78ec, 0x6258d727, 0x64078679, 0x65a96817, 0x6753c21c, 0x69045952, 0x6aa56fa6, 0x6c4ecb90, 0x6e013f3a, 0x6fa18f08, 0x7149f2ca, 0x72fc6f7d, 0x749dc5ae, 0x7645371a, 0x77f684e0, 0x799a130c, 0x7b4097cf, 0x7cf0bdc3, 0x7e96769a, 0x7f800000};
inline void multiplyFive(Limbs& value, int count) {
	for (int j = 0; j < count; ++j) {
		uint32_t carry = 0;
		for (auto& word : value) {
			const uint32_t prior = word;
			uint32_t next = (prior << 2) + prior;
			const uint32_t high = (prior >> 30) + (next < prior);
			const uint32_t beforeCarry = next; next += carry;
			carry = high + (next < beforeCarry); word = next;
		}
	}
}
inline void shiftLeft(Limbs& value, int count) {
	const int words = count >> 5, bits = count & 31;
	for (int i = 4; i >= 0; --i) {
		const int source = i - words;
		uint32_t next = source >= 0 ? value[source] << bits : 0;
		if (bits != 0 && source > 0) next |= value[source - 1] >> (32 - bits);
		value[i] = next;
	}
}
inline void shiftRightOne(Limbs& value) {
	for (int i = 0; i < 4; ++i) value[i] = (value[i] >> 1) | (value[i + 1] << 31);
	value[4] >>= 1;
}
inline int compare(const Limbs& left, const Limbs& right) {
	for (int i = 4; i >= 0; --i) if (left[i] != right[i]) return left[i] < right[i] ? -1 : 1;
	return 0;
}
inline void subtract(Limbs& left, const Limbs& right) {
	uint32_t borrow = 0;
	for (int i = 0; i < 5; ++i) {
		const uint32_t a = left[i], b = right[i];
		left[i] = a - b - borrow;
		borrow = a < b || (borrow != 0 && a == b);
	}
}
inline uint32_t digits(uint32_t magnitude, int decimalExponent) {
	const int encodedExponent = static_cast<int>(magnitude >> 23);
	const uint32_t mantissa = (magnitude & 0x7fffffu) | (encodedExponent == 0 ? 0u : 0x800000u);
	const int exponent = encodedExponent == 0 ? -149 : encodedExponent - 150;
	const int scale = 6 - decimalExponent;
	Limbs numerator{mantissa}, denominator{1}, shifted{};
	if (scale >= 0) {
		multiplyFive(numerator, scale);
		const int shift = -(exponent + scale), index = shift >> 5, bit = shift & 31;
		uint32_t quotient = numerator[index] >> bit;
		if (bit != 0) quotient |= numerator[index + 1] << (32 - bit);
		if (shift != 0) {
			const int halfIndex = (shift - 1) >> 5, halfBit = (shift - 1) & 31;
			const bool half = ((numerator[halfIndex] >> halfBit) & 1u) != 0;
			bool sticky = halfBit != 0 && (numerator[halfIndex] & (0xffffffffu >> (32 - halfBit))) != 0;
			for (int i = 0; i < halfIndex; ++i) sticky |= numerator[i] != 0;
			if (half && (sticky || (quotient & 1u) != 0)) ++quotient;
		}
		return quotient;
	}
	const int power = -scale;
	multiplyFive(denominator, power);
	if (exponent >= power) shiftLeft(numerator, exponent - power);
	else shiftLeft(denominator, power - exponent);
	shifted = denominator; shiftLeft(shifted, 23);
	uint32_t quotient = 0;
	for (int bit = 23; bit >= 0; --bit) {
		if (compare(numerator, shifted) >= 0) { subtract(numerator, shifted); quotient |= 1u << bit; }
		shiftRightOne(shifted);
	}
	shiftLeft(numerator, 1);
	const int half = compare(numerator, denominator);
	if (half > 0 || (half == 0 && (quotient & 1u) != 0)) ++quotient;
	return quotient;
}
} // namespace number_format_detail
inline std::string formatInteger(int32_t value) {
	char text[12]; const auto result = std::to_chars(text, text + sizeof(text), value);
	return {text, result.ptr};
}
inline std::string formatFloat(float value) {
	using namespace number_format_detail;
	const uint32_t bits = numberToF32Bits(value), magnitude = bits & 0x7fffffffu;
	if (magnitude > 0x7f800000u) return "nan";
	if (magnitude == 0x7f800000u) return bits >> 31 ? "-inf" : "inf";
	if (magnitude == 0) return bits >> 31 ? "-0.0" : "0.0";
	const int encodedExponent = static_cast<int>(magnitude >> 23);
	const int binaryExponent = encodedExponent == 0 ? static_cast<int>(std::bit_width(magnitude)) - 150 : encodedExponent - 127;
	int decimalExponent = (binaryExponent * 78913) >> 18;
	if (magnitude >= powers[decimalExponent + 46]) ++decimalExponent;
	else if (magnitude < powers[decimalExponent + 45]) --decimalExponent;
	uint32_t significand = digits(magnitude, decimalExponent);
	if (significand == 10000000) { significand = 1000000; ++decimalExponent; }
	char text[7];
	for (int i = 6; i >= 0; --i) { text[i] = static_cast<char>('0' + significand % 10); significand /= 10; }
	int end = 7; while (end > 1 && text[end - 1] == '0') --end;
	std::string out; out.reserve(24); if (bits >> 31) out.push_back('-');
	if (decimalExponent >= -4 && decimalExponent < 7) {
		const int point = decimalExponent + 1;
		if (point > 0) {
			out.append(text, point);
			if (end > point) { out.push_back('.'); out.append(text + point, end - point); }
			else out.append(".0");
		} else { out.append("0."); out.append(-point, '0'); out.append(text, end); }
	} else {
		out.push_back(text[0]); if (end > 1) { out.push_back('.'); out.append(text + 1, end - 1); }
		out.push_back('e'); out.push_back(decimalExponent < 0 ? '-' : '+');
		const int exponent = decimalExponent < 0 ? -decimalExponent : decimalExponent;
		out.push_back(static_cast<char>('0' + exponent / 10)); out.push_back(static_cast<char>('0' + exponent % 10));
	}
	return out;
}
} // namespace bmsx
