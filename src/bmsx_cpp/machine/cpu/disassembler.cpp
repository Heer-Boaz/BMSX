#include "machine/cpu/disassembler.h"
#include "machine/cpu/source_text.h"
#include "machine/common/number_format.h"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <iomanip>
#include <sstream>
#include <string_view>

namespace bmsx {

namespace {

struct DecodedDebugInstruction {
	int pc = 0;
	OpCode op = OpCode::MOV;
	int a = 0;
	int b = 0;
	int c = 0;
	int bx = 0;
	int sbx = 0;
	int rkBitsB = 0;
	int rkBitsC = 0;
};

struct RkDebugValue {
	std::string text;
	std::optional<int> registerIndex;
};

inline uint32_t readInstructionWordAt(const std::vector<uint8_t>& code, int wordIndex) {
	const size_t offset = static_cast<size_t>(wordIndex) * INSTRUCTION_BYTES;
	return (static_cast<uint32_t>(code[offset]) << 24)
		| (static_cast<uint32_t>(code[offset + 1]) << 16)
		| (static_cast<uint32_t>(code[offset + 2]) << 8)
		| static_cast<uint32_t>(code[offset + 3]);
}

inline int signExtendDebug(uint32_t value, int bits) {
	const int shift = 32 - bits;
	return static_cast<int>(value << shift) >> shift;
}

bool opUsesBx(OpCode op) {
	return op == OpCode::LOADK
		|| op == OpCode::KSMI
		|| op == OpCode::GETG
		|| op == OpCode::SETG
		|| op == OpCode::GETSYS
		|| op == OpCode::SETSYS
		|| op == OpCode::GETGL
		|| op == OpCode::SETGL
		|| op == OpCode::CLOSURE
		|| op == OpCode::JMP
		|| op == OpCode::JMPIF
		|| op == OpCode::JMPIFNOT
		|| op == OpCode::BR_TRUE
		|| op == OpCode::BR_FALSE;
}

const char* opCodeName(OpCode op) {
	switch (op) {
		case OpCode::WIDE: return "WIDE";
		case OpCode::MOV: return "MOV";
		case OpCode::LOADK: return "LOADK";
		case OpCode::LOADNIL: return "LOADNIL";
		case OpCode::LOADBOOL: return "LOADBOOL";
		case OpCode::KNIL: return "KNIL";
		case OpCode::KFALSE: return "KFALSE";
		case OpCode::KTRUE: return "KTRUE";
		case OpCode::K0: return "K0";
		case OpCode::K1: return "K1";
		case OpCode::KM1: return "KM1";
		case OpCode::KSMI: return "KSMI";
		case OpCode::GETG: return "GETG";
		case OpCode::SETG: return "SETG";
		case OpCode::GETI: return "GETI";
		case OpCode::SETI: return "SETI";
		case OpCode::GETFIELD: return "GETFIELD";
		case OpCode::SETFIELD: return "SETFIELD";
		case OpCode::SELF: return "SELF";
		case OpCode::HALT: return "HALT";
		case OpCode::GETT: return "GETT";
		case OpCode::SETT: return "SETT";
		case OpCode::NEWT: return "NEWT";
		case OpCode::ADD: return "ADD";
		case OpCode::SUB: return "SUB";
		case OpCode::MUL: return "MUL";
		case OpCode::DIV: return "DIV";
		case OpCode::MOD: return "MOD";
		case OpCode::FLOORDIV: return "FLOORDIV";
		case OpCode::POW: return "POW";
		case OpCode::BAND: return "BAND";
		case OpCode::BOR: return "BOR";
		case OpCode::BXOR: return "BXOR";
		case OpCode::SHL: return "SHL";
		case OpCode::SHR: return "SHR";
		case OpCode::CONCAT: return "CONCAT";
		case OpCode::CONCATN: return "CONCATN";
		case OpCode::UNM: return "UNM";
		case OpCode::NOT: return "NOT";
		case OpCode::LEN: return "LEN";
		case OpCode::BNOT: return "BNOT";
		case OpCode::EQ: return "EQ";
		case OpCode::LT: return "LT";
		case OpCode::LE: return "LE";
		case OpCode::TEST: return "TEST";
		case OpCode::TESTSET: return "TESTSET";
		case OpCode::JMP: return "JMP";
		case OpCode::JMPIF: return "JMPIF";
		case OpCode::JMPIFNOT: return "JMPIFNOT";
		case OpCode::CLOSURE: return "CLOSURE";
		case OpCode::GETUP: return "GETUP";
		case OpCode::SETUP: return "SETUP";
		case OpCode::VARARG: return "VARARG";
		case OpCode::CALL: return "CALL";
		case OpCode::RET: return "RET";
		case OpCode::LOAD_MEM: return "LOAD_MEM";
		case OpCode::STORE_MEM: return "STORE_MEM";
		case OpCode::STORE_MEM_WORDS: return "STORE_MEM_WORDS";
		case OpCode::BR_TRUE: return "BR_TRUE";
		case OpCode::BR_FALSE: return "BR_FALSE";
		case OpCode::GETSYS: return "GETSYS";
		case OpCode::SETSYS: return "SETSYS";
		case OpCode::GETGL: return "GETGL";
		case OpCode::SETGL: return "SETGL";
	}
	return "UNKNOWN";
}

int hexWidth(int value) {
	int width = 1;
	uint32_t current = static_cast<uint32_t>(value);
	while (current >= 16U) {
		current >>= 4U;
		width += 1;
	}
	return width;
}

std::string formatPcHex(int pc, int width) {
	std::ostringstream out;
	out << std::uppercase << std::hex << std::setfill('0') << std::setw(width) << pc << 'h';
	return out.str();
}

std::string formatBoolLiteral(int value) {
	return value != 0 ? "true" : "false";
}

std::string formatCountLiteral(int value) {
	return value == 0 ? "*" : std::to_string(value);
}

std::string formatConstValue(const Program& program, int index) {
	const StringPool& stringPool = program.constPoolStringPool ? *program.constPoolStringPool : program.stringPool;
	return "k" + std::to_string(index) + "(" + valueToString(program.constPool.at(static_cast<size_t>(index)), stringPool) + ")";
}

RkDebugValue describeRkValue(const Program& program, uint32_t raw, int bits) {
	const int rk = signExtendDebug(raw, bits);
	if (rk < 0) {
		return { formatConstValue(program, -1 - rk), std::nullopt };
	}
	return { "r" + std::to_string(rk), rk };
}

std::string formatSignedOffset(int value, int width) {
	const char sign = value < 0 ? '-' : '+';
	const int absValue = value < 0 ? -value : value;
	return std::string(1, sign) + formatPcHex(absValue, width);
}

std::string formatJumpTarget(int pc, int sbx, int pcWidth) {
	const int offset = sbx * INSTRUCTION_BYTES;
	const int target = pc + INSTRUCTION_BYTES + offset;
	return formatSignedOffset(offset, pcWidth) + " -> " + formatPcHex(target, pcWidth);
}

std::string formatProtoOperand(const ProgramMetadata* metadata, int bx) {
	if (!metadata) {
		return "p" + std::to_string(bx);
	}
	if (bx < 0 || bx >= static_cast<int>(metadata->protoIds.size())) {
		throw BMSX_RUNTIME_ERROR("[Disassembler] Missing proto id for index " + std::to_string(bx) + ".");
	}
	return "p" + std::to_string(bx) + " (" + metadata->protoIds[static_cast<size_t>(bx)] + ")";
}

std::string formatGlobalSlotOperand(const ProgramMetadata* metadata, int slot, bool system) {
	const char* prefix = system ? "sys" : "gl";
	if (!metadata) {
		return std::string(prefix) + std::to_string(slot);
	}
	const std::vector<std::string>& names = system ? metadata->systemGlobalNames : metadata->globalNames;
	if (slot < 0 || slot >= static_cast<int>(names.size())) {
		throw BMSX_RUNTIME_ERROR(std::string("[Disassembler] Missing ") + prefix + " slot name for index " + std::to_string(slot) + ".");
	}
	return std::string(prefix) + std::to_string(slot) + " (" + names[static_cast<size_t>(slot)] + ")";
}

std::string formatRKOperand(const Program& program, uint32_t raw, int bits) {
	return describeRkValue(program, raw, bits).text;
}

InstructionOperandDebugInfo registerOperand(const char* label, int index) {
	return InstructionOperandDebugInfo{label, "r" + std::to_string(index), index};
}

InstructionOperandDebugInfo plainOperand(const char* label, std::string text) {
	return InstructionOperandDebugInfo{label, std::move(text), std::nullopt};
}

InstructionOperandDebugInfo rkOperand(const char* label, const Program& program, uint32_t raw, int bits) {
	const RkDebugValue rk = describeRkValue(program, raw, bits);
	return InstructionOperandDebugInfo{label, rk.text, rk.registerIndex};
}

DecodedDebugInstruction decodeInstructionFromStart(const Program& program, int pc) {
	const std::vector<uint8_t>& code = program.code;
	const int wordIndex = pc / INSTRUCTION_BYTES;
	const uint32_t word = readInstructionWordAt(code, wordIndex);
	const uint32_t ext = word >> 24;
	const auto op = static_cast<OpCode>((word >> 18) & 0x3f);
	const int aLow = static_cast<int>((word >> 12) & 0x3f);
	const int bLow = static_cast<int>((word >> 6) & 0x3f);
	const int cLow = static_cast<int>(word & 0x3f);
	if (op == OpCode::WIDE) {
		const int wideB = bLow;
		const uint32_t nextWord = readInstructionWordAt(code, wordIndex + 1);
		const uint32_t nextExt = nextWord >> 24;
		const auto nextOp = static_cast<OpCode>((nextWord >> 18) & 0x3f);
		const int nextA = static_cast<int>((nextWord >> 12) & 0x3f);
		const int nextB = static_cast<int>((nextWord >> 6) & 0x3f);
		const int nextC = static_cast<int>(nextWord & 0x3f);
		const bool usesBx = opUsesBx(nextOp);
		const int extA = usesBx ? 0 : static_cast<int>((nextExt >> 6) & 0x3);
		const int extB = usesBx ? 0 : static_cast<int>((nextExt >> 3) & 0x7);
		const int extC = usesBx ? 0 : static_cast<int>(nextExt & 0x7);
		const int aShift = MAX_OPERAND_BITS + (usesBx ? 0 : EXT_A_BITS);
		const int a = (aLow << aShift) | (extA << MAX_OPERAND_BITS) | nextA;
		const int b = (wideB << (MAX_OPERAND_BITS + EXT_B_BITS)) | (extB << MAX_OPERAND_BITS) | nextB;
		const int c = (cLow << (MAX_OPERAND_BITS + EXT_C_BITS)) | (extC << MAX_OPERAND_BITS) | nextC;
		const uint32_t bxLow = (static_cast<uint32_t>(nextB) << 6U) | static_cast<uint32_t>(nextC);
		const uint32_t bxExt = usesBx ? nextExt : 0U;
		const uint32_t bx = (static_cast<uint32_t>(wideB) << (MAX_BX_BITS + EXT_BX_BITS)) | (bxExt << MAX_BX_BITS) | bxLow;
		const int sbxBits = MAX_BX_BITS + EXT_BX_BITS + MAX_OPERAND_BITS;
		return DecodedDebugInstruction{
			pc + INSTRUCTION_BYTES,
			nextOp,
			a,
			b,
			c,
			static_cast<int>(bx),
			signExtendDebug(bx, sbxBits),
			MAX_OPERAND_BITS + EXT_B_BITS + MAX_OPERAND_BITS,
			MAX_OPERAND_BITS + EXT_C_BITS + MAX_OPERAND_BITS,
		};
	}
	const bool usesBx = opUsesBx(op);
	const int extA = usesBx ? 0 : static_cast<int>((ext >> 6) & 0x3);
	const int extB = usesBx ? 0 : static_cast<int>((ext >> 3) & 0x7);
	const int extC = usesBx ? 0 : static_cast<int>(ext & 0x7);
	const int a = (extA << MAX_OPERAND_BITS) | aLow;
	const int b = (extB << MAX_OPERAND_BITS) | bLow;
	const int c = (extC << MAX_OPERAND_BITS) | cLow;
	const uint32_t bxLow = (static_cast<uint32_t>(bLow) << 6U) | static_cast<uint32_t>(cLow);
	const uint32_t bxExt = usesBx ? ext : 0U;
	const uint32_t bx = (bxExt << MAX_BX_BITS) | bxLow;
	return DecodedDebugInstruction{
		pc,
		op,
		a,
		b,
		c,
		static_cast<int>(bx),
		signExtendDebug(bx, MAX_BX_BITS + EXT_BX_BITS),
		MAX_OPERAND_BITS + EXT_B_BITS,
		MAX_OPERAND_BITS + EXT_C_BITS,
	};
}

DecodedDebugInstruction decodeInstructionAtPcInternal(const Program& program, int pc) {
	if ((pc % INSTRUCTION_BYTES) != 0) {
		throw BMSX_RUNTIME_ERROR("[Disassembler] Instruction pc " + std::to_string(pc) + " is not aligned.");
	}
	if (pc < 0 || pc >= static_cast<int>(program.code.size())) {
		throw BMSX_RUNTIME_ERROR("[Disassembler] Instruction pc " + std::to_string(pc) + " is out of bounds.");
	}
	const int wordIndex = pc / INSTRUCTION_BYTES;
	const uint32_t word = readInstructionWordAt(program.code, wordIndex);
	const auto op = static_cast<OpCode>((word >> 18) & 0x3f);
	if (op == OpCode::WIDE) {
		return decodeInstructionFromStart(program, pc);
	}
	if (wordIndex > 0) {
		const uint32_t previous = readInstructionWordAt(program.code, wordIndex - 1);
		const auto previousOp = static_cast<OpCode>((previous >> 18) & 0x3f);
		if (previousOp == OpCode::WIDE) {
			return decodeInstructionFromStart(program, pc - INSTRUCTION_BYTES);
		}
	}
	return decodeInstructionFromStart(program, pc);
}

std::string formatInstructionText(const DecodedDebugInstruction& decoded, const Program& program, const ProgramMetadata* metadata, int pcWidth) {
	switch (decoded.op) {
		case OpCode::MOV:
			return "MOV r" + std::to_string(decoded.a) + ", r" + std::to_string(decoded.b);
		case OpCode::KNIL:
			return "KNIL r" + std::to_string(decoded.a);
		case OpCode::KFALSE:
			return "KFALSE r" + std::to_string(decoded.a);
		case OpCode::KTRUE:
			return "KTRUE r" + std::to_string(decoded.a);
		case OpCode::K0:
			return "K0 r" + std::to_string(decoded.a);
		case OpCode::K1:
			return "K1 r" + std::to_string(decoded.a);
		case OpCode::KM1:
			return "KM1 r" + std::to_string(decoded.a);
		case OpCode::KSMI:
			return "KSMI r" + std::to_string(decoded.a) + ", " + formatNumber(decoded.sbx);
		case OpCode::LOADK:
			return "LOADK r" + std::to_string(decoded.a) + ", " + formatConstValue(program, decoded.bx);
		case OpCode::LOADNIL:
			return "LOADNIL r" + std::to_string(decoded.a) + ", " + std::to_string(decoded.b);
		case OpCode::LOADBOOL:
			return "LOADBOOL r" + std::to_string(decoded.a) + ", " + formatBoolLiteral(decoded.b) + ", " + formatBoolLiteral(decoded.c);
		case OpCode::GETG:
			return "GETG r" + std::to_string(decoded.a) + ", " + formatConstValue(program, decoded.bx);
		case OpCode::SETG:
			return "SETG r" + std::to_string(decoded.a) + ", " + formatConstValue(program, decoded.bx);
		case OpCode::GETSYS:
			return "GETSYS r" + std::to_string(decoded.a) + ", " + formatGlobalSlotOperand(metadata, decoded.bx, true);
		case OpCode::SETSYS:
			return "SETSYS r" + std::to_string(decoded.a) + ", " + formatGlobalSlotOperand(metadata, decoded.bx, true);
		case OpCode::GETGL:
			return "GETGL r" + std::to_string(decoded.a) + ", " + formatGlobalSlotOperand(metadata, decoded.bx, false);
		case OpCode::SETGL:
			return "SETGL r" + std::to_string(decoded.a) + ", " + formatGlobalSlotOperand(metadata, decoded.bx, false);
		case OpCode::GETI:
			return "GETI r" + std::to_string(decoded.a) + ", r" + std::to_string(decoded.b) + ", " + std::to_string(decoded.c);
		case OpCode::SETI:
			return "SETI r" + std::to_string(decoded.a) + ", " + std::to_string(decoded.b) + ", " + describeRkValue(program, static_cast<uint32_t>(decoded.c), decoded.rkBitsC).text;
		case OpCode::GETFIELD:
			return "GETFIELD r" + std::to_string(decoded.a) + ", r" + std::to_string(decoded.b) + ", " + formatConstValue(program, decoded.c);
		case OpCode::SETFIELD:
			return "SETFIELD r" + std::to_string(decoded.a) + ", " + formatConstValue(program, decoded.b) + ", " + describeRkValue(program, static_cast<uint32_t>(decoded.c), decoded.rkBitsC).text;
		case OpCode::SELF:
			return "SELF r" + std::to_string(decoded.a) + ", r" + std::to_string(decoded.a + 1) + ", r" + std::to_string(decoded.b) + ", " + formatConstValue(program, decoded.c);
		case OpCode::GETT:
			return "GETT r" + std::to_string(decoded.a) + ", r" + std::to_string(decoded.b) + ", " + describeRkValue(program, static_cast<uint32_t>(decoded.c), decoded.rkBitsC).text;
		case OpCode::SETT:
			return "SETT r" + std::to_string(decoded.a) + ", " + describeRkValue(program, static_cast<uint32_t>(decoded.b), decoded.rkBitsB).text + ", " + describeRkValue(program, static_cast<uint32_t>(decoded.c), decoded.rkBitsC).text;
		case OpCode::NEWT:
			return "NEWT r" + std::to_string(decoded.a) + ", " + std::to_string(decoded.b) + ", " + std::to_string(decoded.c);
		case OpCode::ADD:
		case OpCode::SUB:
		case OpCode::MUL:
		case OpCode::DIV:
		case OpCode::MOD:
		case OpCode::FLOORDIV:
		case OpCode::POW:
		case OpCode::BAND:
		case OpCode::BOR:
		case OpCode::BXOR:
		case OpCode::SHL:
		case OpCode::SHR:
		case OpCode::CONCAT:
			return std::string(opCodeName(decoded.op)) + " r" + std::to_string(decoded.a) + ", " + describeRkValue(program, static_cast<uint32_t>(decoded.b), decoded.rkBitsB).text + ", " + describeRkValue(program, static_cast<uint32_t>(decoded.c), decoded.rkBitsC).text;
		case OpCode::CONCATN:
			return "CONCATN r" + std::to_string(decoded.a) + ", r" + std::to_string(decoded.b) + ", " + std::to_string(decoded.c);
		case OpCode::UNM:
		case OpCode::NOT:
		case OpCode::LEN:
		case OpCode::BNOT:
			return std::string(opCodeName(decoded.op)) + " r" + std::to_string(decoded.a) + ", r" + std::to_string(decoded.b);
		case OpCode::EQ:
		case OpCode::LT:
		case OpCode::LE:
			return std::string(opCodeName(decoded.op)) + " " + formatBoolLiteral(decoded.a) + ", " + describeRkValue(program, static_cast<uint32_t>(decoded.b), decoded.rkBitsB).text + ", " + describeRkValue(program, static_cast<uint32_t>(decoded.c), decoded.rkBitsC).text;
		case OpCode::TEST:
			return "TEST r" + std::to_string(decoded.a) + ", " + formatBoolLiteral(decoded.c);
		case OpCode::TESTSET:
			return "TESTSET r" + std::to_string(decoded.a) + ", r" + std::to_string(decoded.b) + ", " + formatBoolLiteral(decoded.c);
		case OpCode::JMP:
			return "JMP " + formatJumpTarget(decoded.pc, decoded.sbx, pcWidth);
		case OpCode::JMPIF:
			return "JMPIF r" + std::to_string(decoded.a) + ", " + formatJumpTarget(decoded.pc, decoded.sbx, pcWidth);
		case OpCode::JMPIFNOT:
			return "JMPIFNOT r" + std::to_string(decoded.a) + ", " + formatJumpTarget(decoded.pc, decoded.sbx, pcWidth);
		case OpCode::BR_TRUE:
			return "BR_TRUE r" + std::to_string(decoded.a) + ", " + formatJumpTarget(decoded.pc, decoded.sbx, pcWidth);
		case OpCode::BR_FALSE:
			return "BR_FALSE r" + std::to_string(decoded.a) + ", " + formatJumpTarget(decoded.pc, decoded.sbx, pcWidth);
		case OpCode::CLOSURE:
			return "CLOSURE r" + std::to_string(decoded.a) + ", " + formatProtoOperand(metadata, decoded.bx);
		case OpCode::GETUP:
			return "GETUP r" + std::to_string(decoded.a) + ", u" + std::to_string(decoded.b);
		case OpCode::SETUP:
			return "SETUP r" + std::to_string(decoded.a) + ", u" + std::to_string(decoded.b);
		case OpCode::VARARG:
			return "VARARG r" + std::to_string(decoded.a) + ", " + formatCountLiteral(decoded.b);
		case OpCode::CALL:
			return "CALL r" + std::to_string(decoded.a) + ", " + formatCountLiteral(decoded.b) + ", " + formatCountLiteral(decoded.c);
		case OpCode::RET:
			return "RET r" + std::to_string(decoded.a) + ", " + formatCountLiteral(decoded.b);
		case OpCode::LOAD_MEM:
			return "LOAD_MEM r" + std::to_string(decoded.a) + ", " + formatRKOperand(program, static_cast<uint32_t>(decoded.b), decoded.rkBitsB);
		case OpCode::STORE_MEM:
			return "STORE_MEM r" + std::to_string(decoded.a) + ", " + formatRKOperand(program, static_cast<uint32_t>(decoded.b), decoded.rkBitsB);
		case OpCode::STORE_MEM_WORDS:
			return "STORE_MEM_WORDS r" + std::to_string(decoded.a) + ", " + formatRKOperand(program, static_cast<uint32_t>(decoded.b), decoded.rkBitsB) + ", " + std::to_string(decoded.c);
		case OpCode::HALT:
			return "HALT";
		case OpCode::WIDE:
			break;
	}
	throw BMSX_RUNTIME_ERROR("[Disassembler] Unexpected WIDE opcode in instruction formatter.");
}

std::vector<InstructionOperandDebugInfo> buildInstructionOperands(const DecodedDebugInstruction& decoded, const Program& program, const ProgramMetadata* metadata, int pcWidth) {
	switch (decoded.op) {
		case OpCode::MOV:
			return {registerOperand("dst", decoded.a), registerOperand("src", decoded.b)};
		case OpCode::KNIL:
			return {registerOperand("dst", decoded.a)};
		case OpCode::KFALSE:
			return {registerOperand("dst", decoded.a)};
		case OpCode::KTRUE:
			return {registerOperand("dst", decoded.a)};
		case OpCode::K0:
			return {registerOperand("dst", decoded.a)};
		case OpCode::K1:
			return {registerOperand("dst", decoded.a)};
		case OpCode::KM1:
			return {registerOperand("dst", decoded.a)};
		case OpCode::KSMI:
			return {registerOperand("dst", decoded.a), plainOperand("imm", formatNumber(decoded.sbx))};
		case OpCode::LOADK:
			return {registerOperand("dst", decoded.a), plainOperand("const", formatConstValue(program, decoded.bx))};
		case OpCode::LOADNIL:
			return {registerOperand("base", decoded.a), plainOperand("count", std::to_string(decoded.b))};
		case OpCode::LOADBOOL:
			return {registerOperand("dst", decoded.a), plainOperand("value", formatBoolLiteral(decoded.b)), plainOperand("skip-next", formatBoolLiteral(decoded.c))};
		case OpCode::GETG:
			return {registerOperand("dst", decoded.a), plainOperand("global", formatConstValue(program, decoded.bx))};
		case OpCode::SETG:
			return {registerOperand("src", decoded.a), plainOperand("global", formatConstValue(program, decoded.bx))};
		case OpCode::GETSYS:
			return {registerOperand("dst", decoded.a), plainOperand("slot", formatGlobalSlotOperand(metadata, decoded.bx, true))};
		case OpCode::SETSYS:
			return {registerOperand("src", decoded.a), plainOperand("slot", formatGlobalSlotOperand(metadata, decoded.bx, true))};
		case OpCode::GETGL:
			return {registerOperand("dst", decoded.a), plainOperand("slot", formatGlobalSlotOperand(metadata, decoded.bx, false))};
		case OpCode::SETGL:
			return {registerOperand("src", decoded.a), plainOperand("slot", formatGlobalSlotOperand(metadata, decoded.bx, false))};
		case OpCode::GETI:
			return {registerOperand("dst", decoded.a), registerOperand("table", decoded.b), plainOperand("index", std::to_string(decoded.c))};
		case OpCode::SETI:
			return {registerOperand("table", decoded.a), plainOperand("index", std::to_string(decoded.b)), rkOperand("value", program, static_cast<uint32_t>(decoded.c), decoded.rkBitsC)};
		case OpCode::GETFIELD:
			return {registerOperand("dst", decoded.a), registerOperand("table", decoded.b), plainOperand("field", formatConstValue(program, decoded.c))};
		case OpCode::SETFIELD:
			return {registerOperand("table", decoded.a), plainOperand("field", formatConstValue(program, decoded.b)), rkOperand("value", program, static_cast<uint32_t>(decoded.c), decoded.rkBitsC)};
		case OpCode::SELF:
			return {registerOperand("fn_dst", decoded.a), plainOperand("self_dst", "r" + std::to_string(decoded.a + 1)), registerOperand("table", decoded.b), plainOperand("field", formatConstValue(program, decoded.c))};
		case OpCode::GETT:
			return {registerOperand("dst", decoded.a), registerOperand("table", decoded.b), rkOperand("key", program, static_cast<uint32_t>(decoded.c), decoded.rkBitsC)};
		case OpCode::SETT:
			return {registerOperand("table", decoded.a), rkOperand("key", program, static_cast<uint32_t>(decoded.b), decoded.rkBitsB), rkOperand("value", program, static_cast<uint32_t>(decoded.c), decoded.rkBitsC)};
		case OpCode::NEWT:
			return {registerOperand("dst", decoded.a), plainOperand("array", std::to_string(decoded.b)), plainOperand("hash", std::to_string(decoded.c))};
		case OpCode::ADD:
		case OpCode::SUB:
		case OpCode::MUL:
		case OpCode::DIV:
		case OpCode::MOD:
		case OpCode::FLOORDIV:
		case OpCode::POW:
		case OpCode::BAND:
		case OpCode::BOR:
		case OpCode::BXOR:
		case OpCode::SHL:
		case OpCode::SHR:
		case OpCode::CONCAT:
			return {registerOperand("dst", decoded.a), rkOperand("left", program, static_cast<uint32_t>(decoded.b), decoded.rkBitsB), rkOperand("right", program, static_cast<uint32_t>(decoded.c), decoded.rkBitsC)};
		case OpCode::CONCATN:
			return {registerOperand("dst", decoded.a), registerOperand("base", decoded.b), plainOperand("count", std::to_string(decoded.c))};
		case OpCode::UNM:
		case OpCode::NOT:
		case OpCode::LEN:
		case OpCode::BNOT:
			return {registerOperand("dst", decoded.a), registerOperand("value", decoded.b)};
		case OpCode::EQ:
		case OpCode::LT:
		case OpCode::LE:
			return {plainOperand("expect", formatBoolLiteral(decoded.a)), rkOperand("left", program, static_cast<uint32_t>(decoded.b), decoded.rkBitsB), rkOperand("right", program, static_cast<uint32_t>(decoded.c), decoded.rkBitsC)};
		case OpCode::TEST:
			return {registerOperand("value", decoded.a), plainOperand("expect", formatBoolLiteral(decoded.c))};
		case OpCode::TESTSET:
			return {registerOperand("dst", decoded.a), registerOperand("value", decoded.b), plainOperand("expect", formatBoolLiteral(decoded.c))};
		case OpCode::JMP:
			return {plainOperand("jump", formatJumpTarget(decoded.pc, decoded.sbx, pcWidth))};
		case OpCode::JMPIF:
		case OpCode::JMPIFNOT:
			return {registerOperand("cond", decoded.a), plainOperand("jump", formatJumpTarget(decoded.pc, decoded.sbx, pcWidth))};
		case OpCode::BR_TRUE:
		case OpCode::BR_FALSE:
			return {registerOperand("cond", decoded.a), plainOperand("jump", formatJumpTarget(decoded.pc, decoded.sbx, pcWidth))};
		case OpCode::CLOSURE:
			return {registerOperand("dst", decoded.a), plainOperand("proto", formatProtoOperand(metadata, decoded.bx))};
		case OpCode::GETUP:
			return {registerOperand("dst", decoded.a), plainOperand("upvalue", "u" + std::to_string(decoded.b))};
		case OpCode::SETUP:
			return {registerOperand("src", decoded.a), plainOperand("upvalue", "u" + std::to_string(decoded.b))};
		case OpCode::VARARG:
			return {registerOperand("dst", decoded.a), plainOperand("count", formatCountLiteral(decoded.b))};
		case OpCode::CALL:
			return {registerOperand("callee", decoded.a), plainOperand("args", formatCountLiteral(decoded.b)), plainOperand("returns", formatCountLiteral(decoded.c))};
		case OpCode::RET:
			return {registerOperand("base", decoded.a), plainOperand("count", formatCountLiteral(decoded.b))};
		case OpCode::LOAD_MEM:
			return {registerOperand("dst", decoded.a), rkOperand("addr", program, static_cast<uint32_t>(decoded.b), decoded.rkBitsB)};
		case OpCode::STORE_MEM:
			return {registerOperand("src", decoded.a), rkOperand("addr", program, static_cast<uint32_t>(decoded.b), decoded.rkBitsB)};
		case OpCode::STORE_MEM_WORDS:
			return {registerOperand("src_base", decoded.a), rkOperand("addr", program, static_cast<uint32_t>(decoded.b), decoded.rkBitsB), plainOperand("count", std::to_string(decoded.c))};
		case OpCode::HALT:
			return {};
		case OpCode::WIDE:
			break;
	}
	throw BMSX_RUNTIME_ERROR("[Disassembler] Unexpected WIDE opcode in operand formatter.");
}

std::string compactWhitespace(std::string_view value) {
	std::string out;
	out.reserve(value.size());
	bool pendingSpace = false;
	for (char ch : value) {
		const unsigned char byte = static_cast<unsigned char>(ch);
		if (std::isspace(byte) != 0) {
			pendingSpace = !out.empty();
			continue;
		}
		if (pendingSpace) {
			out.push_back(' ');
			pendingSpace = false;
		}
		out.push_back(ch);
	}
	return out;
}

} // namespace

InstructionDebugInfo describeInstructionAtPc(const Program& program, const ProgramMetadata* metadata, int pc) {
	const int lastPc = std::max(0, static_cast<int>(program.code.size()) - INSTRUCTION_BYTES);
	const int pcWidth = hexWidth(lastPc);
	const DecodedDebugInstruction decoded = decodeInstructionAtPcInternal(program, pc);
	const int wordIndex = decoded.pc / INSTRUCTION_BYTES;
	std::optional<SourceRange> sourceRange = std::nullopt;
	if (metadata && wordIndex >= 0 && wordIndex < static_cast<int>(metadata->debugRanges.size())) {
		sourceRange = metadata->debugRanges[static_cast<size_t>(wordIndex)];
	}
	return InstructionDebugInfo{
		decoded.pc,
		formatPcHex(decoded.pc, pcWidth),
		decoded.op,
		opCodeName(decoded.op),
		formatInstructionText(decoded, program, metadata, pcWidth),
		buildInstructionOperands(decoded, program, metadata, pcWidth),
		sourceRange,
	};
}

std::string formatSourceSnippet(const SourceRange& range, const std::string& source) {
	std::string snippet;
	if (!extractSourceRangeText(range, source, snippet)) {
		return {};
	}
	std::string compact = compactWhitespace(snippet);
	if (compact.empty()) {
		return "<empty>";
	}
	static constexpr size_t kMaxChars = 120;
	if (compact.size() <= kMaxChars) {
		return compact;
	}
	return compact.substr(0, kMaxChars - 3) + "...";
}

} // namespace bmsx
