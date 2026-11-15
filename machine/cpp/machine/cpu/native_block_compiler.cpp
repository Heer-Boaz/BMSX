#include "machine/cpu/native_block_compiler.h"

#include "common/compiler.h"

#include <algorithm>
#include <new>

#include "machine/cpu/execution_image.h"
#include "machine/cpu/call_state.h"
#include "spec/blua32/memory_access_kind.h"
#include "spec/blua32/cop0.h"
#include "spec/blua32/numeric.h"
#include "spec/blua32/pow.h"

namespace bmsx {

namespace {
const NativeBlockExitSite scalarBoundary = [] {
	NativeBlockExitSite exit;
	exit.exit = NativeBlockExit::ScalarBoundary;
	return exit;
}();
}


NativeBlockCompiler::NativeBlockCompiler(const Value* constants, std::span<const std::unique_ptr<NativeBlock>> blocks, const NativeCodeBindings& bindings,
	std::span<const NativeBlockSource> sources, NativeLoweringStats* lowering)
	: m_lowering(lowering), m_compiler(nullptr), m_blocks(blocks), m_sources(sources), m_entryPagePc(blocks.front()->firstPc & ~MAPPED_PAGE_BYTE_MASK),
	  m_entries(blocks.size()),
	  m_constants(constants), m_bindings(bindings) {
	// Region admission supplies unique entries in one decoded page. Keep the
	// same index for liveness successors and emitted internal branches.
	m_entryByWord.fill(static_cast<u16>(blocks.size()));
	for (size_t index = 0; index < blocks.size(); ++index)
		m_entryByWord[(blocks[index]->firstPc - m_entryPagePc) / INSTRUCTION_BYTES] = static_cast<u16>(index);
	for (size_t index = 0; index < sources.size(); ++index)
		m_entries[index].inherited = index != 0u && sources[index - 1u].fallthrough;
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
			if (op == OpCode::CALL && bindings.cpu && instruction.b >= 1 && instruction.b <= 3
				&& static_cast<u32>(instruction.c) <= 2u) {
				const auto target = regionEntryIndex(source.pc + static_cast<u32>(instruction.width) * INSTRUCTION_BYTES);
				if (target != blocks.size() && !m_entries[target].inherited) {
					calls = true;
					slowPaths += 2;
				}
			}
			calls |= op == OpCode::LT || op == OpCode::LE || op == OpCode::MOD || op == OpCode::FLOORDIV || op == OpCode::POW
				|| (slow == NativeBlockExit::WriteWords && (instruction.b >= 0 || instruction.c != 0))
				|| (op == OpCode::MTC0 && instruction.b != COP0_EXEC)
				|| op == OpCode::LEN || op == OpCode::SETT || op == OpCode::SETFIELD
				|| op == OpCode::GETT || op == OpCode::GETFIELD || op == OpCode::SELF
				|| op == OpCode::LOADKR || (op == OpCode::BNOT && instruction.b >= 0)
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
	m_loweringPhase = NativeLoweringPhase::Body;
	m_currentEntry = index;
	m_block = m_blocks[index].get();
	m_remainingInstructions = m_sources[index].instructions;
	m_hasTerminal = m_controlPrivilegeGuarded = false;
	auto& entry = m_entries[index];
	entry.inherited = inheritRegisters;
	if (!inheritRegisters) entry.tableParents.fill(-1);
	for (int slot = 0; slot < m_registerCount; ++slot) {
		auto& value = entry.registers[slot].value;
		if (!inheritRegisters || value.kind != RegisterValueKind::Table) value = {};
		else value.entrySource = entry.registers[slot].guest;
	}
	resetRegisterState(entry.registers);
	if (!inheritRegisters) {
		entry.guarded = sljit_emit_label(m_compiler);
		m_shortGrants.push_back(sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32,
			SLJIT_S4, 0, SLJIT_IMM, 0));
	}
	emitAdmission(index, true);
	entry.body = sljit_emit_label(m_compiler);
}

void NativeBlockCompiler::emitEntryTableFacts(size_t index, bool materialize) {
	for (int slot = 0; slot < m_registerCount; ++slot) {
		const auto& cached = m_entries[index].registers[slot];
		if (!m_entries[index].tableGuards[slot]) continue;
		loadHeader(cached.guest, SLJIT_R1);
		auto* failed = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R1, 0,
			SLJIT_IMM, valueFromTag(ValueTag::Table) >> 48u);
		m_admissionFallbacks.push_back({failed, index, materialize ? registerSnapshot() : RegisterSnapshot{}, materialize});
	}
}

void NativeBlockCompiler::endBlock(bool fallthrough) {
	if (!m_hasTerminal) emitExit(&m_block->terminal, fallthrough);
}

void NativeBlockCompiler::emitAdmission(size_t index, bool materialize) {
	const auto instructions = m_sources[index].instructions;
	if (instructions.size() <= 1) return;
	const int prefixCycles = m_blocks[index]->admissionCycles;
	int openCopies = 0;
	for (size_t offset = 0; offset + 1 < instructions.size(); ++offset) {
		const auto& instruction = *instructions[offset].decoded;
		if (instruction.op == static_cast<u8>(OpCode::VARARG) && instruction.b == 0) ++openCopies;
	}
	sljit_jump* shortGrant;
	if (openCopies != 0) {
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, frame));
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, varargCount));
		if (openCopies != 1) sljit_emit_op2(m_compiler, SLJIT_MUL32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, openCopies);
		if (prefixCycles != 0) sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, prefixCycles);
		shortGrant = sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32, SLJIT_S4, 0, SLJIT_R1, 0);
	} else {
		shortGrant = sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32, SLJIT_S4, 0, SLJIT_IMM, prefixCycles);
	}
	m_admissionFallbacks.push_back({shortGrant, index, materialize ? registerSnapshot() : RegisterSnapshot{}, materialize});
}

void NativeBlockCompiler::emit(const DecodedInstruction& instruction, NativeBlockExitSite* slowExit, NativeBlockExitSite* takenExit) {
	m_remainingInstructions = m_remainingInstructions.subspan(1);
	const auto op = static_cast<OpCode>(instruction.op);
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	// This code lies after entry admission, on the actual instruction path.
	// Inline table stores and warm CALL gates need no C++ semantic exit.
	sljit_sw counterOffset;
	switch (op) {
		case OpCode::NEWT: counterOffset = offsetof(DiagnosticNativeOpcodeCounts, newt); break;
		case OpCode::CALL: counterOffset = offsetof(DiagnosticNativeOpcodeCounts, call); break;
		case OpCode::SETFIELD: counterOffset = offsetof(DiagnosticNativeOpcodeCounts, setfield); break;
		case OpCode::CONCAT: counterOffset = offsetof(DiagnosticNativeOpcodeCounts, concat); break;
		case OpCode::CONCATN: counterOffset = offsetof(DiagnosticNativeOpcodeCounts, concatn); break;
		default: counterOffset = -1; break;
	}
	if (counterOffset >= 0) {
		counterOffset += offsetof(NativeBlockRunState, diagnosticOpcodes);
		sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_S3), counterOffset);
		sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 1);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S3), counterOffset, SLJIT_R0, 0);
	}
#endif
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
		case OpCode::MOV:
			copyRegister(instruction.a, instruction.b);
			return;
		case OpCode::LOADK:
			bindConstant(instruction.a, m_constants[instruction.bx]);
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
			bindConstant(instruction.a, value);
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
		case OpCode::CALL:
			emitBuiltinCall(instruction);
			return;
		case OpCode::JMP:
		case OpCode::HALT:
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
		const size_t target = m_currentEntry + 1u;
		m_loweringPhase = NativeLoweringPhase::Edge;
		emitRegisterTransfer(m_entries[target].registers, *exit, target);
		m_loweringPhase = NativeLoweringPhase::Body;
		emitSegmentCharge(*exit);
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(exit));
		m_shortGrants.push_back(sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32,
			SLJIT_S4, 0, SLJIT_IMM, 0));
		return;
	}

	if (exit->exit == NativeBlockExit::Continue) {
		const size_t index = regionEntryIndex(exit->nextPc);
		if (index != m_blocks.size()) {
			m_loweringPhase = NativeLoweringPhase::Edge;
			emitRegisterTransfer(m_entries[index].registers, *exit, index);
			m_loweringPhase = NativeLoweringPhase::Body;
			emitSegmentCharge(*exit);
			sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(exit));
			m_internalBranches.push_back({sljit_emit_jump(m_compiler, SLJIT_JUMP), index});
			return;
		}
		const auto registers = registerSnapshot();
		// Independently compiled regions have independent register maps. Publish
		// only dirty values, then patch this edge to the target's entry guard.
		// Warm links bypass the cold state-map materializer and dispatcher.
		m_loweringPhase = NativeLoweringPhase::Edge;
		emitRegisterSnapshot(registers);
		m_loweringPhase = NativeLoweringPhase::Body;
		emitSegmentCharge(*exit);
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(exit));
		auto* jump = sljit_emit_jump(m_compiler, SLJIT_JUMP | SLJIT_REWRITABLE_JUMP);
		sljit_set_target(jump, reinterpret_cast<sljit_uw>(nativeBlockGate().leaveSegment));
		m_externalBranches.push_back({jump, &exit->link});
		return;
	}
	emitSharedExit(*exit, registerSnapshot());
}

void NativeBlockCompiler::setExitRegisterMap(NativeBlockExitSite& exit, const RegisterSnapshot& registers) {
	for (int slot = 0; slot < REGISTER_CACHE_CAPACITY; ++slot)
		exit.registerOffsets[slot] = registers.primary[slot] < 0 ? -1 : registers.primary[slot] * static_cast<int>(sizeof(Value));
}

void NativeBlockCompiler::emitSharedExit(NativeBlockExitSite& exit, const RegisterSnapshot& registers) {
	emitSnapshotExtras(registers, NativeLoweringPhase::Frontier);
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
	m_loweringPhase = NativeLoweringPhase::Entry;
	for (size_t index = 0; index < m_entries.size(); ++index) {
		auto& entry = m_entries[index];
		entry.linked = sljit_emit_label(m_compiler);
		sljit_set_target(sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32,
			SLJIT_S4, 0, SLJIT_IMM, 0), reinterpret_cast<sljit_uw>(nativeBlockGate().leaveSegment));
		entry.external = sljit_emit_label(m_compiler);
		emitAdmission(index, false);
		for (int slot = 0; slot < m_registerCount; ++slot) {
			if (entry.registers[slot].guest >= 0) {
				if (m_lowering) ++m_lowering->phases[static_cast<size_t>(m_loweringPhase)].registerValueLoads;
				sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, cachedFloatRegister(slot), 0,
					SLJIT_MEM1(SLJIT_S0), entry.registers[slot].guest * sizeof(Value));
			}
		}
		resetRegisterState(entry.registers);
		emitEntryTableFacts(index, false);
		sljit_set_label(sljit_emit_jump(m_compiler, SLJIT_JUMP), entry.body);
		if (entry.inherited) {
			entry.guarded = sljit_emit_label(m_compiler);
			m_shortGrants.push_back(sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32,
				SLJIT_S4, 0, SLJIT_IMM, 0));
			resetRegisterState(entry.registers);
			emitAdmission(index, true);
			emitEntryTableFacts(index, true);
			sljit_set_label(sljit_emit_jump(m_compiler, SLJIT_JUMP), entry.body);
		}
	}
	emitInternalBranches();
	m_loweringPhase = NativeLoweringPhase::Frontier;
	auto* shortGrant = sljit_emit_label(m_compiler);
	for (auto* jump : m_shortGrants) sljit_set_label(jump, shortGrant);
	sljit_emit_ijump(m_compiler, SLJIT_JUMP, SLJIT_IMM,
		reinterpret_cast<sljit_sw>(nativeBlockGate().publishSegment[m_useSavedFloats]));
	for (const auto& fallback : m_admissionFallbacks) {
		sljit_set_label(fallback.jump, sljit_emit_label(m_compiler));
		if (fallback.materialize) emitRegisterSnapshot(fallback.registers);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, scalarPc), SLJIT_IMM, m_blocks[fallback.index]->firstPc);
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(&scalarBoundary));
		sljit_emit_ijump(m_compiler, SLJIT_JUMP, SLJIT_IMM, reinterpret_cast<sljit_sw>(nativeBlockGate().leaveSegment));
	}
	for (const auto& slow : m_slowPaths) {
		auto* label = sljit_emit_label(m_compiler);
		for (size_t i = 0; i < slow.count; ++i) sljit_set_label(slow.jumps[i], label);
		if (slow.exit->exit == NativeBlockExit::ReadMemory || slow.exit->exit == NativeBlockExit::WriteMemory
			|| slow.exit->exit == NativeBlockExit::WriteWords)
			sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, memoryAddress), SLJIT_R0, 0);
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
