#include "machine/cpu/native_lowering.h"

#include <algorithm>

namespace bmsx {
namespace {
const NativeBlockExitSite scalarBoundary = [] {
	NativeBlockExitSite result;
	result.exit = NativeBlockExit::ScalarBoundary;
	return result;
}();
bool registerTransferProves(const NativeRegisterCache::State& registers, NativeSlotType type) {
	return std::any_of(registers.begin(), registers.end(), [&](const auto& binding) {
		return binding.guest == type.slot && binding.tag == type.tag;
	});
}

} // namespace

void NativeLowering::beginBlock(size_t index) {
	m_current = index;
	m_instruction = 0;
	m_uses.beginBlock(m_ir[index].instructions);
	m_terminal = false;
	auto& entry = m_entries[index];
	entry.planned = true;
	const auto& ir = m_ir[index];
	m_cache.setState({});
	entry.guarded = sljit_emit_label(m_compiler);
	// Public entry points admit their own type proofs before any register move.
	// Internal edges have already established the exact same payload map.
	const u32 pc = m_blocks[index]->firstPc;
	const State memoryAuthoritative{};
	for (const auto type : ir.entryTypes)
		if (!registerTransferProves(entry.registers, type))
			deferColdExit(m_cache.guard(type.slot, type.tag, SLJIT_R2), NativeResumePoint{pc, 0, 0}, memoryAuthoritative);
	for (auto* miss : m_cache.transferTo(entry.registers, SLJIT_R2, SLJIT_FR2))
		deferColdExit(miss, NativeResumePoint{pc, 0, 0}, memoryAuthoritative);
	entry.proven = sljit_emit_label(m_compiler);
	auto* shortGrant = sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32, NativeBlockAbi::budget, 0, SLJIT_IMM,
		m_blocks[index]->admissionCycles);
	deferColdExit(shortGrant, NativeResumePoint{pc, 0, 0}, entry.registers);
}

void NativeLowering::emitTop(int extent) {
	if (extent == 0)
		return;
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, registerTop));
	auto* retained = sljit_emit_cmp(m_compiler, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, extent);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, registerTop), SLJIT_IMM, extent);
	sljit_set_label(retained, sljit_emit_label(m_compiler));
}
void NativeLowering::emitScalarBoundary(NativeResumePoint point) {
	const auto [pc, cycles, top] = point;
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

void NativeLowering::emitLeave(NativeBlockExitSite& exit, Charge charge) {
	m_cache.publish();
	const auto& gate = nativeBlockGate();
	void* target = gate.leaveSegment;
	if (charge == Charge::Pending) {
		// Activation transfers can continue inside the grant. Encode their
		// already known prefix rather than loading it in the shared gate.
		if (exit.exit == NativeBlockExit::Call || exit.exit == NativeBlockExit::Return) {
			emitTop(exit.registerTop);
			sljit_emit_op2(m_compiler, SLJIT_SUB32, NativeBlockAbi::budget, 0,
				NativeBlockAbi::budget, 0, SLJIT_IMM, exit.cycles);
		} else if (exit.cycles != 0 || exit.registerTop != 0) {
			target = gate.publishSegment;
		}
	}
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(&exit));
	sljit_emit_ijump(m_compiler, SLJIT_JUMP, SLJIT_IMM, reinterpret_cast<sljit_sw>(target));
	m_terminal = true;
}

void NativeLowering::emitExit(NativeBlockExitSite& exit, size_t target) {
	const bool completed = exit.exit == NativeBlockExit::CompletedCall;
	if (target != m_blocks.size() && (completed || exit.exit == NativeBlockExit::Continue)) {
		const auto source = m_cache.state();
		if (!completed) {
			emitTop(exit.registerTop);
			sljit_emit_op2(
				m_compiler, SLJIT_SUB32, NativeBlockAbi::budget, 0, NativeBlockAbi::budget, 0, SLJIT_IMM, exit.cycles);
			fault(sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32, NativeBlockAbi::budget, 0, SLJIT_IMM, 0),
				exit, source, Charge::Paid);
		}
		auto& entry = m_entries[target];
		if (!entry.planned && !m_uses.hasForwardMerge(target)) {
			entry.planned = true;
			entry.registers = source;
			// This map can receive a dirty backedge after a clean public entry.
			// Treat retained payloads as deferred until an actual publication.
			for (auto& binding : entry.registers)
				if (binding.guest >= 0) {
					if (m_uses.entryReads(target, binding.guest))
						binding.wordDirty = binding.tagDirty = true;
					else
						binding = {};
				}
		}
		for (const auto type : m_ir[target].entryTypes)
			if (!registerTransferProves(entry.registers, type))
				fault(m_cache.guard(type.slot, type.tag, SLJIT_R2), exit, source, Charge::Paid);
		for (auto* miss : m_cache.transferTo(entry.registers, SLJIT_R2, SLJIT_FR2))
			fault(miss, exit, source, Charge::Paid);
		m_branches.push_back({sljit_emit_jump(m_compiler, SLJIT_JUMP), target});
		m_terminal = true;
		return;
	}
	if (exit.exit != NativeBlockExit::Continue) {
		emitLeave(exit, Charge::Pending);
		return;
	}
	// Separately published regions have independent maps. Publish only here;
	// the receiving public entry will admit its own guarded representation.
	m_cache.publish();
	emitTop(exit.registerTop);
	sljit_emit_op2(m_compiler, SLJIT_SUB32 | SLJIT_SET_SIG_GREATER, NativeBlockAbi::budget, 0,
		NativeBlockAbi::budget, 0, SLJIT_IMM, exit.cycles);
	// Positive grants can take the patched edge without loading the exit
	// descriptor. An expired grant or withdrawn target enters the same stub.
	auto* jump = sljit_emit_jump(m_compiler, SLJIT_SIG_GREATER | SLJIT_REWRITABLE_JUMP);
	auto* coldEntry = sljit_emit_label(m_compiler);
	sljit_set_label(jump, coldEntry);
	m_external.push_back({jump, coldEntry, &exit.link});
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(&exit));
	sljit_emit_ijump(m_compiler, SLJIT_JUMP, SLJIT_IMM, reinterpret_cast<sljit_sw>(nativeBlockGate().leaveSegment));
	m_terminal = true;
}

} // namespace bmsx
