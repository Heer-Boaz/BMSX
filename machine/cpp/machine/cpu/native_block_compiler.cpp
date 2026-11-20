#include "machine/cpu/native_block_compiler.h"

#include <algorithm>
#include <new>
#include "machine/cpu/execution_image.h"
#include "spec/blua32/instruction_format.h"

namespace bmsx {

NativeBlockCompiler::NativeBlockCompiler(ConstValueSpan constants, std::span<const std::unique_ptr<NativeBlock>> blocks,
	const NativeCodeBindings& bindings, std::span<const NativeBlockSource> sources)
	: m_compiler(sljit_create_compiler(nullptr)), m_cache(m_compiler, NativeBlockAbi::words, NativeBlockAbi::tags,
													  NativeBlockAbi::wordRegisters, NativeBlockAbi::floatRegisters),
	  m_constants(constants), m_blocks(blocks), m_bindings(bindings), m_sources(sources), m_entries(blocks.size()) {
	if (!m_compiler)
		throw std::bad_alloc();
	sljit_set_context(m_compiler, 0, NativeBlockAbi::signature, NativeBlockAbi::scratches, NativeBlockAbi::saveds,
		NativeBlockAbi::stackBytes);
	m_branches.reserve(blocks.size() * 2);
	m_external.reserve(blocks.size() * 2);
	size_t exits = 0;
	for (const auto& block : blocks)
		exits += block->sideExits.size();
	m_coldExits.reserve(exits + blocks.size() * 2);
	m_coldBranches.reserve(exits * 2 + blocks.size());
	analyzeEntryLiveness();
}
NativeBlockCompiler::~NativeBlockCompiler() {
	sljit_free_compiler(m_compiler);
}
size_t NativeBlockCompiler::regionEntryIndex(u32 pc) const {
	for (size_t index = 0; index < m_blocks.size(); ++index)
		if (m_blocks[index]->firstPc == pc)
			return index;
	return m_blocks.size();
}
int NativeBlockCompiler::knownTag(int selector) const {
	if (selector < 0)
		return static_cast<int>(m_constants.tag(-selector - 1));
	const auto* binding = m_cache.binding(selector);
	return binding ? static_cast<int>(binding->tag) : -1;
}
NativeRegisterCache::Operand NativeBlockCompiler::readTyped(
	int selector, ValueTag tag, sljit_s32 wordScratch, sljit_s32 floatScratch) {
	if (selector >= 0)
		return m_cache.read(selector, tag);
	const u32 word = m_constants.payload(-selector - 1);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, wordScratch, 0, SLJIT_IMM, word);
	if (tag != ValueTag::Float)
		return {wordScratch, tag, -1};
	sljit_emit_fcopy(m_compiler, SLJIT_COPY32_TO_F32, floatScratch, wordScratch);
	return {floatScratch, tag, -1};
}
void NativeBlockCompiler::emitRawLoad(int selector, sljit_s32 word, sljit_s32 tag) {
	const int kind = knownTag(selector);
	if (kind >= 0) {
		const auto value = readTyped(selector, static_cast<ValueTag>(kind), word, SLJIT_FR0);
		if (value.tag == ValueTag::Float)
			sljit_emit_fcopy(m_compiler, SLJIT_COPY32_FROM_F32, value.reg, word);
		else if (word != value.reg)
			sljit_emit_op1(m_compiler, SLJIT_MOV32, word, 0, value.reg, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, tag, 0, SLJIT_IMM, kind);
	} else {
		sljit_emit_op1(m_compiler, SLJIT_MOV32, word, 0, SLJIT_MEM1(NativeBlockAbi::words), selector * sizeof(u32));
		sljit_emit_op1(m_compiler, SLJIT_MOV_U8, tag, 0, SLJIT_MEM1(NativeBlockAbi::tags), selector);
	}
}
void NativeBlockCompiler::emitRawStore(int guest, sljit_s32 word, sljit_s32 tag) {
	m_cache.discardRange(guest, guest + 1);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(NativeBlockAbi::words), guest * sizeof(u32), word, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_MEM1(NativeBlockAbi::tags), guest, tag, 0);
}
void NativeBlockCompiler::emitConstant(int guest, Value value) {
	const auto target = m_cache.write(guest, valueTag(value));
	if (target.tag == ValueTag::Float) {
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM, valuePayload(value));
		sljit_emit_fcopy(m_compiler, SLJIT_COPY32_TO_F32, target.reg, SLJIT_R0);
	} else
		sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, SLJIT_IMM, valuePayload(value));
}
void NativeBlockCompiler::fault(sljit_jump* jump, NativeBlockExitSite& exit, const State& state, bool charged) {
	deferColdExit(jump, &exit, 0u, state, charged);
}

void NativeBlockCompiler::deferColdExit(sljit_jump* jump, NativeBlockExitSite* site, u32 scalarPc,
	const State& state, bool charged, int scalarCycles, int scalarTop) {
	// Proven operands supply no branch. The remaining guards of each guest
	// site are emitted together; only its publication variants can match.
	if (!jump) return;
	for (size_t i = m_coldExits.size(); i != 0;) {
		const auto& exit = m_coldExits[--i];
		if (exit.site != site || exit.scalarPc != scalarPc) break;
		if (exit.charged == charged && exit.scalarCycles == scalarCycles && exit.scalarTop == scalarTop
			&& m_cache.samePublication(exit.state, state)) {
			m_coldBranches.push_back({jump, i});
			return;
		}
	}
	m_coldBranches.push_back({jump, m_coldExits.size()});
	m_coldExits.push_back({site, scalarPc, scalarCycles, scalarTop, state, charged});
}
void NativeBlockCompiler::emitWordMove(const DecodedInstruction& instruction, NativeBlockExitSite* invalid) {
	const auto mode = static_cast<ValueMoveKind>(instruction.c);
	int tag = knownTag(instruction.b);
	if (mode == ValueMoveKind::Copy) {
		if (tag < 0) {
			emitRawLoad(instruction.b, SLJIT_R0, SLJIT_R1);
			emitRawStore(instruction.a, SLJIT_R0, SLJIT_R1);
			return;
		}
		const auto source = readTyped(instruction.b, static_cast<ValueTag>(tag));
		const auto target = m_cache.write(instruction.a, source.tag);
		if (source.reg != target.reg) {
			if (source.tag == ValueTag::Float)
				sljit_emit_fop1(m_compiler, SLJIT_MOV_F32, target.reg, 0, source.reg, 0);
			else
				sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, source.reg, 0);
		}
		return;
	}
	const ValueTag required = mode == ValueMoveKind::FloatBits ? ValueTag::Float : ValueTag::Integer;
	if (tag >= 0 && tag != static_cast<int>(required)) {
		fault(sljit_emit_jump(m_compiler, SLJIT_JUMP), *invalid, m_cache.state());
		return;
	}
	fault(m_cache.guard(instruction.b, required, SLJIT_R0), *invalid, m_cache.state());
	const auto source = readTyped(instruction.b, required);
	const auto target = m_cache.write(instruction.a, required == ValueTag::Float ? ValueTag::Integer : ValueTag::Float);
	sljit_emit_fcopy(m_compiler, required == ValueTag::Float ? SLJIT_COPY32_FROM_F32 : SLJIT_COPY32_TO_F32,
		required == ValueTag::Float ? source.reg : target.reg, required == ValueTag::Float ? target.reg : source.reg);
}
void NativeBlockCompiler::emit(
	const DecodedInstruction& instruction, NativeBlockExitSite* slow, NativeBlockExitSite* taken) {
	const auto& source = m_sources[m_current].instructions[m_instruction++];
	if (m_terminal)
		return;
	m_cache.beginInstruction();
	// The next access includes an overwrite: retaining that binding avoids
	// publishing its old dirty payload solely to overwrite it immediately.
	for (const auto& binding : m_cache.state())
		if (binding.guest >= 0) {
			int next = std::numeric_limits<int>::max();
			const auto remaining = m_sources[m_current].instructions.subspan(m_instruction);
			for (size_t distance = 0; distance < remaining.size(); ++distance) {
				const auto& item = *remaining[distance].decoded;
				const u8 reads = OPCODE_SCALAR_REGISTER_READS[item.op];
				const auto kind = static_cast<OpCode>(item.op);
				const bool scalar = ((reads & REGISTER_OPERAND_A) && binding.guest == item.a) ||
									((reads & REGISTER_OPERAND_B) && binding.guest == item.b) ||
									((reads & REGISTER_OPERAND_C) && binding.guest == item.c);
				const bool overwrite = OPCODE_WRITES_REGISTER_A[item.op] && binding.guest == item.a;
				const bool range =
					(kind == OpCode::LOADNIL && binding.guest >= item.a && binding.guest < item.a + item.b) ||
					((kind == OpCode::STORE_MEM_WORDS || kind == OpCode::STORE_MEM_WORDS_D) &&
						binding.guest >= item.a && binding.guest < item.a + item.c);
				if (scalar || overwrite || range) {
					next = static_cast<int>(distance);
					break;
				}
			}
			m_cache.nextUse(binding.guest, next);
		}
	const auto op = static_cast<OpCode>(instruction.op);
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	// Admission has succeeded. Count only instruction attempts that actually
	// execute here, not a preparation, cold exit or scalar redispatch.
	sljit_sw counterOffset = -1;
	switch (op) {
	case OpCode::NEWT:
		counterOffset = offsetof(DiagnosticNativeOpcodeCounts, newt);
		break;
	case OpCode::CALL:
		counterOffset = offsetof(DiagnosticNativeOpcodeCounts, call);
		break;
	case OpCode::SETFIELD:
		counterOffset = offsetof(DiagnosticNativeOpcodeCounts, setfield);
		break;
	case OpCode::CONCAT:
		counterOffset = offsetof(DiagnosticNativeOpcodeCounts, concat);
		break;
	case OpCode::CONCATN:
		counterOffset = offsetof(DiagnosticNativeOpcodeCounts, concatn);
		break;
	default:
		break;
	}
	if (counterOffset >= 0) {
		counterOffset += offsetof(NativeBlockRunState, diagnosticOpcodes);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(NativeBlockAbi::state), counterOffset);
		sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 1);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(NativeBlockAbi::state), counterOffset, SLJIT_R0, 0);
	}
#endif
	switch (op) {
	case OpCode::MOV:
		emitWordMove(instruction, slow);
		break;
	case OpCode::LOADNIL:
		emitNilRange(instruction.a, instruction.b);
		break;
	case OpCode::NOT: {
		const int tag = knownTag(instruction.b);
		if (tag >= 0)
			emitConstant(instruction.a, valueBool(tag <= static_cast<int>(ValueTag::False)));
		else {
			sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM1(NativeBlockAbi::tags), instruction.b);
			auto* falsey = sljit_emit_cmp(
				m_compiler, SLJIT_LESS_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, static_cast<u8>(ValueTag::False));
			sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, static_cast<u8>(ValueTag::False));
			auto* done = sljit_emit_jump(m_compiler, SLJIT_JUMP);
			sljit_set_label(falsey, sljit_emit_label(m_compiler));
			sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, static_cast<u8>(ValueTag::True));
			sljit_set_label(done, sljit_emit_label(m_compiler));
			sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM, 0);
			emitRawStore(instruction.a, SLJIT_R0, SLJIT_R1);
		}
		break;
	}
	case OpCode::LOADK:
		emitConstant(instruction.a, m_constants.get(instruction.bx));
		break;
	case OpCode::KNIL:
		emitConstant(instruction.a, valueNil());
		break;
	case OpCode::KFALSE:
		emitConstant(instruction.a, valueBool(false));
		break;
	case OpCode::KTRUE:
		emitConstant(instruction.a, valueBool(true));
		break;
	case OpCode::K0:
	case OpCode::K1:
	case OpCode::KM1:
	case OpCode::KSMI:
		emitConstant(instruction.a, valueInteger(op == OpCode::K0	 ? 0
												 : op == OpCode::K1	 ? 1
												 : op == OpCode::KM1 ? -1
																	 : instruction.sbx));
		break;
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
	case OpCode::BNOT:
	case OpCode::UNM:
		emitNumeric(instruction, *slow, source.pc);
		break;
	case OpCode::LOADKR:
		emitConstantIndex(instruction, *slow);
		break;
	case OpCode::GETUP:
	case OpCode::SETUP:
		emitUpvalue(instruction, slow);
		break;
	case OpCode::MFC0:
	case OpCode::MTC0:
		emitControl(instruction, slow);
		break;
	case OpCode::LEN:
		emitLength(instruction, *slow);
		break;
	case OpCode::LOAD_MEM:
	case OpCode::LOAD_MEM_D:
	case OpCode::STORE_MEM:
	case OpCode::STORE_MEM_D:
	case OpCode::STORE_MEM_WORDS:
	case OpCode::STORE_MEM_WORDS_D:
		emitMemory(instruction, *slow);
		break;
	case OpCode::GETGL:
	case OpCode::SETGL:
	case OpCode::GETSYS:
	case OpCode::SETSYS:
		emitContext(instruction, slow);
		break;
	case OpCode::JMP:
		emitExit(m_blocks[m_current]->terminal);
		break;
	case OpCode::JMPIF:
	case OpCode::JMPIFNOT: {
		emitRawLoad(instruction.a, SLJIT_R0, SLJIT_R1);
		auto* falsey = sljit_emit_cmp(
			m_compiler, SLJIT_LESS_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, static_cast<u8>(ValueTag::False));
		const auto state = m_cache.state();
		emitExit(op == OpCode::JMPIF ? *taken : m_blocks[m_current]->terminal);
		sljit_set_label(falsey, sljit_emit_label(m_compiler));
		m_cache.setState(state);
		emitExit(op == OpCode::JMPIF ? m_blocks[m_current]->terminal : *taken);
		break;
	}
	case OpCode::EQ:
	case OpCode::LT:
	case OpCode::LE:
		emitComparison(instruction, *taken);
		break;
	case OpCode::CALL:
		emitBuiltinCall(instruction);
		break;
	case OpCode::HALT:
	case OpCode::RET:
	case OpCode::NEWT:
	case OpCode::CONCAT:
	case OpCode::CONCATN:
	case OpCode::CLOSURE:
	case OpCode::RFE:
		emitExit(m_blocks[m_current]->terminal);
		break;
	case OpCode::GETT:
	case OpCode::GETI:
	case OpCode::GETFIELD:
	case OpCode::SETT:
	case OpCode::SETI:
	case OpCode::SETFIELD:
	case OpCode::SELF:
		emitTableAccess(instruction, *slow, source.fieldValueTag);
		break;
	case OpCode::VARARG:
		emitVararg(instruction, *slow);
		break;
	default:
		emitScalarBoundary(source.pc, m_prefixCycles, m_prefixTop);
		return;
	}
	m_prefixCycles += instruction.baseCycles + (op == OpCode::LOADNIL ? instruction.b : 0);
	if (op == OpCode::STORE_MEM_WORDS || op == OpCode::STORE_MEM_WORDS_D) m_prefixCycles += instruction.c;
	if (op == OpCode::VARARG) {
		if (instruction.b == 0) m_prefixTop = 0;
		else if (instruction.b > 1) {
			m_prefixCycles += instruction.b - 1;
			m_prefixTop = std::max(m_prefixTop, instruction.a + instruction.b - 1);
		}
	} else if (op == OpCode::LOADNIL) {
		if (instruction.b != 0)
			m_prefixTop = std::max(m_prefixTop, static_cast<int>(instruction.a) + instruction.b);
	} else if (OPCODE_WRITES_REGISTER_A[instruction.op])
		m_prefixTop = std::max(m_prefixTop, static_cast<int>(instruction.a) + 1);
}
void NativeBlockCompiler::endBlock() {
	if (!m_terminal)
		emitExit(m_blocks[m_current]->terminal);
}
void* NativeBlockCompiler::finish(size_t& codeBytes) {
	emitRomReads();
	for (auto& exit : m_coldExits) {
		exit.label = sljit_emit_label(m_compiler);
		m_cache.setState(exit.state);
		if (exit.site) emitLeave(*exit.site, exit.charged);
		else emitScalarBoundary(exit.scalarPc, exit.scalarCycles, exit.scalarTop);
	}
	for (const auto& branch : m_coldBranches)
		sljit_set_label(branch.jump, m_coldExits[branch.target].label);
	for (const auto& branch : m_branches)
		sljit_set_label(branch.jump, m_entries[branch.target].proven);
	void* code = sljit_generate_code(m_compiler, 0, nullptr);
	if (!code)
		throw std::bad_alloc();
	codeBytes = sljit_get_generated_code_size(m_compiler);
	for (size_t index = 0; index < m_blocks.size(); ++index) {
		m_blocks[index]->m_body = m_blocks[index]->m_linkEntry =
			reinterpret_cast<void*>(sljit_get_label_addr(m_entries[index].guarded));
	}
	for (const auto& branch : m_external) {
		branch.link->patchAddress = sljit_get_jump_addr(branch.jump);
		branch.link->coldEntry = sljit_get_label_addr(branch.coldEntry);
		branch.link->executableOffset = sljit_get_executable_offset(m_compiler);
	}
	return code;
}

} // namespace bmsx
