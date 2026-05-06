#pragma once

#include <cstdint>
#include <vector>

namespace bmsx {

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
constexpr int MAX_SIGNED_BX_BITS = BASE_BX_BITS + MAX_OPERAND_BITS;
constexpr int SIGNED_BX_SIGN_BIT = 1 << (MAX_SIGNED_BX_BITS - 1);
constexpr int MAX_SIGNED_BX = SIGNED_BX_SIGN_BIT - 1;
constexpr int MIN_SIGNED_BX = -SIGNED_BX_SIGN_BIT;

constexpr int MAX_EXT_REGISTER_A = (MAX_WIDE << BASE_OPERAND_A_BITS) | MAX_BASE_OPERAND_A;
constexpr int MAX_EXT_REGISTER_BC = (MAX_WIDE << BASE_OPERAND_BC_BITS) | MAX_BASE_OPERAND_BC;
constexpr int MAX_EXT_REGISTER = MAX_EXT_REGISTER_BC;
constexpr int MAX_EXT_CONST = (1 << (MAX_OPERAND_BITS + EXT_B_BITS - 1)) - 1;
constexpr int MAX_EXT_BX = (MAX_WIDE << BASE_BX_BITS) | MAX_BASE_BX;

int signExtend(uint32_t value, int bits);
uint32_t packInstructionWord(uint8_t op, uint8_t a, uint8_t b, uint8_t c, uint8_t ext = 0);
void writeInstruction(std::vector<uint8_t>& code, int index, uint8_t op, uint8_t a, uint8_t b, uint8_t c, uint8_t ext = 0);
void writeInstructionWord(std::vector<uint8_t>& code, int index, uint32_t word);
uint32_t readInstructionWord(const std::vector<uint8_t>& code, int index);

} // namespace bmsx
