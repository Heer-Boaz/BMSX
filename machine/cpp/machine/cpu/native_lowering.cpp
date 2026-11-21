#include "machine/cpu/native_lowering.h"

#include <algorithm>
#include <new>
#include "machine/cpu/execution_image.h"
#include "spec/blua32/instruction_format.h"

namespace bmsx {

NativeLowering::NativeLowering(ConstValueSpan constants, std::span<const std::unique_ptr<NativeBlock>> blocks,
	const NativeCodeBindings& bindings, std::span<const NativeIrBlock> ir, NativeRegisterUses& uses)
	: m_compiler(sljit_create_compiler(nullptr)), m_cache(m_compiler, NativeBlockAbi::words, NativeBlockAbi::tags,
													  NativeBlockAbi::wordRegisters, NativeBlockAbi::floatRegisters),
	  m_constants(constants), m_blocks(blocks), m_bindings(bindings), m_ir(ir), m_uses(uses), m_entries(blocks.size()) {
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
}
NativeLowering::~NativeLowering() {
	sljit_free_compiler(m_compiler);
}
NativeRegisterCache::Operand NativeLowering::readTyped(
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
void NativeLowering::emitPayload(int selector, sljit_s32 word) {
	if (selector >= 0)
		m_cache.emitWord(selector, word);
	else
		sljit_emit_op1(m_compiler, SLJIT_MOV32, word, 0, SLJIT_IMM, m_constants.payload(-selector - 1));
}

void NativeLowering::emitTag(int selector, sljit_s32 tag) {
	if (selector >= 0)
		m_cache.emitTag(selector, tag);
	else
		sljit_emit_op1(m_compiler, SLJIT_MOV32, tag, 0, SLJIT_IMM, static_cast<u8>(m_constants.tag(-selector - 1)));
}

void NativeLowering::emitRawLoad(int selector, sljit_s32 word, sljit_s32 tag) {
	emitPayload(selector, word);
	emitTag(selector, tag);
}

void NativeLowering::emitRawStore(int guest, sljit_s32 word, sljit_s32 tag) {
	m_cache.discardRange(guest, guest + 1);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(NativeBlockAbi::words), guest * sizeof(u32), word, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_MEM1(NativeBlockAbi::tags), guest, tag, 0);
}
void NativeLowering::emitConstant(int guest, Value value) {
	const auto target = m_cache.write(guest, valueTag(value));
	if (target.tag == ValueTag::Float) {
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM, valuePayload(value));
		sljit_emit_fcopy(m_compiler, SLJIT_COPY32_TO_F32, target.reg, SLJIT_R0);
	} else
		sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, SLJIT_IMM, valuePayload(value));
}
void NativeLowering::fault(sljit_jump* jump, NativeBlockExitSite& site, const State& state, Charge charge) {
	deferColdExit(jump, SemanticExit{&site, charge}, state);
}

void NativeLowering::deferColdExit(sljit_jump* jump, ExitTarget target, const State& state) {
	// Several guards of one guest operation can publish the same state.
	if (!jump) return;
	for (size_t i = m_coldExits.size(); i != 0;) {
		const auto& exit = m_coldExits[--i];
		if (exit.target != target) break;
		if (m_cache.samePublication(exit.state, state)) {
			m_coldBranches.push_back({jump, i});
			return;
		}
	}
	m_coldBranches.push_back({jump, m_coldExits.size()});
	m_coldExits.push_back({target, state});
}
void NativeLowering::lowerOperation(const NativeMove& instruction, const NativeInstruction& row) {
	auto* invalid = row.slow;
	const auto mode = instruction.conversion;
	if (mode == ValueMoveKind::Copy) {
		if (!instruction.copyTag) {
			emitRawLoad(instruction.source, SLJIT_R0, SLJIT_R1);
			emitRawStore(instruction.result, SLJIT_R0, SLJIT_R1);
			return;
		}
		const auto source = readTyped(instruction.source, *instruction.copyTag);
		const auto target = m_cache.write(instruction.result, source.tag);
		if (source.reg != target.reg) {
			if (source.tag == ValueTag::Float)
				sljit_emit_fop1(m_compiler, SLJIT_MOV_F32, target.reg, 0, source.reg, 0);
			else
				sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, source.reg, 0);
		}
		return;
	}
	const ValueTag required = mode == ValueMoveKind::FloatBits ? ValueTag::Float : ValueTag::Integer;
	if (instruction.conversionCheck == NativeTagCheck::Rejected) {
		emitLeave(*invalid, Charge::Pending);
		return;
	}
	if (instruction.conversionCheck == NativeTagCheck::Dynamic)
		fault(m_cache.guard(instruction.source, required, SLJIT_R0), *invalid, m_cache.state());
	const auto source = readTyped(instruction.source, required);
	const auto target = m_cache.write(instruction.result, required == ValueTag::Float ? ValueTag::Integer : ValueTag::Float);
	sljit_emit_fcopy(m_compiler, required == ValueTag::Float ? SLJIT_COPY32_FROM_F32 : SLJIT_COPY32_TO_F32,
		required == ValueTag::Float ? source.reg : target.reg, required == ValueTag::Float ? target.reg : source.reg);
}
void NativeLowering::lowerOperation(const NativeNot& instruction, const NativeInstruction&) {
	if (instruction.sourceTruthy)
		emitConstant(instruction.result, valueBool(!*instruction.sourceTruthy));
	else {
		emitTag(instruction.source, SLJIT_R1);
		auto* falsey = sljit_emit_cmp(
			m_compiler, SLJIT_LESS_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, static_cast<u8>(ValueTag::False));
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, static_cast<u8>(ValueTag::False));
		auto* done = sljit_emit_jump(m_compiler, SLJIT_JUMP);
		sljit_set_label(falsey, sljit_emit_label(m_compiler));
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, static_cast<u8>(ValueTag::True));
		sljit_set_label(done, sljit_emit_label(m_compiler));
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM, 0);
		emitRawStore(instruction.result, SLJIT_R0, SLJIT_R1);
	}
}

void NativeLowering::lowerOperation(const NativeReplay&, const NativeInstruction& row) {
	deferColdExit(sljit_emit_jump(m_compiler, SLJIT_JUMP), row.before, m_cache.state());
	m_terminal = true;
}

void NativeLowering::lowerOperation(const NativeJump&, const NativeInstruction&) {
	emitExit(m_blocks[m_current]->terminal, m_ir[m_current].successors[0]);
}

void NativeLowering::lowerOperation(const NativeLiteral& literal, const NativeInstruction&) {
	emitConstant(literal.result, literal.value);
}

void NativeLowering::lowerOperation(const NativeTruthBranch& branch, const NativeInstruction&) {
	const auto& block = m_ir[m_current];
	auto& terminal = m_blocks[m_current]->terminal;
	if (branch.sourceTruthy) {
		const bool taken = *branch.sourceTruthy == branch.takeOnTruthy;
		emitExit(taken ? *block.taken : terminal, block.successors[taken]);
		return;
	}
	emitTag(branch.condition, SLJIT_R1);
	auto* falsey = sljit_emit_cmp(m_compiler, SLJIT_LESS_EQUAL | SLJIT_32, SLJIT_R1, 0,
		SLJIT_IMM, static_cast<u8>(ValueTag::False));
	const auto state = m_cache.state();
	emitExit(branch.takeOnTruthy ? *block.taken : terminal, block.successors[branch.takeOnTruthy]);
	sljit_set_label(falsey, sljit_emit_label(m_compiler));
	m_cache.setState(state);
	emitExit(branch.takeOnTruthy ? terminal : *block.taken, block.successors[!branch.takeOnTruthy]);
}

void NativeLowering::lower(const NativeInstruction& source) {
	++m_instruction;
	if (m_terminal)
		return;
	m_cache.beginInstruction();
	for (const auto& binding : m_cache.state())
		if (binding.guest >= 0)
			m_cache.nextUse(binding.guest, m_uses.nextUse(m_instruction, binding.guest));

#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	// The translator selects the events; here only emit the actual counter.
	constexpr std::array<sljit_sw, 6> counters{
		-1, offsetof(DiagnosticNativeOpcodeCounts, newt), offsetof(DiagnosticNativeOpcodeCounts, call),
		offsetof(DiagnosticNativeOpcodeCounts, setfield), offsetof(DiagnosticNativeOpcodeCounts, concat),
		offsetof(DiagnosticNativeOpcodeCounts, concatn),
	};
	sljit_sw offset = counters[static_cast<size_t>(source.attempt)];
	if (offset >= 0) {
		offset += offsetof(NativeBlockRunState, diagnosticOpcodes);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(NativeBlockAbi::state), offset);
		sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 1);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(NativeBlockAbi::state), offset, SLJIT_R0, 0);
	}
#endif
	std::visit([&](const auto& op) { lowerOperation(op, source); }, source.operation);
}

void NativeLowering::endBlock() {
	if (!m_terminal)
		emitExit(m_blocks[m_current]->terminal, m_ir[m_current].successors[0]);
}
void* NativeLowering::finish(size_t& codeBytes, std::vector<NativeBlockExitSite>& replaySites) {
	emitRomReads();
	replaySites.reserve(std::count_if(m_coldExits.begin(), m_coldExits.end(), [](const ColdExit& exit) {
		return std::holds_alternative<NativeResumePoint>(exit.target);
	}));
	for (auto& exit : m_coldExits) {
		exit.label = sljit_emit_label(m_compiler);
		m_cache.setState(exit.state);
		if (const auto* semantic = std::get_if<SemanticExit>(&exit.target)) emitLeave(*semantic->site, semantic->charge);
		else {
			const auto& point = std::get<NativeResumePoint>(exit.target);
			auto& site = replaySites.emplace_back(NativeBlockExitSite{
				.exit = NativeBlockExit::ScalarBoundary,
				.operands = {.replay = {point.completed.has_value()}},
				.cycles = point.cycles,
				.registerTop = point.top,
				.nextPc = point.pc,
				.link = {},
			});
			if (point.completed) {
				site.currentPc = point.completed->pc;
				site.lastPc = point.completed->lastWord;
			}
			emitLeave(site, Charge::Pending);
		}
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
