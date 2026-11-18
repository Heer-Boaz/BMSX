#include "spec/blua32/numeric.h"
#include <iostream>
#include <stdexcept>
#include <string_view>

namespace {
using namespace bmsx;
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
void boundaries() {
	constexpr int32_t min = (-2147483647 - 1), max = 2147483647;
	require(luaIntegerFloorDivide(-7, 3) == -3 && luaIntegerModulo(-7, 3) == 2, "floor and remainder signs");
	require(luaIntegerFloorDivide(7, -3) == -3 && luaIntegerModulo(7, -3) == -2, "negative divisor");
	require(luaIntegerFloorDivide(min, -1) == min && luaIntegerModulo(min, -1) == 0, "wrapping division overflow");
	require(luaIntegerFloorDivide(min, 3) == -715827883 && luaIntegerModulo(min, 3) == 1, "minimum floor division");
	require(luaShiftRight(-8, 1) == 2147483644 && luaShiftLeft(8, -1) == 4, "logical and reversed shifts");
	for (int32_t count : {32, -32, min, max})
		require(luaShiftLeft(-1, count) == 0 && luaShiftRight(-1, count) == 0, "wide shifts are zero, not masked");
	require(luaCompareIntegerFloat(16777217, 16777216.0f) == NumericOrder::Greater, "mixed compare keeps Integer precision");
	require(luaCompareIntegerFloat(max, 2147483648.0f) == NumericOrder::Less, "positive int boundary");
	require(luaCompareIntegerFloat(min, -2147483648.0f) == NumericOrder::Equal, "negative int boundary");
	require(luaCompareIntegerFloat(0, f32BitsToNumber(0x7fa12345)) == NumericOrder::Unordered, "NaN unordered");
	require(luaFloatAddBits(0x4b800000, 0x3f800000) == 0x4b800000, "addition rounds at the operation");
	require(luaFloatAddBits(1, 1) == 2, "gradual underflow");
	require(luaFloatMultiplyBits(0x00800000, 0x3f000000) == 0x00400000, "normal to subnormal");
	require(luaFloatMultiplyBits(1, 0x3f000000) == 0 && luaFloatMultiplyBits(1, 0x3fc00000) == 2, "subnormal ties to even");
	require(luaFloatDivideBits(0x3f800000, 0) == 0x7f800000, "floating division by zero");
	require(luaFloatDivideBits(0, 0) == BLUA32_FLOAT_NAN, "arithmetic canonical NaN");
	require(luaFloatNegateBits(luaFloatDivideBits(0, 0)) == 0xffc00000, "canonicalize before negation");
	require(luaFloatNegateBits(0x7fa12345) == 0xffa12345, "negation preserves signaling and payload bits");
	require(luaFloatFloorDivideBits(0x40400001, 0x3f800001) == 0x40400000, "round quotient before floor");
	require(luaFloatFloorDivideBits(0xc0e00000, 0x40400000) == 0xc0400000, "floating floor divide");
	require(luaFloatModuloBits(0xc0e00000, 0x40400000) == 0x40000000, "floating adjusted modulo");
	require(luaFloatModuloBits(0x80000000, 0xc0400000) == 0x80000000, "modulo retains zero sign");
	uint32_t word = 0x12345678;
	require(luaFloatToWord(0x4f800001, word) && word == 512, "finite word wrapping");
	require(luaFloatToWord(0x7f7fffff, word) && word == 0, "large finite low word");
	word = 0x12345678;
	require(!luaFloatToWord(0x7f800000, word) && word == 0x12345678, "invalid conversion publishes no word");
	int32_t integer = 17;
	require(luaFloatToInteger(0xcf000000, integer) && integer == min, "minimum Integer conversion");
	require(!luaFloatToInteger(0x4f000000, integer) && !luaFloatToInteger(0x3f000000, integer), "integer range and integrality");
}
void vectors() {
	char op; uint32_t left, right;
	while (std::cin >> op >> std::hex >> left >> right) {
		uint32_t result = 0; bool valid = true;
		const auto a = static_cast<int32_t>(left), b = static_cast<int32_t>(right);
		switch (op) {
			case 'Q': valid = b != 0; if (valid) result = static_cast<uint32_t>(luaIntegerFloorDivide(a, b)); break;
			case 'T': valid = b != 0; if (valid) result = static_cast<uint32_t>(luaIntegerModulo(a, b)); break;
			case 'L': result = static_cast<uint32_t>(luaShiftLeft(a, b)); break;
			case 'H': result = static_cast<uint32_t>(luaShiftRight(a, b)); break;
			case 'C': result = static_cast<uint32_t>(luaCompareIntegerFloat(a, f32BitsToNumber(right))); break;
			case 'A': result = luaFloatAddBits(left, right); break;
			case 'S': result = luaFloatSubtractBits(left, right); break;
			case 'M': result = luaFloatMultiplyBits(left, right); break;
			case 'D': result = luaFloatDivideBits(left, right); break;
			case 'F': result = luaFloatFloorDivideBits(left, right); break;
			case 'R': result = luaFloatModuloBits(left, right); break;
			case 'N': result = luaFloatNegateBits(left); break;
			case 'W': valid = luaFloatToWord(left, result); break;
			case 'I': { int32_t integer; valid = luaFloatToInteger(left, integer); if (valid) result = static_cast<uint32_t>(integer); break; }
			default: throw std::runtime_error("unknown numeric test operation");
		}
		if (valid) std::cout << std::hex << result << '\n'; else std::cout << "invalid\n";
	}
}
}
int main(int argc, char** argv) {
	try {
		boundaries();
		if (argc == 2 && std::string_view(argv[1]) == "--vectors") vectors();
		else std::cout << "numeric32 tests passed\n";
		return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
