#include "machine/cpu/native_block_compiler.h"

#include <algorithm>
#include <bit>
#include <new>

#include "machine/cpu/execution_image.h"
#include "machine/cpu/table.h"

namespace bmsx {

NativeBlockCompiler::NativeBlockCompiler(const Value* constants, const NativeBlock* block, Memory& memory)
	: m_compiler(nullptr), m_constants(constants), m_block(block), m_memory(memory) {
	m_slowPaths.reserve(std::count_if(block->sideExits.begin(), block->sideExits.end(), [](const auto& exit) {
		return exit.exit == NativeBlockExit::ReadField || exit.exit == NativeBlockExit::WriteField
			|| exit.exit == NativeBlockExit::ReadMemory || exit.exit == NativeBlockExit::WriteMemory;
	}));
	m_compiler = sljit_create_compiler(nullptr);
	if (!m_compiler) throw std::bad_alloc();
	// S0/S1 retain the value banks; S2 retains word/field-address temporaries.
	sljit_emit_enter(m_compiler, 0, SLJIT_ARGS2(P, P, P), 3 | SLJIT_ENTER_FLOAT(3), 3, 0);
}

NativeBlockCompiler::~NativeBlockCompiler() { sljit_free_compiler(m_compiler); }

void NativeBlockCompiler::emit(const DecodedInstruction& instruction, const NativeBlockExitSite* slowExit, const NativeBlockExitSite* takenExit) {
	const auto op = static_cast<OpCode>(instruction.op);
	const bool wordConversion = op == OpCode::BAND || op == OpCode::BOR || op == OpCode::BXOR
		|| op == OpCode::SHL || op == OpCode::SHR || op == OpCode::BNOT;
	if (nativeBlockEndsBlock(instruction.op) || wordConversion || op == OpCode::NOT
		|| nativeBlockSlowExit(instruction.op) != NativeBlockExit::Continue) {
		flushRegister();
	} else if (m_pendingRegister != instruction.a) {
		commitRegister();
	}
	switch (op) {
		case OpCode::MOV:
			loadOperand(instruction.b, SLJIT_FR0);
			break;
		case OpCode::LOADK:
			sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_FR0, 0,
				SLJIT_MEM1(SLJIT_S1), static_cast<sljit_sw>(instruction.bx) * sizeof(Value));
			break;
		case OpCode::KNIL: sljit_emit_fset64(m_compiler, SLJIT_FR0, asNumber(valueNil())); break;
		case OpCode::KFALSE: sljit_emit_fset64(m_compiler, SLJIT_FR0, asNumber(valueBool(false))); break;
		case OpCode::KTRUE: sljit_emit_fset64(m_compiler, SLJIT_FR0, asNumber(valueBool(true))); break;
		case OpCode::K0: sljit_emit_fset64(m_compiler, SLJIT_FR0, 0.0); break;
		case OpCode::K1: sljit_emit_fset64(m_compiler, SLJIT_FR0, 1.0); break;
		case OpCode::KM1: sljit_emit_fset64(m_compiler, SLJIT_FR0, -1.0); break;
		case OpCode::KSMI: sljit_emit_fset64(m_compiler, SLJIT_FR0, instruction.sbx); break;
		case OpCode::ADD:
		case OpCode::SUB:
		case OpCode::MUL:
		case OpCode::DIV: {
			// Preserve a forwarded right operand before replacing FR0 with the left.
			loadOperand(instruction.c, SLJIT_FR1);
			loadOperand(instruction.b, SLJIT_FR0);
			const sljit_s32 operation = op == OpCode::ADD ? SLJIT_ADD_F64
				: op == OpCode::SUB ? SLJIT_SUB_F64
				: op == OpCode::MUL ? SLJIT_MUL_F64 : SLJIT_DIV_F64;
			sljit_emit_fop2(m_compiler, operation, SLJIT_FR0, 0, SLJIT_FR0, 0, SLJIT_FR1, 0);
			canonicalizeNumber();
			break;
		}
		case OpCode::UNM:
			loadOperand(instruction.b, SLJIT_FR0);
			sljit_emit_fop1(m_compiler, SLJIT_NEG_F64, SLJIT_FR0, 0, SLJIT_FR0, 0);
			canonicalizeNumber();
			break;
		case OpCode::NOT: {
			const auto falsey = falseyJumps(instruction.b);
			sljit_emit_fset64(m_compiler, SLJIT_FR0, asNumber(valueBool(false)));
			auto* done = sljit_emit_jump(m_compiler, SLJIT_JUMP);
			auto* falseyLabel = sljit_emit_label(m_compiler);
			for (auto* jump : falsey) sljit_set_label(jump, falseyLabel);
			sljit_emit_fset64(m_compiler, SLJIT_FR0, asNumber(valueBool(true)));
			sljit_set_label(done, sljit_emit_label(m_compiler));
			break;
		}
		case OpCode::BAND:
		case OpCode::BOR:
		case OpCode::BXOR:
		case OpCode::SHL:
		case OpCode::SHR: {
			convertWord(instruction.b);
			sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_S2, 0, SLJIT_R0, 0);
			convertWord(instruction.c);
			if (op == OpCode::SHL || op == OpCode::SHR) {
				sljit_emit_op2(m_compiler, SLJIT_AND32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 31);
			}
			const sljit_s32 operation = op == OpCode::BAND ? SLJIT_AND32
				: op == OpCode::BOR ? SLJIT_OR32
				: op == OpCode::BXOR ? SLJIT_XOR32
				: op == OpCode::SHL ? SLJIT_SHL32 : SLJIT_ASHR32;
			sljit_emit_op2(m_compiler, operation, SLJIT_R0, 0, SLJIT_S2, 0, SLJIT_R0, 0);
			sljit_emit_fop1(m_compiler, SLJIT_CONV_F64_FROM_S32, SLJIT_FR0, 0, SLJIT_R0, 0);
			break;
		}
		case OpCode::BNOT:
			convertWord(instruction.b);
			sljit_emit_op2(m_compiler, SLJIT_XOR32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, -1);
			sljit_emit_fop1(m_compiler, SLJIT_CONV_F64_FROM_S32, SLJIT_FR0, 0, SLJIT_R0, 0);
			break;
		case OpCode::GETFIELD:
		case OpCode::SETFIELD:
			emitTableField(instruction, slowExit);
			if (op == OpCode::GETFIELD) m_pendingRegister = instruction.a;
			return;
		case OpCode::LOAD_MEM:
		case OpCode::LOAD_MEM_D:
		case OpCode::STORE_MEM:
		case OpCode::STORE_MEM_D:
			emitMemory(instruction, slowExit);
			if (slowExit->exit == NativeBlockExit::ReadMemory) m_pendingRegister = instruction.a;
			return;
		case OpCode::JMP:
		case OpCode::HALT:
		case OpCode::CALL:
		case OpCode::RET:
			return;
		case OpCode::JMPIF:
		case OpCode::JMPIFNOT: {
			const auto falsey = falseyJumps(instruction.a);
			sljit_emit_return(m_compiler, SLJIT_MOV_P, SLJIT_IMM, reinterpret_cast<sljit_sw>(
				op == OpCode::JMPIF ? takenExit : &m_block->terminal));
			auto* falseyLabel = sljit_emit_label(m_compiler);
			for (auto* jump : falsey) sljit_set_label(jump, falseyLabel);
			sljit_emit_return(m_compiler, SLJIT_MOV_P, SLJIT_IMM, reinterpret_cast<sljit_sw>(
				op == OpCode::JMPIF ? &m_block->terminal : takenExit));
			return;
		}
		default:
			__builtin_unreachable();
	}
	m_pendingRegister = instruction.a;
}

void* NativeBlockCompiler::finish(size_t& codeBytes) {
	flushRegister();
	sljit_emit_return(m_compiler, SLJIT_MOV_P, SLJIT_IMM, reinterpret_cast<sljit_sw>(&m_block->terminal));
	for (const auto& slow : m_slowPaths) {
		auto* label = sljit_emit_label(m_compiler);
		for (size_t i = 0; i < slow.count; ++i) sljit_set_label(slow.jumps[i], label);
		sljit_emit_return(m_compiler, SLJIT_MOV_P, SLJIT_IMM, reinterpret_cast<sljit_sw>(slow.exit));
	}
	void* code = sljit_generate_code(m_compiler, 0, nullptr);
	if (!code) throw std::bad_alloc();
	codeBytes = sljit_get_generated_code_size(m_compiler);
	return code;
}

void NativeBlockCompiler::emitTableField(const DecodedInstruction& instruction, const NativeBlockExitSite* exit) {
	const bool load = instruction.op == static_cast<u8>(OpCode::GETFIELD);
	const int base = load ? instruction.b : instruction.a;
	const StringId key = asStringId(m_constants[load ? instruction.c : instruction.b]);
	const auto fields = Table::nativeFieldOffsets();
	constexpr sljit_sw headerOffset = std::endian::native == std::endian::little ? 6 : 0;
	constexpr sljit_sw payloadOffset = std::endian::native == std::endian::little ? 0 : 4;
	SlowPath slow;
	slow.exit = exit;
	sljit_emit_op1(m_compiler, SLJIT_MOV_U16, SLJIT_R0, 0,
		SLJIT_MEM1(SLJIT_S0), base * sizeof(Value) + headerOffset);
	slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R0, 0,
		SLJIT_IMM, valueFromTag(ValueTag::Table) >> 48u);
#if defined(SLJIT_64BIT_ARCHITECTURE)
	sljit_emit_op1(m_compiler, SLJIT_MOV, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_S0), base * sizeof(Value));
	sljit_emit_op2(m_compiler, SLJIT_AND, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, VALUE_PAYLOAD_MASK);
#else
	sljit_emit_op1(m_compiler, SLJIT_MOV, SLJIT_R0, 0,
		SLJIT_MEM1(SLJIT_S0), base * sizeof(Value) + payloadOffset);
#endif
	sljit_emit_op1(m_compiler, SLJIT_MOV_S32, SLJIT_R1, 0,
		SLJIT_MEM0(), reinterpret_cast<sljit_sw>(&exit->tableCacheSlot));
	// Unsigned bounds also reject the negative missing-slot sentinel.
	slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_GREATER_EQUAL,
		SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), fields.hashSize);
	sljit_emit_op2(m_compiler, SLJIT_SHL, SLJIT_S2, 0, SLJIT_R1, 0, SLJIT_IMM, 3);
	sljit_emit_op1(m_compiler, SLJIT_MOV, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), fields.keys);
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_S2, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV_U16, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), headerOffset);
	slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R2, 0,
		SLJIT_IMM, valueString(0) >> 48u);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), payloadOffset);
	slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32,
		SLJIT_R2, 0, SLJIT_IMM, key);
	sljit_emit_op1(m_compiler, SLJIT_MOV, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), fields.values);
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_S2, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV_U16, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), headerOffset);
	slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_EQUAL,
		SLJIT_R2, 0, SLJIT_IMM, valueNil() >> 48u);
	if (load) {
		// The raw result remains in FR0 for dependent arithmetic or copies.
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_FR0, 0, SLJIT_MEM1(SLJIT_R1), 0);
	} else {
		const bool constant = instruction.c < 0;
		const int valueIndex = constant ? -instruction.c - 1 : instruction.c;
		const sljit_s32 bank = constant ? SLJIT_S1 : SLJIT_S0;
		sljit_emit_op1(m_compiler, SLJIT_MOV_U16, SLJIT_R2, 0,
			SLJIT_MEM1(bank), valueIndex * sizeof(Value) + headerOffset);
		slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_EQUAL,
			SLJIT_R2, 0, SLJIT_IMM, valueNil() >> 48u);
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_FR0, 0,
			SLJIT_MEM1(bank), valueIndex * sizeof(Value));
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_R1), 0, SLJIT_FR0, 0);
	}
	m_slowPaths.push_back(slow);
}

void NativeBlockCompiler::commitRegister() {
	if (m_pendingRegister < 0) return;
	sljit_emit_fop1(m_compiler, SLJIT_MOV_F64,
		SLJIT_MEM1(SLJIT_S0), static_cast<sljit_sw>(m_pendingRegister) * sizeof(Value), SLJIT_FR0, 0);
}

void NativeBlockCompiler::flushRegister() {
	commitRegister();
	m_pendingRegister = -1;
}

std::array<sljit_jump*, 2> NativeBlockCompiler::falseyJumps(int index) {
	// isTruthy consumes the upper 16-bit Value header, including for
	// representable tagged payloads. Never use floating-point NaN equality.
	constexpr sljit_sw headerOffset = std::endian::native == std::endian::little ? 6 : 0;
	sljit_emit_op1(m_compiler, SLJIT_MOV_U16, SLJIT_R0, 0,
		SLJIT_MEM1(SLJIT_S0), static_cast<sljit_sw>(index) * sizeof(Value) + headerOffset);
	return {
		sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, valueNil() >> 48u),
		sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, valueBool(false) >> 48u),
	};
}

void NativeBlockCompiler::loadOperand(int selector, sljit_s32 floatingRegister) {
	if (selector >= 0 && selector == m_pendingRegister) {
		if (floatingRegister != SLJIT_FR0) {
			sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, floatingRegister, 0, SLJIT_FR0, 0);
		}
		return;
	}
	const bool constant = selector < 0;
	const int index = constant ? -selector - 1 : selector;
	sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, floatingRegister, 0,
		SLJIT_MEM1(constant ? SLJIT_S1 : SLJIT_S0), static_cast<sljit_sw>(index) * sizeof(Value));
}

void NativeBlockCompiler::canonicalizeNumber() {
	// Arithmetic returns the canonical numeric NaN, never a tagged payload.
	auto* ordered = sljit_emit_fcmp(m_compiler, SLJIT_ORDERED,
		SLJIT_FR0, 0, SLJIT_FR0, 0);
	sljit_emit_fset64(m_compiler, SLJIT_FR0, asNumber(VALUE_QNAN_MASK));
	sljit_set_label(ordered, sljit_emit_label(m_compiler));
}

void NativeBlockCompiler::convertWord(int selector) {
	if (selector < 0) {
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM,
			static_cast<sljit_s32>(toU32(m_constants[-selector - 1])));
		return;
	}
	loadOperand(selector, SLJIT_FR0);
	const auto convert = static_cast<uint32_t (*)(double)>(&toU32);
	sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS1(32, F64), SLJIT_IMM, SLJIT_FUNC_ADDR(convert));
}

} // namespace bmsx
