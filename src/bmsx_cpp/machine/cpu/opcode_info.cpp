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

const std::array<u8, OPCODE_COUNT> BASE_CYCLES{
	0u, 1u, 1u, 1u, 1u, 1u, 1u, 1u,
	1u, 1u, 1u, 1u, 1u, 2u, 1u, 2u,
	1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u,
	1u, 1u, 1u, 1u, 1u, 1u, 2u, 1u,
	1u, 1u, 1u, 1u, 1u, 1u, 1u, 2u,
	1u, 1u, 1u, 1u, 1u, 2u, 2u, 2u,
	2u, 1u, 2u, 2u, 1u, 1u, 1u, 2u,
	1u, 2u, 1u, 2u, 1u, 2u, 1u, 1u,
};

const std::array<u8, OPCODE_COUNT> OPCODE_USES_BX{
	0u, // WIDE
	0u, // MOV
	1u, // LOADK
	0u, // LOADNIL
	0u, // LOADBOOL
	0u, // KNIL
	0u, // KFALSE
	0u, // KTRUE
	0u, // K0
	0u, // K1
	0u, // KM1
	1u, // KSMI
	1u, // GETG
	1u, // SETG
	0u, // GETT
	0u, // SETT
	0u, // NEWT
	0u, // ADD
	0u, // SUB
	0u, // MUL
	0u, // DIV
	0u, // MOD
	0u, // FLOORDIV
	0u, // POW
	0u, // BAND
	0u, // BOR
	0u, // BXOR
	0u, // SHL
	0u, // SHR
	0u, // CONCAT
	0u, // CONCATN
	0u, // UNM
	0u, // NOT
	0u, // LEN
	0u, // BNOT
	0u, // EQ
	0u, // LT
	0u, // LE
	0u, // TEST
	0u, // TESTSET
	1u, // JMP
	1u, // JMPIF
	1u, // JMPIFNOT
	1u, // CLOSURE
	0u, // GETUP
	0u, // SETUP
	0u, // VARARG
	0u, // CALL
	0u, // RET
	0u, // LOAD_MEM
	0u, // STORE_MEM
	0u, // STORE_MEM_WORDS
	1u, // BR_TRUE
	1u, // BR_FALSE
	1u, // GETSYS
	1u, // SETSYS
	1u, // GETGL
	1u, // SETGL
	0u, // GETI
	0u, // SETI
	0u, // GETFIELD
	0u, // SETFIELD
	0u, // SELF
	0u, // HALT
};

const std::array<const char*, OPCODE_COUNT> OPCODE_CATEGORY{
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

const char* getOpcodeName(OpCode op) {
	return OPCODE_NAMES[static_cast<size_t>(op)];
}

} // namespace bmsx
