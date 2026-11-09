#include "machine/cpu/native_block_compiler.h"

#include <algorithm>
#include <bit>
#include <new>

#include "machine/cpu/execution_image.h"
#include "machine/cpu/table.h"
#include "spec/blua32/memory_access_kind.h"

namespace bmsx {

NativeBlockCompiler::NativeBlockCompiler(const Value* constants, const NativeBlock* block, Memory& memory, StringPool& strings,
	std::span<const NativeBlockInstruction> instructions)
	: m_compiler(nullptr), m_constants(constants), m_block(block), m_memory(memory), m_strings(strings) {
	size_t slowPaths = 0, readMappings = 0;
	bool calls = false;
	for (const auto& source : instructions) {
		const auto& instruction = *source.decoded;
		const auto op = static_cast<OpCode>(instruction.op);
		const auto slow = nativeBlockSlowExit(instruction.op);
		slowPaths += slow == NativeBlockExit::ReadField || slow == NativeBlockExit::WriteField
			|| slow == NativeBlockExit::WriteMemory
			|| (slow == NativeBlockExit::ReadMemory && instruction.c != static_cast<i16>(MemoryAccessKind::U8));
		readMappings += slow == NativeBlockExit::ReadMemory;
		calls |= (op == OpCode::BNOT && instruction.b >= 0)
			|| ((op == OpCode::BAND || op == OpCode::BOR || op == OpCode::BXOR || op == OpCode::SHL || op == OpCode::SHR)
				&& (instruction.b >= 0 || instruction.c >= 0))
			|| ((slow == NativeBlockExit::ReadMemory || slow == NativeBlockExit::WriteMemory)
			&& (instruction.b >= 0 || (slow == NativeBlockExit::WriteMemory
				&& instruction.c != static_cast<i16>(MemoryAccessKind::F32LE)
				&& instruction.c != static_cast<i16>(MemoryAccessKind::F64LE))));
	}
	m_slowPaths.reserve(slowPaths);
	m_readMappings.reserve(readMappings);
	m_useSavedFloats = calls && SLJIT_NUMBER_OF_SAVED_FLOAT_REGISTERS >= REGISTER_CACHE_CAPACITY;
	m_registerCount = m_useSavedFloats ? REGISTER_CACHE_CAPACITY
		: std::min(REGISTER_CACHE_CAPACITY, SLJIT_NUMBER_OF_FLOAT_REGISTERS - SLJIT_NUMBER_OF_SAVED_FLOAT_REGISTERS - 3);
	m_compiler = sljit_create_compiler(nullptr);
	if (!m_compiler) throw std::bad_alloc();
	// Every body shares one frame layout, so a linked jump skips the target's
	// prologue and any target exit can unwind the original entry frame. S0/S1
	// retain the value banks, S2 is temporary, S3 retains the result address.
	// S4/S5 keep cycles/top local until the entire chain actually returns.
	const int scratchFloats = 3 + std::min(REGISTER_CACHE_CAPACITY,
		SLJIT_NUMBER_OF_FLOAT_REGISTERS - SLJIT_NUMBER_OF_SAVED_FLOAT_REGISTERS - 3);
	const int savedFloats = std::min(REGISTER_CACHE_CAPACITY, SLJIT_NUMBER_OF_SAVED_FLOAT_REGISTERS);
	sljit_emit_enter(m_compiler, 0, SLJIT_ARGS3(P, P, P, P),
		3 | SLJIT_ENTER_FLOAT(scratchFloats), 6 | SLJIT_ENTER_FLOAT(savedFloats),
		REGISTER_CACHE_CAPACITY * sizeof(Value));
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_S3, 0, SLJIT_S2, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_S4, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, remainingCycles));
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_S5, 0, SLJIT_IMM, 0);
	m_body = sljit_emit_label(m_compiler);
}

NativeBlockCompiler::~NativeBlockCompiler() { sljit_free_compiler(m_compiler); }

void NativeBlockCompiler::emit(const DecodedInstruction& instruction, const NativeBlockExitSite* slowExit, const NativeBlockExitSite* takenExit) {
	const auto op = static_cast<OpCode>(instruction.op);
	if (nativeBlockEndsBlock(instruction.op)) flushRegisters();
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
			if (op == OpCode::GETFIELD) writeRegister(instruction.a);
			return;
		case OpCode::LOAD_MEM:
		case OpCode::LOAD_MEM_D:
		case OpCode::STORE_MEM:
		case OpCode::STORE_MEM_D:
			emitMemory(instruction, slowExit);
			if (slowExit->exit == NativeBlockExit::ReadMemory) writeRegister(instruction.a);
			return;
		case OpCode::JMP:
		case OpCode::HALT:
		case OpCode::CALL:
		case OpCode::RET:
			return;
		case OpCode::JMPIF:
		case OpCode::JMPIFNOT: {
			m_hasTerminal = true;
			const auto falsey = falseyJumps(instruction.a);
			emitExit(op == OpCode::JMPIF ? takenExit : &m_block->terminal);
			auto* falseyLabel = sljit_emit_label(m_compiler);
			for (auto* jump : falsey) sljit_set_label(jump, falseyLabel);
			emitExit(op == OpCode::JMPIF ? &m_block->terminal : takenExit);
			return;
		}
		case OpCode::EQ:
		case OpCode::LT:
		case OpCode::LE:
			emitComparison(instruction, takenExit);
			m_hasTerminal = true;
			return;
		default:
			__builtin_unreachable();
	}
	writeRegister(instruction.a);
}

void NativeBlockCompiler::emitExit(const NativeBlockExitSite* exit) {
	sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_S4, 0, SLJIT_S4, 0, SLJIT_IMM, exit->cycles);
	if (exit->registerTop != 0) {
		auto* retained = sljit_emit_cmp(m_compiler, SLJIT_SIG_GREATER_EQUAL | SLJIT_32,
			SLJIT_S5, 0, SLJIT_IMM, exit->registerTop);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_S5, 0, SLJIT_IMM, exit->registerTop);
		sljit_set_label(retained, sljit_emit_label(m_compiler));
	}
	if (exit->exit == NativeBlockExit::Continue) {
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM0(), reinterpret_cast<sljit_sw>(&exit->link.code));
		auto* unlinked = sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, 0);
		auto* shortGrant = sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS | SLJIT_32,
			SLJIT_S4, 0,
			SLJIT_MEM0(), reinterpret_cast<sljit_sw>(&exit->link.cycles));
		sljit_emit_ijump(m_compiler, SLJIT_JUMP, SLJIT_R0, 0);
		auto* done = sljit_emit_label(m_compiler);
		sljit_set_label(unlinked, done);
		sljit_set_label(shortGrant, done);
	}
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, remainingCycles), SLJIT_S4, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, registerTop), SLJIT_S5, 0);
	sljit_emit_return(m_compiler, SLJIT_MOV_P, SLJIT_IMM, reinterpret_cast<sljit_sw>(exit));
}

void* NativeBlockCompiler::finish(size_t& codeBytes, void*& body) {
	if (!m_hasTerminal) {
		flushRegisters();
		emitExit(&m_block->terminal);
	}
	for (const auto& slow : m_slowPaths) {
		auto* label = sljit_emit_label(m_compiler);
		for (size_t i = 0; i < slow.count; ++i) sljit_set_label(slow.jumps[i], label);
		emitRegisterSnapshot(slow.registers);
		emitExit(slow.exit);
	}
	emitReadMappings();
	void* code = sljit_generate_code(m_compiler, 0, nullptr);
	if (!code) throw std::bad_alloc();
	codeBytes = sljit_get_generated_code_size(m_compiler);
	body = reinterpret_cast<void*>(sljit_get_label_addr(m_body));
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
	slow.registers = registerSnapshot();
	loadHeader(base, SLJIT_R0);
	slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R0, 0,
		SLJIT_IMM, valueFromTag(ValueTag::Table) >> 48u);
	loadPayload(base, SLJIT_R0, SLJIT_R1);
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
		loadHeader(instruction.c, SLJIT_R2);
		slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_EQUAL,
			SLJIT_R2, 0, SLJIT_IMM, valueNil() >> 48u);
		loadOperand(instruction.c, SLJIT_FR0);
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_R1), 0, SLJIT_FR0, 0);
	}
	m_slowPaths.push_back(slow);
}

std::array<sljit_jump*, 2> NativeBlockCompiler::falseyJumps(int index) {
	// isTruthy consumes the upper 16-bit Value header, including for
	// representable tagged payloads. Never use floating-point NaN equality.
	loadHeader(index, SLJIT_R0);
	return {
		sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, valueNil() >> 48u),
		sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, valueBool(false) >> 48u),
	};
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
	emitCallSpills(false);
	sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS1(32, F64), SLJIT_IMM, SLJIT_FUNC_ADDR(convert));
	emitCallSpills(true);
}

} // namespace bmsx
