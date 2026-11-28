#include "machine/cpu/jit/sljit/lowering.h"

#include <bit>

#include <algorithm>
#include <new>
#include "machine/common/numeric.h"
#include "spec/blua32/instruction_format.h"

namespace bmsx {

NativeLowering::NativeLowering(Workspace& workspace, std::span<const std::unique_ptr<NativeBlock>> blocks,
	const NativeCodeBindings& bindings, std::span<const NativeIrBlock> ir,
	std::span<NativeBlockExitSite> replays, NativeRegisterUses& uses, std::span<const NativeImageConstant> constants)
	: m_compiler(sljit_create_compiler(nullptr)), m_cache(m_compiler, NativeBlockAbi::words, NativeBlockAbi::tags,
													  NativeBlockAbi::wordRegisters, NativeBlockAbi::floatRegisters),
	  m_workspace(workspace), m_blocks(blocks), m_bindings(bindings), m_ir(ir), m_admissionReplays(replays), m_uses(uses),
	  m_constants(constants) {
	if (!m_compiler)
		throw std::bad_alloc();
	sljit_set_context(m_compiler, 0, NativeBlockAbi::signature, NativeBlockAbi::scratches, NativeBlockAbi::saveds,
		NativeBlockAbi::stackBytes);
}

void NativeLowering::Workspace::prepare(std::span<const std::unique_ptr<NativeBlock>> blocks) {
	entries.assign(blocks.size(), {});
	branches.reserve(blocks.size() * 2);
	external.reserve(blocks.size() * 2);
	size_t exits = 0;
	for (const auto& block : blocks)
		exits += block->sideExits.size();
	coldExits.reserve(exits + blocks.size() * 2);
	coldBranches.reserve(exits * 2 + blocks.size());
}

void NativeLowering::Workspace::clear() {
	entries.clear();
	branches.clear();
	external.clear();
	coldExits.clear();
	coldBranches.clear();
	ramMisses.clear();
	localIoWrites.clear();
	singleStringReads.clear();
	stringStoreMisses.clear();
}

NativeLowering::~NativeLowering() {
	m_workspace.clear();
	sljit_free_compiler(m_compiler);
}
NativeRegisterCache::Operand NativeLowering::readTyped(
	int selector, ValueTag tag, sljit_s32 wordScratch, sljit_s32 floatScratch) {
	if (selector >= 0)
		return m_cache.read(selector, tag);
	emitPoolWord(-selector - 1, wordScratch);
	if (tag != ValueTag::Float)
		return {wordScratch, tag, -1};
	sljit_emit_fcopy(m_compiler, SLJIT_COPY32_TO_F32, floatScratch, wordScratch);
	return {floatScratch, tag, -1};
}
void NativeLowering::emitPoolWord(u32 index, sljit_s32 word) {
	auto* c = m_compiler;
	if (const auto constant = nativeImageConstant(m_constants, index)) {
		sljit_emit_op1(c, SLJIT_MOV32, word, 0, SLJIT_IMM, valuePayload(*constant));
		return;
	}
	constexpr auto base = offsetof(NativeBlockRunState, constants);
	sljit_emit_op1(c, SLJIT_MOV_P, word, 0, SLJIT_MEM1(NativeBlockAbi::state), base + ConstValueSpan::wordsOffset());
	sljit_emit_op1(c, SLJIT_MOV32, word, 0, SLJIT_MEM1(word), index * sizeof(u32));
	if constexpr (std::endian::native == std::endian::big) {
		auto* hostPool = sljit_emit_cmp(c, SLJIT_EQUAL, SLJIT_MEM1(NativeBlockAbi::state),
			base + ConstValueSpan::ramOffset(), SLJIT_IMM, 0);
		sljit_emit_op1(c, SLJIT_REV32, word, 0, word, 0);
		sljit_set_label(hostPool, sljit_emit_label(c));
	}
}

void NativeLowering::emitPoolTag(u32 index, sljit_s32 tag) {
	auto* c = m_compiler;
	if (const auto constant = nativeImageConstant(m_constants, index)) {
		sljit_emit_op1(c, SLJIT_MOV32, tag, 0, SLJIT_IMM, static_cast<u8>(valueTag(*constant)));
		return;
	}
	sljit_emit_op1(c, SLJIT_MOV_P, tag, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, constants) + ConstValueSpan::tagsOffset());
	sljit_emit_op1(c, SLJIT_MOV_U8, tag, 0, SLJIT_MEM1(tag), index);
}

sljit_jump* NativeLowering::guardTag(int selector, ValueTag tag, sljit_s32 scratch) {
	if (selector >= 0) return m_cache.guard(selector, tag, scratch);
	emitPoolTag(-selector - 1, scratch);
	return sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, scratch, 0, SLJIT_IMM, static_cast<u8>(tag));
}

void NativeLowering::lowerOperation(const NativeConstantLoad& load, const NativeInstruction&) {
	emitPoolWord(load.index, SLJIT_R0);
	emitPoolTag(load.index, SLJIT_R1);
	emitRawStore(load.result, SLJIT_R0, SLJIT_R1, m_uses.nextOperandDemand(m_instruction, load.result));
}

void NativeLowering::emitPayload(int selector, sljit_s32 word) {
	if (selector >= 0)
		m_cache.emitWord(selector, word);
	else
		emitPoolWord(-selector - 1, word);
}

void NativeLowering::emitTag(int selector, sljit_s32 tag) {
	if (selector >= 0)
		m_cache.emitTag(selector, tag);
	else
		emitPoolTag(-selector - 1, tag);
}

void NativeLowering::emitRawLoad(int selector, sljit_s32 word, sljit_s32 tag) {
	emitPayload(selector, word);
	emitTag(selector, tag);
}

void NativeLowering::emitRawStore(int guest, sljit_s32 word, sljit_s32 tag, NativeOperandDemand demand) {
	const auto dest = m_cache.writeRaw(guest, demand);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, dest.word, dest.wordOffset, word, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV_U8, dest.tag, dest.tagOffset, tag, 0);
}
void NativeLowering::emitConstant(int guest, Value value) {
	const auto target = m_cache.write(guest, valueTag(value));
	if (target.tag == ValueTag::Float) {
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM, valuePayload(value));
		sljit_emit_fcopy(m_compiler, SLJIT_COPY32_TO_F32, target.reg, SLJIT_R0);
	} else
		sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, SLJIT_IMM, valuePayload(value));
}
void NativeLowering::fault(sljit_jump* jump, NativeBlockExitSite& site, const State& state, Charge charge, NativeBlockExitSite* exhausted) {
	// Several guards of one guest operation can publish the same state.
	if (!jump) return;
	const SemanticExit target{&site, charge, exhausted};
	for (size_t i = m_workspace.coldExits.size(); i != 0;) {
		const auto& exit = m_workspace.coldExits[--i];
		if (exit.target != target) break;
		if (m_cache.samePublication(exit.state, state)) {
			m_workspace.coldBranches.push_back({jump, i});
			return;
		}
	}
	m_workspace.coldBranches.push_back({jump, m_workspace.coldExits.size()});
	m_workspace.coldExits.push_back({target, state});
}
void NativeLowering::lowerOperation(const NativeMove& instruction, const NativeInstruction& row) {
	const auto mode = instruction.conversion;
	if (mode == ValueMoveKind::Copy) {
		if (!instruction.sourceTag) {
			emitRawLoad(instruction.source, SLJIT_R0, SLJIT_R1);
			emitRawStore(instruction.result, SLJIT_R0, SLJIT_R1, m_uses.nextOperandDemand(m_instruction, instruction.result));
			return;
		}
		const auto source = readTyped(instruction.source, *instruction.sourceTag);
		const auto target = m_cache.write(instruction.result, source.tag);
		if (source.reg != target.reg) {
			if (source.tag == ValueTag::Float)
				sljit_emit_fop1(m_compiler, SLJIT_MOV_F32, target.reg, 0, source.reg, 0);
			else
				sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, source.reg, 0);
		}
		return;
	}
	if (mode == ValueMoveKind::Tag) {
		if (instruction.sourceTag) {
			emitConstant(instruction.result, valueInteger(static_cast<u8>(*instruction.sourceTag)));
		} else {
			emitTag(instruction.source, SLJIT_R0);
			const auto target = m_cache.write(instruction.result, ValueTag::Integer);
			if (target.reg != SLJIT_R0)
				sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, SLJIT_R0, 0);
		}
		return;
	}
	const ValueTag required = mode == ValueMoveKind::FloatBits ? ValueTag::Float : ValueTag::Integer;
	if (instruction.conversionCheck == NativeTagCheck::Dynamic)
		fault(guardTag(instruction.source, required, SLJIT_R0), *sideExit(row.slow), m_cache.state());
	const auto source = readTyped(instruction.source, required);
	const auto target = m_cache.write(instruction.result, required == ValueTag::Float ? ValueTag::Integer : ValueTag::Float);
	sljit_emit_fcopy(m_compiler, required == ValueTag::Float ? SLJIT_COPY32_FROM_F32 : SLJIT_COPY32_TO_F32,
		required == ValueTag::Float ? source.reg : target.reg, required == ValueTag::Float ? target.reg : source.reg);
}

void NativeLowering::lowerOperation(const NativeWindowMove& move, const NativeInstruction& row) {
	auto* c = m_compiler;
	constexpr auto state = NativeBlockAbi::state, words = NativeBlockAbi::words, tags = NativeBlockAbi::tags;
	constexpr auto top = offsetof(NativeBlockRunState, registerTop);
	constexpr auto capacity = offsetof(NativeBlockRunState, registerCapacity);
	if (move.kind == ValueMoveKind::ReadTop) {
		emitTop(move.prefixTop);
		const auto result = m_cache.write(move.a, ValueTag::Integer);
		sljit_emit_op1(c, SLJIT_MOV32, result.reg, 0, SLJIT_MEM1(state), top);
		return;
	}
	const bool indexedWrite = move.kind == ValueMoveKind::WriteIndexed;
	const bool setsTop = move.kind == ValueMoveKind::SetTop;
	// A dynamic source may alias any cached lane. Writes also invalidate
	// the physical identity of any cached destination after sampling both inputs.
	if (!setsTop) m_cache.publish();
	emitPayload(indexedWrite ? move.a : move.b, SLJIT_R2);
	fault(sljit_emit_cmp(c, (setsTop ? SLJIT_GREATER : SLJIT_GREATER_EQUAL) | SLJIT_32,
		SLJIT_R2, 0, SLJIT_MEM1(state), capacity), *sideExit(row.slow), m_cache.state());
	if (setsTop) {
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), top, SLJIT_R2, 0);
	} else if (indexedWrite) {
		emitRawLoad(move.b, SLJIT_R0, SLJIT_R1);
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM2(words, SLJIT_R2), 2, SLJIT_R0, 0);
		sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_MEM2(tags, SLJIT_R2), 0, SLJIT_R1, 0);
		m_cache.discardRange(0, std::numeric_limits<int>::max());
		sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, 1);
		auto* retained = sljit_emit_cmp(c, SLJIT_GREATER_EQUAL | SLJIT_32,
			SLJIT_MEM1(state), top, SLJIT_R2, 0);
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), top, SLJIT_R2, 0);
		sljit_set_label(retained, sljit_emit_label(c));
	} else {
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM2(words, SLJIT_R2), 2);
		sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM2(tags, SLJIT_R2), 0);
		emitRawStore(move.a, SLJIT_R0, SLJIT_R1, m_uses.nextOperandDemand(m_instruction, move.a));
	}
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
		emitRawStore(instruction.result, SLJIT_R0, SLJIT_R1, m_uses.nextOperandDemand(m_instruction, instruction.result));
	}
}

void NativeLowering::lowerOperation(const NativeReplay&, const NativeInstruction& row) {
	fault(sljit_emit_jump(m_compiler, SLJIT_JUMP), *sideExit(row.replay), m_cache.state());
	m_terminal = true;
}

void NativeLowering::lowerOperation(const NativeJump& jump, const NativeInstruction& row) {
	if (jump.link >= 0)
		emitConstant(static_cast<NativeSlot>(jump.link), valueInteger(toSignedWord(row.pc + u32{row.width} * INSTRUCTION_BYTES)));
	emitExit(m_blocks[m_current]->terminal);
}

void NativeLowering::lowerOperation(const NativeLiteral& literal, const NativeInstruction&) {
	emitConstant(literal.result, literal.value);
}

void NativeLowering::lowerOperation(const NativeTruthBranch& branch, const NativeInstruction&) {
	const auto& block = m_ir[m_current];
	auto& terminal = m_blocks[m_current]->terminal;
	emitTag(branch.condition, SLJIT_R1);
	auto* falsey = sljit_emit_cmp(m_compiler, SLJIT_LESS_EQUAL | SLJIT_32, SLJIT_R1, 0,
		SLJIT_IMM, static_cast<u8>(ValueTag::False));
	const auto state = m_cache.state();
	emitExit(branch.takeOnTruthy ? *sideExit(block.taken) : terminal, branch.takeOnTruthy, EdgePosition::BeforeAlternate);
	sljit_set_label(falsey, sljit_emit_label(m_compiler));
	m_cache.setState(state);
	emitExit(branch.takeOnTruthy ? terminal : *sideExit(block.taken), !branch.takeOnTruthy);
}

void NativeLowering::lower(const NativeInstruction& source) {
	++m_instruction;
	if (m_terminal)
		return;
	m_cache.beginInstruction([&](int guest) { return m_uses.nextRead(m_instruction - 1, guest); });

	m_cache.applyConstraints(m_constraints[m_instruction - 1]);
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	// The translator selects the events; here only emit the actual counter.
	constexpr std::array<sljit_sw, 3> counters{
		-1, offsetof(DiagnosticNativeOpcodeCounts, call),
		offsetof(DiagnosticNativeOpcodeCounts, setfield),
	};
	sljit_sw offset = counters[static_cast<size_t>(source.attempt)];
	if (offset >= 0) {
		offset += offsetof(NativeBlockRunState, diagnosticOpcodes);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(NativeBlockAbi::state), offset);
		sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 1);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(NativeBlockAbi::state), offset, SLJIT_R0, 0);
	}
#endif
	std::visit([&](const auto& op) {
		lowerOperation(op, source);
	}, source.operation);
}

void NativeLowering::endBlock() {
	if (!m_terminal) {
		m_cache.reserveScratch(nativeEdgeWordUses);
		emitExit(m_blocks[m_current]->terminal);
	}
}
void* NativeLowering::finish(size_t& codeBytes) {
	// Adjacent native bodies share a fallthrough. Only external callers
	// execute the public admission and its register imports.
	for (size_t i = 0; i < m_blocks.size(); ++i) {
		const auto& entry = m_workspace.entries[i];
		if (!entry.fallthrough) continue;
		emitPublicEntry(i);
		sljit_set_label(sljit_emit_jump(m_compiler, SLJIT_JUMP), entry.proven);
	}
	emitRamMisses();
	emitLocalIoWrites();
	emitSingleStringReads();
	emitStringStoreMisses();
	for (auto& exit : m_workspace.coldExits) {
		exit.label = sljit_emit_label(m_compiler);
		m_cache.emitState(exit.state);
		if (exit.target.exhausted) {
			// The hot edge already charged its predecessor. Only a positive
			// short grant replays; an exhausted one ends at the completed edge.
			auto* positive = sljit_emit_cmp(m_compiler, SLJIT_SIG_GREATER | SLJIT_32,
				NativeBlockAbi::budget, 0, SLJIT_IMM, 0);
			emitPublishedLeave(*exit.target.exhausted, Charge::Paid);
			sljit_set_label(positive, sljit_emit_label(m_compiler));
		}
		emitPublishedLeave(*exit.target.site, exit.target.charge);
	}
	for (const auto& branch : m_workspace.coldBranches)
		sljit_set_label(branch.jump, m_workspace.coldExits[branch.target].label);
	for (const auto& branch : m_workspace.branches)
		sljit_set_label(branch.jump, m_workspace.entries[branch.target].proven);
	void* code = sljit_generate_code(m_compiler, 0, nullptr);
	if (!code)
		throw std::bad_alloc();
	codeBytes = sljit_get_generated_code_size(m_compiler);
	for (size_t index = 0; index < m_blocks.size(); ++index) {
		m_blocks[index]->m_body = reinterpret_cast<void*>(sljit_get_label_addr(m_workspace.entries[index].guarded));
	}
	for (const auto& branch : m_workspace.external) {
		branch.link->patchAddress = sljit_get_jump_addr(branch.jump);
		branch.link->coldEntry = sljit_get_label_addr(branch.coldEntry);
		branch.link->executableOffset = sljit_get_executable_offset(m_compiler);
	}
	return code;
}

} // namespace bmsx
