#include "machine/cpu/native_block_compiler.h"

namespace bmsx {
namespace {
const NativeBlockExitSite scalarBoundary = [] {
	NativeBlockExitSite result;
	result.exit = NativeBlockExit::ScalarBoundary;
	return result;
}();
} // namespace

void NativeBlockCompiler::beginBlock(size_t index) {
	m_current = index;
	m_instruction = 0;
	m_prefixCycles = m_prefixTop = 0;
	m_terminal = false;
	m_controlPrivilegeGuarded = false;
	auto& entry = m_entries[index];
	entry.planned = true;
	m_cache.setState({});
	entry.guarded = sljit_emit_label(m_compiler);
	// Public entry points admit their own type proofs before any register move.
	// Internal edges have already established the exact same payload map.
	for (auto* miss : m_cache.transferTo(entry.registers, SLJIT_R2, SLJIT_FR2))
		if (miss)
			m_admissions.push_back({miss, m_blocks[index]->firstPc, {}});
	entry.proven = sljit_emit_label(m_compiler);
	auto* shortGrant = sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32, NativeBlockAbi::budget, 0, SLJIT_IMM,
		m_blocks[index]->admissionCycles);
	m_admissions.push_back({shortGrant, m_blocks[index]->firstPc, entry.registers});
}

void NativeBlockCompiler::emitTop(int extent) {
	if (extent == 0)
		return;
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, registerTop));
	auto* retained = sljit_emit_cmp(m_compiler, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, extent);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, registerTop), SLJIT_IMM, extent);
	sljit_set_label(retained, sljit_emit_label(m_compiler));
}
void NativeBlockCompiler::emitScalarBoundary(u32 pc, int cycles, int top) {
	m_cache.publish();
	emitTop(top);
	if (cycles)
		sljit_emit_op2(
			m_compiler, SLJIT_SUB32, NativeBlockAbi::budget, 0, NativeBlockAbi::budget, 0, SLJIT_IMM, cycles);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, scalarPc),
		SLJIT_IMM, pc);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(&scalarBoundary));
	sljit_emit_ijump(m_compiler, SLJIT_JUMP, SLJIT_IMM, reinterpret_cast<sljit_sw>(nativeBlockGate().leaveSegment));
	m_terminal = true;
}

void NativeBlockCompiler::emitLeave(NativeBlockExitSite& exit, bool charged) {
	m_cache.publish();
	emitTop(exit.registerTop);
	if (!charged)
		sljit_emit_op2(
			m_compiler, SLJIT_SUB32, NativeBlockAbi::budget, 0, NativeBlockAbi::budget, 0, SLJIT_IMM, exit.cycles);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(&exit));
	sljit_emit_ijump(m_compiler, SLJIT_JUMP, SLJIT_IMM, reinterpret_cast<sljit_sw>(nativeBlockGate().leaveSegment));
	m_terminal = true;
}

void NativeBlockCompiler::emitExit(NativeBlockExitSite& exit) {
	const bool completed = exit.exit == NativeBlockExit::CompletedCall;
	const size_t target = (completed || exit.exit == NativeBlockExit::Continue) ? regionEntryIndex(exit.nextPc) : m_blocks.size();
	if (target != m_blocks.size()) {
		const auto source = m_cache.state();
		if (!completed) {
			emitTop(exit.registerTop);
			sljit_emit_op2(
				m_compiler, SLJIT_SUB32, NativeBlockAbi::budget, 0, NativeBlockAbi::budget, 0, SLJIT_IMM, exit.cycles);
			fault(sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32, NativeBlockAbi::budget, 0, SLJIT_IMM, 0),
				exit, source, true);
		}
		auto& entry = m_entries[target];
		if (!entry.planned) {
			entry.planned = true;
			entry.registers = source;
			// This map can receive a dirty backedge after a clean public entry.
			// Treat retained payloads as deferred until an actual publication.
			for (auto& binding : entry.registers)
				if (binding.guest >= 0) {
					if (entryReads(target, binding.guest))
						binding.wordDirty = binding.tagDirty = true;
					else
						binding = {};
				}
		}
		for (auto* miss : m_cache.transferTo(entry.registers, SLJIT_R2, SLJIT_FR2))
			fault(miss, exit, source, true);
		m_branches.push_back({sljit_emit_jump(m_compiler, SLJIT_JUMP), target});
		m_terminal = true;
		return;
	}
	if (exit.exit != NativeBlockExit::Continue) {
		emitLeave(exit, false);
		return;
	}
	// Separately published regions have independent maps. Publish only here;
	// the receiving public entry will admit its own guarded representation.
	m_cache.publish();
	emitTop(exit.registerTop);
	sljit_emit_op2(
		m_compiler, SLJIT_SUB32, NativeBlockAbi::budget, 0, NativeBlockAbi::budget, 0, SLJIT_IMM, exit.cycles);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(&exit));
	auto* expired =
		sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32, NativeBlockAbi::budget, 0, SLJIT_IMM, 0);
	m_external.push_back({sljit_emit_jump(m_compiler, SLJIT_JUMP | SLJIT_REWRITABLE_JUMP), &exit.link});
	sljit_set_label(expired, sljit_emit_label(m_compiler));
	sljit_emit_ijump(m_compiler, SLJIT_JUMP, SLJIT_IMM, reinterpret_cast<sljit_sw>(nativeBlockGate().leaveSegment));
	m_terminal = true;
}

} // namespace bmsx
