#include "machine/cpu/value.h"

#include <cmath>
#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;

// Widening binary32 to binary64 is exact. This arithmetic oracle is independent
// of the runtime's binary32 significand/shift implementation.
void checkFloat(uint32_t bits) {
	const Value value = valueFloatBits(bits);
	const double number = f32BitsToNumber(bits);
	const bool finite = std::isfinite(number);
	uint32_t word;
	int32_t integer;
	if (valueToWord(value, word) != finite)
		throw std::runtime_error("Only finite Floats supply a memory word");
	if (finite) {
		double reduced = std::fmod(std::trunc(number), 4294967296.0);
		if (reduced < 0) reduced += 4294967296.0;
		if (word != static_cast<uint32_t>(reduced))
			throw std::runtime_error("Word conversion must truncate and wrap");
	}
	const bool exact = number >= -2147483648.0 && number < 2147483648.0 && std::trunc(number) == number;
	if (valueToInteger(value, integer) != exact || (exact && integer != static_cast<int32_t>(number)))
		throw std::runtime_error("Integer conversion requires an exact signed 32-bit value");
}
}

int main() {
	try {
		for (uint32_t exponent = 0; exponent < 256; ++exponent)
			for (uint32_t fraction : {0u, 1u, 2u, 0x3fffffu, 0x400000u, 0x7ffffeu, 0x7fffffu})
				for (uint32_t sign : {0u, 0x80000000u})
					checkFloat(sign | (exponent << 23) | fraction);
		uint32_t bits = 0x5932a7b1u;
		for (int i = 0; i < 200000; ++i) {
			bits = bits * 1664525u + 1013904223u;
			checkFloat(bits);
			const Value value = valueInteger(static_cast<int32_t>(bits));
			uint32_t word;
			int32_t integer;
			if (!valueToWord(value, word) || word != bits || !valueToInteger(value, integer)
				|| integer != static_cast<int32_t>(bits))
				throw std::runtime_error("Integer operands retain all 32 bits");
		}
		for (const auto tag : {ValueTag::Nil, ValueTag::False, ValueTag::True, ValueTag::String,
			ValueTag::Table, ValueTag::Closure, ValueTag::BuiltinFunction, ValueTag::Thread}) {
			uint32_t word;
			int32_t integer;
			const auto value = valueFromTag(tag, 0xffffffffu);
			if (valueToWord(value, word) || valueToInteger(value, integer))
				throw std::runtime_error("Nonnumeric operands do not supply zero or any other word");
		}
		std::cout << "Value conversion tests passed\n";
		return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
