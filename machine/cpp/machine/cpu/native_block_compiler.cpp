#include "machine/cpu/native_block_compiler.h"

#include "common/compiler.h"

#include <algorithm>
#include <new>

#include "machine/cpu/execution_image.h"
#include "spec/blua32/memory_access_kind.h"
#include "spec/blua32/cop0.h"
#include "spec/blua32/numeric.h"
#include "spec/blua32/pow.h"

namespace bmsx {

NativeBlockCompiler::NativeBlockCompiler(const Value* constants, std::span<const std::unique_ptr<NativeBlock>> blocks, const NativeCodeBindings& bindings,
	std::span<const NativeBlockSource> sources)
	: m_compiler(nullptr), m_blocks(blocks), m_sources(sources), m_entryPagePc(blocks.front()->firstPc & ~MAPPED_PAGE_BYTE_MASK),
	  m_entries(blocks.size()),
	  m_constants(constants), m_bindings(bindings) {
	// Region admission supplies unique entries in one decoded page. Keep the
	// same index for liveness successors and emitted internal branches.
	m_entryByWord.fill(static_cast<u16>(blocks.size()));
	for (size_t index = 0; index < blocks.size(); ++index)
		m_entryByWord[(blocks[index]->firstPc - m_entryPagePc) / INSTRUCTION_BYTES] = static_cast<u16>(index);
	size_t slowPaths = std::count_if(blocks.begin(), blocks.end(),
		[](const auto& block) { return block->hasFusedJump; });
	size_t readMappings = 0;
	bool calls = false;
	for (const auto& blockSource : sources) {
		bool controlGuarded = false;
		for (const auto& source : blockSource.instructions) {
			const auto& instruction = *source.decoded;
			const auto op = static_cast<OpCode>(instruction.op);
			const auto slow = nativeBlockSlowExit(instruction.op, instruction.b, controlGuarded);
			controlGuarded |= op == OpCode::MFC0 || op == OpCode::MTC0;
			slowPaths += slow == NativeBlockExit::ReadField || slow == NativeBlockExit::WriteField
				|| slow == NativeBlockExit::ControlFault
				|| slow == NativeBlockExit::ReadIndex || slow == NativeBlockExit::WriteIndex
				|| slow == NativeBlockExit::ReadInteger || slow == NativeBlockExit::WriteInteger || slow == NativeBlockExit::InvalidLength
				|| slow == NativeBlockExit::WriteUpvalue
				|| slow == NativeBlockExit::Vararg || slow == NativeBlockExit::InvalidConstant
				|| slow == NativeBlockExit::WriteMemory || slow == NativeBlockExit::WriteWords
				|| (slow == NativeBlockExit::ReadMemory && instruction.c != static_cast<i16>(MemoryAccessKind::U8));
			readMappings += slow == NativeBlockExit::ReadMemory;
			calls |= op == OpCode::LT || op == OpCode::LE || op == OpCode::MOD || op == OpCode::FLOORDIV || op == OpCode::POW
				|| (slow == NativeBlockExit::WriteWords && (instruction.b >= 0 || instruction.c != 0))
				|| (op == OpCode::MTC0 && instruction.b != COP0_EXEC)
				|| op == OpCode::LEN || op == OpCode::SETT || op == OpCode::SETFIELD || op == OpCode::LOADKR || (op == OpCode::BNOT && instruction.b >= 0)
				|| ((op == OpCode::BAND || op == OpCode::BOR || op == OpCode::BXOR || op == OpCode::SHL || op == OpCode::SHR)
					&& (instruction.b >= 0 || instruction.c >= 0))
				|| ((slow == NativeBlockExit::ReadMemory || slow == NativeBlockExit::WriteMemory)
				&& (instruction.b >= 0 || (slow == NativeBlockExit::WriteMemory
					&& instruction.c != static_cast<i16>(MemoryAccessKind::F32LE)
					&& instruction.c != static_cast<i16>(MemoryAccessKind::F64LE))));
		}
	}
	m_slowPaths.reserve(slowPaths);
	m_readMappings.reserve(readMappings);
	m_internalBranches.reserve(blocks.size() * 2u);
	m_externalBranches.reserve(blocks.size() * 2u);
	m_shortGrants.reserve(blocks.size());
	m_useSavedFloats = calls && SLJIT_NUMBER_OF_SAVED_FLOAT_REGISTERS >= REGISTER_CACHE_CAPACITY;
	m_registerCount = m_useSavedFloats ? REGISTER_CACHE_CAPACITY
		: std::min(REGISTER_CACHE_CAPACITY, SLJIT_NUMBER_OF_FLOAT_REGISTERS - SLJIT_NUMBER_OF_SAVED_FLOAT_REGISTERS - 3);
	planRegisterEntries(sources);
	for (size_t index = 0; index < sources.size(); ++index)
		m_entries[index].inherited = index != 0u && sources[index - 1u].fallthrough;
	m_compiler = sljit_create_compiler(nullptr);
	if (!m_compiler) throw std::bad_alloc();
	// The shared gate owns the actual host prologue and epilogue. Bodies only
	// need its ABI context for calls and their helper spill slots.
	sljit_set_context(m_compiler, 0, NativeBlockAbi::signature,
		NativeBlockAbi::scratches, NativeBlockAbi::saveds, NativeBlockAbi::stackBytes);
}

NativeBlockCompiler::~NativeBlockCompiler() { sljit_free_compiler(m_compiler); }

size_t NativeBlockCompiler::regionEntryIndex(u32 pc) const {
	const u32 offset = pc - m_entryPagePc;
	// External and misaligned targets retain their ordinary dispatch/fetch path;
	// low page bits alone are not an instruction identity.
	return offset < MAPPED_PAGE_BYTE_SIZE && (offset & (INSTRUCTION_BYTES - 1u)) == 0u
		? m_entryByWord[offset / INSTRUCTION_BYTES] : m_blocks.size();
}

void NativeBlockCompiler::beginBlock(size_t index, bool inheritRegisters) {
	m_block = m_blocks[index].get();
	m_remainingInstructions = m_sources[index].instructions;
	m_hasTerminal = m_controlPrivilegeGuarded = false;
	auto& entry = m_entries[index];
	entry.inherited = inheritRegisters;
	if (!inheritRegisters) {
		m_registers = entry.registers;
		m_registerClock = m_registerCount;
		entry.guarded = sljit_emit_label(m_compiler);
		m_shortGrants.push_back(sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32,
			SLJIT_S4, 0, SLJIT_IMM, 0));
	}
	// Every body has an external entry which reloads arbitrary current Values.
	// Even helper fallthrough inherits only placement, never predecessor facts.
	for (auto& cached : m_registers) cached.value = {};
	entry.registers = m_registers;
	entry.body = sljit_emit_label(m_compiler);
}

void NativeBlockCompiler::endBlock(bool fallthrough) {
	if (!m_hasTerminal) emitExit(&m_block->terminal, fallthrough);
}

void NativeBlockCompiler::emit(const DecodedInstruction& instruction, NativeBlockExitSite* slowExit, NativeBlockExitSite* takenExit) {
	m_remainingInstructions = m_remainingInstructions.subspan(1);
	const auto op = static_cast<OpCode>(instruction.op);
	switch (op) {
		case OpCode::MFC0:
		case OpCode::MTC0:
			emitControl(instruction, slowExit);
			return;
		case OpCode::LOADNIL:
		case OpCode::LOADKR:
		case OpCode::GETGL:
		case OpCode::SETGL:
		case OpCode::GETSYS:
		case OpCode::SETSYS:
		case OpCode::GETUP:
		case OpCode::SETUP:
		case OpCode::VARARG:
			emitContext(instruction, slowExit);
			return;
		case OpCode::MOV: {
			const auto fact = operandFact(instruction.b);
			writeRegister(instruction.a, readOperand(instruction.b, SLJIT_FR0), fact);
			return;
		}
		case OpCode::LOADK:
			sljit_emit_fop1(m_compiler, SLJIT_MOV_F64,
				destinationRegister(instruction.a, {RegisterValueKind::Constant, m_constants[instruction.bx]}), 0,
				SLJIT_MEM1(SLJIT_S1), static_cast<sljit_sw>(instruction.bx) * sizeof(Value));
			return;
		case OpCode::KNIL:
		case OpCode::KFALSE:
		case OpCode::KTRUE:
		case OpCode::K0:
		case OpCode::K1:
		case OpCode::KM1:
		case OpCode::KSMI: {
			const Value value = op == OpCode::KNIL ? valueNil() : op == OpCode::KFALSE ? valueBool(false)
				: op == OpCode::KTRUE ? valueBool(true) : valueNumber(op == OpCode::K0 ? 0.0
					: op == OpCode::K1 ? 1.0 : op == OpCode::KM1 ? -1.0 : instruction.sbx);
			sljit_emit_fset64(m_compiler, destinationRegister(instruction.a, {RegisterValueKind::Constant, value}), asNumber(value));
			return;
		}
		case OpCode::ADD:
		case OpCode::SUB:
		case OpCode::MUL:
		case OpCode::DIV: {
			const auto [left, right] = readOperands(instruction.b, instruction.c);
			const auto target = destinationRegister(instruction.a);
			const sljit_s32 operation = op == OpCode::ADD ? SLJIT_ADD_F64
				: op == OpCode::SUB ? SLJIT_SUB_F64
				: op == OpCode::MUL ? SLJIT_MUL_F64 : SLJIT_DIV_F64;
			sljit_emit_fop2(m_compiler, operation, target, 0, left, 0, right, 0);
			canonicalizeNumber(target);
			return;
		}
		case OpCode::MOD:
		case OpCode::FLOORDIV:
		case OpCode::POW: {
			loadOperand(instruction.c, SLJIT_FR1);
			loadOperand(instruction.b, SLJIT_FR0);
			const auto function = op == OpCode::MOD ? luaModulo : op == OpCode::FLOORDIV ? luaFloorDivide : luaPow;
			emitCallSpills(false);
			sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS2(F64, F64, F64), SLJIT_IMM, SLJIT_FUNC_ADDR(function));
			emitCallSpills(true);
			canonicalizeNumber();
			break;
		}
		case OpCode::UNM: {
			const auto source = readOperand(instruction.b, SLJIT_FR0);
			const auto target = destinationRegister(instruction.a);
			sljit_emit_fop1(m_compiler, SLJIT_NEG_F64, target, 0, source, 0);
			canonicalizeNumber(target);
			return;
		}
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
			writeRegister(instruction.a, SLJIT_FR0, {RegisterValueKind::SignedWordNumber, 0});
			return;
		}
		case OpCode::BNOT:
			convertWord(instruction.b);
			sljit_emit_op2(m_compiler, SLJIT_XOR32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, -1);
			sljit_emit_fop1(m_compiler, SLJIT_CONV_F64_FROM_S32, SLJIT_FR0, 0, SLJIT_R0, 0);
			writeRegister(instruction.a, SLJIT_FR0, {RegisterValueKind::SignedWordNumber, 0});
			return;
		case OpCode::GETFIELD:
		case OpCode::SETFIELD:
		case OpCode::SELF:
		case OpCode::GETT:
		case OpCode::SETT:
		case OpCode::GETI:
		case OpCode::SETI:
			emitTableAccess(instruction, slowExit);
			return;
		case OpCode::LEN:
			emitLength(instruction, slowExit);
			return;
		case OpCode::STORE_MEM_WORDS:
		case OpCode::STORE_MEM_WORDS_D:
			emitWordStores(instruction, slowExit);
			return;
		case OpCode::LOAD_MEM:
		case OpCode::LOAD_MEM_D:
		case OpCode::STORE_MEM:
		case OpCode::STORE_MEM_D:
			emitMemory(instruction, slowExit);
			if (slowExit->exit == NativeBlockExit::ReadMemory) {
				const auto kind = static_cast<MemoryAccessKind>(instruction.c);
				writeRegister(instruction.a, SLJIT_FR0, {kind == MemoryAccessKind::U8 || kind == MemoryAccessKind::U16LE
					? RegisterValueKind::SignedWordNumber : RegisterValueKind::Unknown, 0});
			}
			return;
		case OpCode::JMP:
		case OpCode::HALT:
		case OpCode::CALL:
		case OpCode::RET:
		case OpCode::NEWT:
		case OpCode::CONCAT:
		case OpCode::CONCATN:
		case OpCode::CLOSURE:
		case OpCode::RFE:
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
			BMSX_UNREACHABLE();
	}
	writeRegister(instruction.a);
}

void NativeBlockCompiler::emitExit(NativeBlockExitSite* exit, bool fallthrough) {
	if (fallthrough) {
		emitSegmentCharge(*exit);
		return;
	}
	auto registers = registerSnapshot();
	if (exit->exit == NativeBlockExit::Continue) {
		const size_t index = regionEntryIndex(exit->nextPc);
		if (index != m_blocks.size()) {
			// Ordinary target maps are already planned. Only a forward helper
			// continuation must await its predecessor's actual allocation.
			const auto& target = m_entries[index];
			const bool deferred = target.inherited && !target.body;
			if (!deferred) emitRegisterTransfer(m_registers, target.registers, *exit);
			emitSegmentCharge(*exit);
			sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(exit));
			m_internalBranches.push_back({sljit_emit_jump(m_compiler, SLJIT_JUMP), index, exit, m_registers, deferred});
			return;
		}
		// Independently compiled regions have independent register maps. Publish
		// only dirty values, then patch this edge to the target's entry guard.
		// Warm links bypass the cold state-map materializer and dispatcher.
		emitRegisterSnapshot(registers);
		emitSegmentCharge(*exit);
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(exit));
		auto* jump = sljit_emit_jump(m_compiler, SLJIT_JUMP | SLJIT_REWRITABLE_JUMP);
		sljit_set_target(jump, reinterpret_cast<sljit_uw>(nativeBlockGate().leaveSegment));
		m_externalBranches.push_back({jump, &exit->link});
		return;
	}
	emitSharedExit(*exit, registers);
}

void NativeBlockCompiler::setExitRegisterMap(NativeBlockExitSite& exit, const RegisterSnapshot& registers) {
	for (int slot = 0; slot < REGISTER_CACHE_CAPACITY; ++slot)
		exit.registerOffsets[slot] = registers[slot] < 0 ? -1 : registers[slot] * static_cast<int>(sizeof(Value));
}

void NativeBlockCompiler::emitSharedExit(NativeBlockExitSite& exit, const RegisterSnapshot& registers) {
	setExitRegisterMap(exit, registers);
	// The stable gate owns cold materialization and charging.
	// A semantic helper may retire this descriptor and its code after that.
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(&exit));
	sljit_emit_ijump(m_compiler, SLJIT_JUMP, SLJIT_IMM,
		reinterpret_cast<sljit_sw>(nativeBlockGate().finishSegment[m_useSavedFloats]));
}

void NativeBlockCompiler::emitSegmentCharge(const NativeBlockExitSite& exit) {
	sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_S4, 0, SLJIT_S4, 0, SLJIT_IMM, exit.cycles);
	if (exit.registerTop != 0) {
		auto* retained = sljit_emit_cmp(m_compiler, SLJIT_SIG_GREATER_EQUAL | SLJIT_32,
			SLJIT_S5, 0, SLJIT_IMM, exit.registerTop);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_S5, 0, SLJIT_IMM, exit.registerTop);
		sljit_set_label(retained, sljit_emit_label(m_compiler));
	}
}

void* NativeBlockCompiler::finish(size_t& codeBytes) {
	for (size_t index = 0; index < m_entries.size(); ++index) {
		auto& entry = m_entries[index];
		entry.linked = sljit_emit_label(m_compiler);
		sljit_set_target(sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32,
			SLJIT_S4, 0, SLJIT_IMM, 0), reinterpret_cast<sljit_uw>(nativeBlockGate().leaveSegment));
		entry.external = sljit_emit_label(m_compiler);
		for (int slot = 0; slot < m_registerCount; ++slot) {
			if (entry.registers[slot].guest >= 0) sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, cachedFloatRegister(slot), 0,
				SLJIT_MEM1(SLJIT_S0), entry.registers[slot].guest * sizeof(Value));
		}
		sljit_set_label(sljit_emit_jump(m_compiler, SLJIT_JUMP), entry.body);
		if (entry.inherited) {
			entry.guarded = sljit_emit_label(m_compiler);
			m_shortGrants.push_back(sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32,
				SLJIT_S4, 0, SLJIT_IMM, 0));
			sljit_set_label(sljit_emit_jump(m_compiler, SLJIT_JUMP), entry.body);
		}
	}
	emitInternalBranches();
	auto* shortGrant = sljit_emit_label(m_compiler);
	for (auto* jump : m_shortGrants) sljit_set_label(jump, shortGrant);
	sljit_emit_ijump(m_compiler, SLJIT_JUMP, SLJIT_IMM,
		reinterpret_cast<sljit_sw>(nativeBlockGate().publishSegment[m_useSavedFloats]));
	for (const auto& slow : m_slowPaths) {
		auto* label = sljit_emit_label(m_compiler);
		for (size_t i = 0; i < slow.count; ++i) sljit_set_label(slow.jumps[i], label);
		emitSharedExit(*slow.exit, slow.registers);
	}
	emitReadMappings();
	void* code = sljit_generate_code(m_compiler, 0, nullptr);
	if (!code) throw std::bad_alloc();
	codeBytes = sljit_get_generated_code_size(m_compiler);
	for (size_t index = 0; index < m_blocks.size(); ++index) {
		m_blocks[index]->m_body = reinterpret_cast<void*>(sljit_get_label_addr(m_entries[index].external));
		m_blocks[index]->m_linkEntry = reinterpret_cast<void*>(sljit_get_label_addr(m_entries[index].linked));
	}
	const auto executableOffset = sljit_get_executable_offset(m_compiler);
	for (const auto& branch : m_externalBranches) {
		branch.link->patchAddress = sljit_get_jump_addr(branch.jump);
		branch.link->executableOffset = executableOffset;
	}
	return code;
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

void NativeBlockCompiler::canonicalizeNumber(sljit_s32 target) {
	// Arithmetic returns the canonical numeric NaN, never a tagged payload.
	auto* ordered = sljit_emit_fcmp(m_compiler, SLJIT_ORDERED,
		target, 0, target, 0);
	sljit_emit_fset64(m_compiler, target, asNumber(VALUE_QNAN_MASK));
	sljit_set_label(ordered, sljit_emit_label(m_compiler));
}

void NativeBlockCompiler::convertWord(int selector) {
	const auto fact = operandFact(selector);
	if (fact.kind == RegisterValueKind::Constant) {
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM,
			static_cast<sljit_s32>(toU32(fact.constant)));
		return;
	}
	if (fact.kind == RegisterValueKind::SignedWordNumber) {
		sljit_emit_fop1(m_compiler, SLJIT_CONV_S32_FROM_F64, SLJIT_R0, 0, readOperand(selector, SLJIT_FR0), 0);
		return;
	}
	loadOperand(selector, SLJIT_FR0);
	const auto convert = static_cast<uint32_t (*)(double)>(&toU32);
	emitCallSpills(false);
	sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS1(32, F64), SLJIT_IMM, SLJIT_FUNC_ADDR(convert));
	emitCallSpills(true);
}

} // namespace bmsx
