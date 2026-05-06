#include "machine/cpu/opcode_info.h"

namespace bmsx {

const std::array<const char*, OPCODE_COUNT> OPCODE_NAMES{
	"WIDE",
	"MOV",
	"LOADK",
	"LOADNIL",
	"LOADBOOL",
	"KNIL",
	"KFALSE",
	"KTRUE",
	"K0",
	"K1",
	"KM1",
	"KSMI",
	"GETG",
	"SETG",
	"GETT",
	"SETT",
	"NEWT",
	"ADD",
	"SUB",
	"MUL",
	"DIV",
	"MOD",
	"FLOORDIV",
	"POW",
	"BAND",
	"BOR",
	"BXOR",
	"SHL",
	"SHR",
	"CONCAT",
	"CONCATN",
	"UNM",
	"NOT",
	"LEN",
	"BNOT",
	"EQ",
	"LT",
	"LE",
	"TEST",
	"TESTSET",
	"JMP",
	"JMPIF",
	"JMPIFNOT",
	"CLOSURE",
	"GETUP",
	"SETUP",
	"VARARG",
	"CALL",
	"RET",
	"LOAD_MEM",
	"STORE_MEM",
	"STORE_MEM_WORDS",
	"BR_TRUE",
	"BR_FALSE",
	"GETSYS",
	"SETSYS",
	"GETGL",
	"SETGL",
	"GETI",
	"SETI",
	"GETFIELD",
	"SETFIELD",
	"SELF",
	"HALT",
};

const std::array<u8, OPCODE_COUNT> OPCODE_BASE_CYCLES{
	0u, 1u, 1u, 1u, 1u, 1u, 1u, 1u,
	1u, 1u, 1u, 1u, 1u, 2u, 1u, 2u,
	1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u,
	1u, 1u, 1u, 1u, 1u, 1u, 2u, 1u,
	1u, 1u, 1u, 1u, 1u, 1u, 1u, 2u,
	1u, 1u, 1u, 1u, 1u, 2u, 2u, 2u,
	2u, 1u, 2u, 2u, 1u, 1u, 1u, 2u,
	1u, 2u, 1u, 2u, 1u, 2u, 1u, 1u,
};

const std::array<const char*, OPCODE_COUNT> OPCODE_CATEGORIES{
	"wide prefix",
	"load/move",
	"load/move",
	"load/move",
	"load/move",
	"load/move",
	"load/move",
	"load/move",
	"load/move",
	"load/move",
	"load/move",
	"load/move",
	"table get/set",
	"table get/set",
	"table get/set",
	"table get/set",
	"table creation",
	"arithmetic",
	"arithmetic",
	"arithmetic",
	"arithmetic",
	"arithmetic",
	"arithmetic",
	"arithmetic",
	"bitwise",
	"bitwise",
	"bitwise",
	"bitwise",
	"bitwise",
	"string concat",
	"string concat",
	"arithmetic",
	"logical",
	"length",
	"bitwise",
	"comparison",
	"comparison",
	"comparison",
	"comparison",
	"comparison",
	"branch/jump",
	"branch/jump",
	"branch/jump",
	"closure creation",
	"upvalue",
	"upvalue",
	"vararg",
	"call/return",
	"call/return",
	"memory I/O",
	"memory I/O",
	"memory I/O",
	"branch/jump",
	"branch/jump",
	"global/sys access",
	"global/sys access",
	"global/sys access",
	"global/sys access",
	"table get/set",
	"table get/set",
	"table get/set",
	"table get/set",
	"table get/set",
	"sleep/halt",
};

const char* opCodeName(OpCode op) {
	return OPCODE_NAMES[static_cast<size_t>(op)];
}

const char* opCodeCategory(OpCode op) {
	return OPCODE_CATEGORIES[static_cast<size_t>(op)];
}

u8 opCodeBaseCycles(OpCode op) {
	return OPCODE_BASE_CYCLES[static_cast<size_t>(op)];
}

bool opCodeUsesBx(OpCode op) {
	switch (op) {
		case OpCode::LOADK:
		case OpCode::KSMI:
		case OpCode::GETG:
		case OpCode::SETG:
		case OpCode::JMP:
		case OpCode::JMPIF:
		case OpCode::JMPIFNOT:
		case OpCode::CLOSURE:
		case OpCode::BR_TRUE:
		case OpCode::BR_FALSE:
		case OpCode::GETSYS:
		case OpCode::SETSYS:
		case OpCode::GETGL:
		case OpCode::SETGL:
			return true;
		default:
			return false;
	}
}

} // namespace bmsx
