#include "machine/cpu/value.h"

#include <cmath>
#include <cstring>
#include <iostream>
#include <limits>
#include <stdexcept>

namespace {
using namespace bmsx;

// Independent arithmetic oracle for truncation modulo 2^32, not the runtime's
// significand extraction or its host-width fast paths.
uint32_t expectedWord(double value) {
	uint64_t bits;
	std::memcpy(&bits, &value, sizeof(bits));
	if ((bits & 0x7ff0000000000000ULL) == 0x7ff0000000000000ULL) return 0u;
	double word = std::fmod(std::trunc(value), 4294967296.0);
	if (word < 0.0) word += 4294967296.0;
	return static_cast<uint32_t>(word);
}

void check(double value) {
	const auto expected = expectedWord(value);
	const int32_t signedExpected = static_cast<int32_t>(expected < 0x80000000u
		? static_cast<int64_t>(expected)
		: static_cast<int64_t>(expected) - 4294967296LL);
	const auto encoded = valueNumber(value);
	if (toU32(value) != expected || toU32(encoded) != expected
		|| toI32(value) != signedExpected || toI32(encoded) != signedExpected) {
		uint64_t bits;
		std::memcpy(&bits, &value, sizeof(bits));
		std::cerr << "Word conversion mismatch for IEEE bits 0x" << std::hex
			<< bits << std::dec << '\n';
		throw std::runtime_error("Number conversion must truncate and wrap, never saturate.");
	}
}

void exponentAndMantissaCoverage() {
	for (uint64_t exponent = 0u; exponent <= 0x7ffu; ++exponent) {
		for (uint64_t mantissa : {0ULL, 1ULL, 2ULL, 0x0007ffffffffffffULL,
			0x0008000000000000ULL, 0x000ffffffffffffeULL, 0x000fffffffffffffULL}) {
			for (uint64_t sign : {0ULL, 0x8000000000000000ULL}) {
				check(asNumber(sign | (exponent << 52u) | mantissa));
			}
		}
	}
}

void hostConversionEdges() {
	for (int exponent = 0; exponent <= 84; ++exponent) {
		const double boundary = std::ldexp(1.0, exponent);
		for (int offset = -32; offset <= 32; ++offset) {
			const double value = boundary + static_cast<double>(offset) * 0.25;
			for (double signedValue : {value, -value}) {
				check(signedValue);
				check(std::nextafter(signedValue, std::numeric_limits<double>::infinity()));
				check(std::nextafter(signedValue, -std::numeric_limits<double>::infinity()));
			}
		}
	}
	check(0.0);
	check(-0.0);
}

void deterministicBitPatterns() {
	uint64_t bits = 0x5932a7b16c4d08efULL;
	for (int index = 0; index < 200000; ++index) {
		bits = bits * 6364136223846793005ULL + 1442695040888963407ULL;
		check(asNumber(bits));
	}
	for (const auto tag : {ValueTag::Nil, ValueTag::False, ValueTag::True, ValueTag::String,
		ValueTag::Table, ValueTag::Closure, ValueTag::BuiltinFunction, ValueTag::Thread}) {
		if (toU32(valueFromTag(tag, 0xffffffffffffULL)) != 0u) {
			throw std::runtime_error("Nonnumeric operands supply NaN, hence the zero word.");
		}
	}
}
}

int main() {
	try {
		exponentAndMantissaCoverage();
		hostConversionEdges();
		deterministicBitPatterns();
		std::cout << "Number-to-word conversion tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
