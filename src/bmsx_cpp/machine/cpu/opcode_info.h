#pragma once

#include "common/types.h"

#include <array>

namespace bmsx {

enum class OpCode : u8 {
	WIDE,
	MOV,
	LOADK,
	LOADNIL,
	LOADBOOL,
	KNIL,
	KFALSE,
	KTRUE,
	K0,
	K1,
	KM1,
	KSMI,
	GETG,
	SETG,
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
	TEST,
	TESTSET,
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
	BR_TRUE,
	BR_FALSE,
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

inline constexpr size_t OPCODE_COUNT = 64u;

extern const std::array<const char*, OPCODE_COUNT> OPCODE_NAMES;
extern const std::array<u8, OPCODE_COUNT> BASE_CYCLES;
extern const std::array<u8, OPCODE_COUNT> OPCODE_USES_BX;
extern const std::array<const char*, OPCODE_COUNT> OPCODE_CATEGORY;

const char* getOpcodeName(OpCode op);

} // namespace bmsx
