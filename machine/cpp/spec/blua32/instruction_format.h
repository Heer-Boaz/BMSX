#pragma once

#include <cstdint>
#include <span>

namespace bmsx {

enum class ValueMoveKind : uint32_t {
	Copy = 0, FloatBits = 1, FloatFromBits = 2, Tag = 3,
	ReadTop = 4, ReadIndexed = 5, WriteIndexed = 6, SetTop = 7,
	Payload = 8, ReadBase = 9, SetBase = 10, AddBase = 11, SetTopImmediate = 12,
};
enum class ReturnSource : uint32_t { Registers = 0, ExtraArguments = 1 };
enum class RegisterJumpMode : uint32_t {
	Jump = 0, Link = 1,
};

constexpr int INSTRUCTION_BYTES = 4;
constexpr int MAX_OP_BITS = 6;
constexpr int MAX_OPERAND_BITS = 6;
constexpr int MAX_BX_BITS = 12;

constexpr int EXT_A_BITS = 2;
constexpr int EXT_B_BITS = 3;
constexpr int EXT_C_BITS = 3;
constexpr int EXT_BX_BITS = 8;

constexpr int BASE_OPERAND_A_BITS = MAX_OPERAND_BITS + EXT_A_BITS;
constexpr int BASE_OPERAND_BC_BITS = MAX_OPERAND_BITS + EXT_B_BITS;
constexpr int BASE_BX_BITS = MAX_BX_BITS + EXT_BX_BITS;

constexpr int MAX_LOW_OPERAND = (1 << MAX_OPERAND_BITS) - 1;
constexpr int MAX_LOW_BX = (1 << MAX_BX_BITS) - 1;
constexpr int MAX_WIDE = MAX_LOW_OPERAND;

constexpr int MAX_BASE_OPERAND_A = (1 << BASE_OPERAND_A_BITS) - 1;
constexpr int MAX_BASE_OPERAND_BC = (1 << BASE_OPERAND_BC_BITS) - 1;
constexpr int MAX_BASE_BX = (1 << BASE_BX_BITS) - 1;
constexpr int MAX_WIDE_OPERAND = (MAX_WIDE << MAX_OPERAND_BITS) | MAX_LOW_OPERAND;
constexpr int MAX_SIGNED_BX_BITS = BASE_BX_BITS + MAX_OPERAND_BITS;
constexpr int SIGNED_BX_SIGN_BIT = 1 << (MAX_SIGNED_BX_BITS - 1);
constexpr int MAX_SIGNED_BX = SIGNED_BX_SIGN_BIT - 1;
constexpr int MIN_SIGNED_BX = -SIGNED_BX_SIGN_BIT;

constexpr int MAX_EXT_REGISTER_A = (MAX_WIDE << BASE_OPERAND_A_BITS) | MAX_BASE_OPERAND_A;
constexpr int MAX_EXT_REGISTER_BC = (MAX_WIDE << BASE_OPERAND_BC_BITS) | MAX_BASE_OPERAND_BC;
constexpr int MAX_EXT_REGISTER = MAX_EXT_REGISTER_BC;
constexpr int MAX_EXT_CONST = (1 << (MAX_OPERAND_BITS + EXT_B_BITS - 1)) - 1;
constexpr int MAX_EXT_BX = (MAX_WIDE << BASE_BX_BITS) | MAX_BASE_BX;

constexpr int signExtend(uint32_t value, int bits) {
	const int shift = 32 - bits;
	return static_cast<int>(value << shift) >> shift;
}

constexpr uint8_t instructionOpcode(uint32_t word) {
	return static_cast<uint8_t>((word >> (3 * MAX_OPERAND_BITS)) & ((1 << MAX_OP_BITS) - 1));
}

constexpr uint8_t instructionFieldExtraHashSlots(uint32_t head, uint8_t width) {
	return width == 2u ? static_cast<uint8_t>(head >> 24u) : 0u;
}

constexpr uint32_t instructionLowB(uint32_t word) {
	return (word >> MAX_OPERAND_BITS) & MAX_LOW_OPERAND;
}

constexpr uint32_t instructionBx(uint32_t body, uint32_t wideB, bool withExtension) {
	return (wideB << BASE_BX_BITS)
		| (withExtension ? (body >> 24) << MAX_BX_BITS : 0u)
		| (body & MAX_LOW_BX);
}

constexpr int instructionSignedBx(uint32_t bx, int width) {
	return signExtend(bx, BASE_BX_BITS + (width - 1) * MAX_OPERAND_BITS);
}

constexpr uint32_t instructionBranchTarget(uint32_t pc, int width, uint32_t bx) {
	return pc + static_cast<uint32_t>((width + instructionSignedBx(bx, width)) * INSTRUCTION_BYTES);
}
uint32_t packInstructionWord(uint8_t op, uint8_t a, uint8_t b, uint8_t c, uint8_t ext = 0);
void writeInstruction(std::span<uint8_t> code, int index, uint8_t op, uint8_t a, uint8_t b, uint8_t c, uint8_t ext = 0);
void writeInstructionWord(std::span<uint8_t> code, int index, uint32_t word);
uint32_t readInstructionWord(std::span<const uint8_t> code, int index);

} // namespace bmsx
