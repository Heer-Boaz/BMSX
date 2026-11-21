#include "machine/cpu/jit/sljit/lowering.h"
#include "machine/cpu/jit/sljit/gate.h"

#include <algorithm>

namespace bmsx {
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
	const NativeResumePoint replay{pc, 0, 0};
	auto* shortGrant = sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32, NativeBlockAbi::budget, 0, SLJIT_IMM,
		m_blocks[index]->admissionCycles);
	deferColdExit(shortGrant, replay, memoryAuthoritative);
	for (const auto type : ir.entryTypes)
		deferColdExit(m_cache.guard(type.slot, type.tag, SLJIT_R2), replay, memoryAuthoritative);
	m_cache.transferTo(entry.registers, SLJIT_R2, SLJIT_FR2);
	entry.proven = sljit_emit_label(m_compiler);
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
		const auto& successor = m_ir[target];
		const NativeResumePoint replay{exit.nextPc, 0, 0,
			NativeResumePoint::CompletedInstruction{exit.currentPc, exit.lastPc}};
		if (const int minimum = m_blocks[target]->admissionCycles; minimum != 0)
			deferColdExit(sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32,
				NativeBlockAbi::budget, 0, SLJIT_IMM, minimum), replay, source);
		if (!entry.planned && !m_uses.hasForwardMerge(target)) {
			entry.planned = true;
			entry.registers = source;
			// Only the entry contract establishes exact tags. Other live
			// payloads retain their locations without constraining their tags.
			for (auto& binding : entry.registers) {
				if (binding.guest < 0) continue;
				if (!m_uses.entryReads(target, binding.guest)) {
					binding = {};
					continue;
				}
				const auto type = std::ranges::lower_bound(successor.entryTypes, binding.guest, {}, &NativeSlotType::slot);
				binding.tag = type != successor.entryTypes.end() && type->slot == binding.guest
					? std::optional(type->tag) : std::nullopt;
				binding.wordDirty = true; // Another edge can bring a dirty payload.
				binding.tagDirty = binding.tag.has_value();
			}
		}
		if (successor.typePredecessor != m_current)
			for (const auto type : successor.entryTypes)
				deferColdExit(m_cache.guard(type.slot, type.tag, SLJIT_R2), replay, source);
		m_cache.transferTo(entry.registers, SLJIT_R2, SLJIT_FR2);
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
