#pragma once

#include "common/types.h"

#include <array>

namespace bmsx {

enum class OpCode : u8 {
	WIDE,
	MOV,
	LOADK,
	LOADNIL,
	LOAD_MEM_D,
	KNIL,
	KFALSE,
	KTRUE,
	K0,
	K1,
	KM1,
	KSMI,
	STORE_MEM_D,
	STORE_MEM_WORDS_D,
	GETT,
	SETT,
	NEWT,
	ADD,
	SUB,
	MUL,
	DIV,
	MOD,
	FLOORDIV,
	POW,
	BAND,
	BOR,
	BXOR,
	SHL,
	SHR,
	CONCAT,
	CONCATN,
	UNM,
	NOT,
	LEN,
	BNOT,
	EQ,
	LT,
	LE,
	RESERVED0,
	RESERVED1,
	JMP,
	JMPIF,
	JMPIFNOT,
	CLOSURE,
	GETUP,
	SETUP,
	VARARG,
	CALL,
	RET,
	LOAD_MEM,
	STORE_MEM,
	STORE_MEM_WORDS,
	RESERVED2,
	RESERVED3,
	GETSYS,
	SETSYS,
	GETGL,
	SETGL,
	GETI,
	SETI,
	GETFIELD,
	SETFIELD,
	SELF,
	HALT,
};

inline constexpr size_t OPCODE_COUNT = 64U;

extern const std::array<const char*, OPCODE_COUNT> OPCODE_NAMES;
extern const std::array<u8, OPCODE_COUNT> BASE_CYCLES;
extern const std::array<u8, OPCODE_COUNT> OPCODE_USES_BX;
extern const std::array<u8, OPCODE_COUNT> OPCODE_USES_DISP;
extern const std::array<const char*, OPCODE_COUNT> OPCODE_CATEGORY;

auto getOpcodeName(OpCode op) -> const char*;

} // namespace bmsx
