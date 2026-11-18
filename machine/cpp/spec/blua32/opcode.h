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

// Select the next Table-valued __index target and test its own mapping.
// This semantic traversal stage does not fetch another instruction.
inline constexpr int TABLE_INDEX_VISIT_CYCLES = 8;
// One logical own-integer presence test; no instruction-supply allowance.
inline constexpr int TABLE_LENGTH_PROBE_CYCLES = 6;

extern const std::array<uint8_t, OPCODE_COUNT> BASE_CYCLES;
extern const std::array<uint8_t, OPCODE_COUNT> OPCODE_USES_BX;
extern const std::array<uint8_t, OPCODE_COUNT> OPCODE_USES_DISP;
// Scalar register operands only; register/count ranges are interpreted by their operation.
inline constexpr uint8_t REGISTER_OPERAND_A = 1u;
inline constexpr uint8_t REGISTER_OPERAND_B = 2u;
inline constexpr uint8_t REGISTER_OPERAND_C = 4u;
extern const std::array<uint8_t, OPCODE_COUNT> OPCODE_SCALAR_REGISTER_READS;
extern const std::array<uint8_t, OPCODE_COUNT> OPCODE_WRITES_REGISTER_A;
inline constexpr uint8_t RK_OPERAND_B = 1u;
inline constexpr uint8_t RK_OPERAND_C = 2u;
extern const std::array<uint8_t, OPCODE_COUNT> OPCODE_RK_OPERANDS;

inline constexpr int encodeFixedValueCount(int count) { return count + 1; }

inline constexpr int decodeValueCount(int operand, int openCount) {
	return operand == 0 ? openCount : operand - 1;
}

} // namespace bmsx
