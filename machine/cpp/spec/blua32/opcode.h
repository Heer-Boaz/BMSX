#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace bmsx {

enum class OpCode : uint8_t {
#define OP(name) name,
#include "spec/blua32/opcode_list.inl"
#undef OP
};

inline constexpr size_t OPCODE_COUNT = 64U;

extern const std::array<uint8_t, OPCODE_COUNT> BASE_CYCLES;
extern const std::array<uint8_t, OPCODE_COUNT> OPCODE_USES_BX;
extern const std::array<uint8_t, OPCODE_COUNT> OPCODE_USES_DISP;

inline constexpr int encodeFixedCallArgCount(int argCount) { return argCount + 1; }

inline constexpr int decodeCallArgCount(int operand, int openArgCount) {
	return operand == 0 ? openArgCount : operand - 1;
}

} // namespace bmsx
