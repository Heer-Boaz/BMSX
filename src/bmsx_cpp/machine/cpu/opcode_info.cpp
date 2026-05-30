#include "machine/cpu/opcode_info.h"

namespace bmsx {

const std::array<const char*, OPCODE_COUNT> OPCODE_NAMES{
	"WIDE",
	"MOV",
	"LOADK",
	"LOADNIL",
	"LOAD_MEM_D",
	"KNIL",
	"KFALSE",
	"KTRUE",
	"K0",
	"K1",
	"KM1",
	"KSMI",
	"STORE_MEM_D",
	"STORE_MEM_WORDS_D",
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
	"RESERVED0",
	"RESERVED1",
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
	"RESERVED2",
	"RESERVED3",
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
	0u, // WIDE
	1u, // MOV
	1u, // LOADK
	1u, // LOADNIL
	2u, // LOAD_MEM_D
	1u, // KNIL
	1u, // KFALSE
	1u, // KTRUE
	1u, // K0
	1u, // K1
	1u, // KM1
	1u, // KSMI
	2u, // STORE_MEM_D
	2u, // STORE_MEM_WORDS_D
	1u, // GETT
	2u, // SETT
	1u, // NEWT
	1u, // ADD
	1u, // SUB
	1u, // MUL
	1u, // DIV
	1u, // MOD
	1u, // FLOORDIV
	1u, // POW
	1u, // BAND
	1u, // BOR
	1u, // BXOR
	1u, // SHL
	1u, // SHR
	1u, // CONCAT
	2u, // CONCATN
	1u, // UNM
	1u, // NOT
	1u, // LEN
	1u, // BNOT
	1u, // EQ
	1u, // LT
	1u, // LE
	1u, // RESERVED0
	1u, // RESERVED1
	1u, // JMP
	1u, // JMPIF
	1u, // JMPIFNOT
	1u, // CLOSURE
	1u, // GETUP
	2u, // SETUP
	2u, // VARARG
	2u, // CALL
	2u, // RET
	2u, // LOAD_MEM
	2u, // STORE_MEM
	2u, // STORE_MEM_WORDS
	1u, // RESERVED2
	1u, // RESERVED3
	1u, // GETSYS
	2u, // SETSYS
	1u, // GETGL
	2u, // SETGL
	1u, // GETI
	2u, // SETI
	1u, // GETFIELD
	2u, // SETFIELD
	1u, // SELF
	1u, // HALT
};

const std::array<u8, OPCODE_COUNT> OPCODE_USES_BX{
	0u, // WIDE
	0u, // MOV
	1u, // LOADK
	0u, // LOADNIL
	0u, // LOAD_MEM_D
	0u, // KNIL
	0u, // KFALSE
	0u, // KTRUE
	0u, // K0
	0u, // K1
	0u, // KM1
	1u, // KSMI
	0u, // STORE_MEM_D
	0u, // STORE_MEM_WORDS_D
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
	0u, // RESERVED0
	0u, // RESERVED1
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
	0u, // RESERVED2
	0u, // RESERVED3
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

const std::array<u8, OPCODE_COUNT> OPCODE_USES_DISP{
	0u, // WIDE
	0u, // MOV
	0u, // LOADK
	0u, // LOADNIL
	1u, // LOAD_MEM_D
	0u, // KNIL
	0u, // KFALSE
	0u, // KTRUE
	0u, // K0
	0u, // K1
	0u, // KM1
	0u, // KSMI
	1u, // STORE_MEM_D
	1u, // STORE_MEM_WORDS_D
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
	0u, // RESERVED0
	0u, // RESERVED1
	0u, // JMP
	0u, // JMPIF
	0u, // JMPIFNOT
	0u, // CLOSURE
	0u, // GETUP
	0u, // SETUP
	0u, // VARARG
	0u, // CALL
	0u, // RET
	0u, // LOAD_MEM
	0u, // STORE_MEM
	0u, // STORE_MEM_WORDS
	0u, // RESERVED2
	0u, // RESERVED3
	0u, // GETSYS
	0u, // SETSYS
	0u, // GETGL
	0u, // SETGL
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
	"memory I/O",
	"load/move",
	"load/move",
	"load/move",
	"load/move",
	"load/move",
	"load/move",
	"load/move",
	"memory I/O",
	"memory I/O",
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
	"reserved",
	"reserved",
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
	"reserved",
	"reserved",
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
