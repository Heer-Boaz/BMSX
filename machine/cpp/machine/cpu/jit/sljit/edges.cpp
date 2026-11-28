#include "machine/cpu/jit/sljit/lowering.h"
#include "machine/cpu/jit/sljit/gate.h"

#include <algorithm>
#include "machine/cpu/call_state.h"

namespace bmsx {
void NativeLowering::beginBlock(size_t index) {
	m_current = index;
	m_instruction = 0;
	// The imported layout is independent of the last physically emitted arm.
	// Start without reservations so its first operation reconciles every fixed use.
	m_cache.reserveScratch(0);
	m_uses.beginBlock(m_ir[index].instructions);
	planWordConstraints(m_ir[index].instructions, m_constraints);
	m_terminal = false;
	auto& entry = m_workspace.entries[index];
	entry.planned = true;
	const auto& ir = m_ir[index];
	m_decodedPage = m_bindings.decodedPageFor(ir.firstPc);
	if (!ir.ownFieldAddresses.empty())
		assignFieldAddressSpills(ir.ownFieldAddresses);
	if (entry.fallthrough) m_cache.setState(entry.registers);
	else emitPublicEntry(index);
	entry.proven = sljit_emit_label(m_compiler);
}

void NativeLowering::emitPublicEntry(size_t index) {
	auto& entry = m_workspace.entries[index];
	const auto& ir = m_ir[index];
	m_cache.setState({});
	entry.guarded = sljit_emit_label(m_compiler);
	// Public entries admit their reachable slot window and their own types
	// before moving registers. Local edges inherit slot admission.
	auto& replay = m_admissionReplays[ir.entryReplay];
	if (ir.requiredSlots != 0)
		fault(sljit_emit_cmp(m_compiler, SLJIT_LESS, SLJIT_MEM1(NativeBlockAbi::state),
			offsetof(NativeBlockRunState, registerCapacity), SLJIT_IMM, ir.requiredSlots), replay, m_cache.state());
	if (ir.requiredCaptures != 0) {
		auto* c = m_compiler;
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, closure));
		fault(sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 0), replay, m_cache.state());
		sljit_emit_op2(c, SLJIT_AND32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
		NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R2);
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R2), CLOSURE_COUNT_WORD);
		if constexpr (std::endian::native == std::endian::big)
			sljit_emit_op1(c, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
		sljit_emit_op2(c, SLJIT_LSHR32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, CLOSURE_COUNT_SHIFT);
		sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R2), CLOSURE_COUNT_HIGH_BYTE);
		sljit_emit_op2(c, SLJIT_AND32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 0x7fu);
		sljit_emit_op2(c, SLJIT_SHL32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, CLOSURE_COUNT_LOW_BITS);
		sljit_emit_op2(c, SLJIT_OR32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_R1, 0);
		fault(sljit_emit_cmp(c, SLJIT_LESS | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, ir.requiredCaptures), replay, m_cache.state());
	}
	auto* shortGrant = sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32, NativeBlockAbi::budget, 0, SLJIT_IMM,
		ir.admissionCycles);
	fault(shortGrant, replay, m_cache.state());
	for (const auto type : ir.entryTypes)
		fault(m_cache.guard(type.slot, type.tag, SLJIT_R2), replay, m_cache.state());
	m_cache.transferTo(entry.registers, SLJIT_R2, SLJIT_FR2);
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
	emitPublishedLeave(exit, charge);
}

void NativeLowering::emitPublishedLeave(NativeBlockExitSite& exit, Charge charge) {
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

void NativeLowering::lowerOperation(const NativeRegisterJump& jump, const NativeInstruction&) {
	auto& exit = m_blocks[m_current]->terminal;
	if (!m_bindings.cpu) {
		emitLeave(exit, Charge::Pending);
		return;
	}
	m_cache.publish();
	emitPayload(jump.target, SLJIT_R2);
	emitTop(exit.registerTop);
	sljit_emit_op2(m_compiler, SLJIT_SUB32, NativeBlockAbi::budget, 0,
		NativeBlockAbi::budget, 0, SLJIT_IMM, exit.cycles);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(&exit));
	sljit_emit_ijump(m_compiler, SLJIT_JUMP, SLJIT_IMM, reinterpret_cast<sljit_sw>(nativeBlockGate().registerJump));
	m_terminal = true;
}

void NativeLowering::lowerOperation(const NativeRegisterWindowTransfer& transfer, const NativeInstruction&) {
	auto& exit = m_blocks[m_current]->terminal;
	if (!m_bindings.cpu) {
		emitLeave(exit, Charge::Pending);
		return;
	}
	m_cache.publish();
	emitTop(exit.registerTop);
	sljit_emit_op2(m_compiler, SLJIT_SUB32, NativeBlockAbi::budget, 0, NativeBlockAbi::budget, 0, SLJIT_IMM, exit.cycles);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(&exit));
	const auto& gate = nativeBlockGate();
	void* target = transfer.mode == RegisterJumpMode::EnterWindow ? gate.enterWindow : gate.leaveWindow;
	sljit_emit_ijump(m_compiler, SLJIT_JUMP, SLJIT_IMM, reinterpret_cast<sljit_sw>(target));
	m_terminal = true;
}

void NativeLowering::emitExit(NativeBlockExitSite& exit, size_t edge, EdgePosition position, sljit_label** sharedExternal) {
	const auto& block = m_ir[m_current];
	const auto target = block.successors[edge];
	const bool completed = exit.exit == NativeBlockExit::CompletedCall;
	if (target != m_blocks.size() && (completed || exit.exit == NativeBlockExit::Continue)) {
		const auto& source = m_cache.state();
		const auto& successor = m_ir[target];
		const auto replayId = block.edgeReplay[edge];
		if (!completed) {
			emitTop(exit.registerTop);
			if (successor.admissionCycles != 0) {
				sljit_emit_op2(m_compiler, SLJIT_SUB32, NativeBlockAbi::budget, 0,
					NativeBlockAbi::budget, 0, SLJIT_IMM, exit.cycles);
				fault(sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32,
					NativeBlockAbi::budget, 0, SLJIT_IMM, successor.admissionCycles),
					m_admissionReplays[*replayId], source, Charge::Paid, &exit);
			} else {
				sljit_emit_op2(m_compiler, SLJIT_SUB32 | SLJIT_SET_SIG_LESS_EQUAL, NativeBlockAbi::budget, 0,
					NativeBlockAbi::budget, 0, SLJIT_IMM, exit.cycles);
				fault(sljit_emit_jump(m_compiler, SLJIT_SIG_LESS_EQUAL), exit, source, Charge::Paid);
			}
		}
		auto& entry = m_workspace.entries[target];
		if (replayId) {
			auto& replay = m_admissionReplays[*replayId];
			if (completed && successor.admissionCycles != 0)
				fault(sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32,
					NativeBlockAbi::budget, 0, SLJIT_IMM, successor.admissionCycles), replay, source);
			if (!block.provesEntryTo(target))
				for (const auto type : successor.entryTypes)
					fault(m_cache.guard(type.slot, type.tag, SLJIT_R2), replay, source);
		}
		// The first incoming edge fixes the live locations, not their values.
		// All later predecessors (and the public entry) parallel-move into them.
		if (!entry.planned) {
			entry.planned = true;
			entry.registers = source;
			// Only the entry contract establishes exact tags. Other live
			// payloads retain their locations without constraining their tags.
			for (auto& binding : entry.registers) {
				if (binding.guest < 0) continue;
				// Liveness includes semantic exits and the pre-folded graph.
				// Neither gives the public entry permission to load a slot.
				if (static_cast<u32>(binding.guest) >= successor.requiredSlots || !m_uses.entryReads(target, binding.guest)) {
					binding = {};
					continue;
				}
				const auto type = std::ranges::lower_bound(successor.entryTypes, binding.guest, {}, &NativeSlotType::slot);
				binding.tag = type != successor.entryTypes.end() && type->slot == binding.guest
					? std::optional(type->tag) : std::nullopt;
				binding.dirty = true; // Another edge can bring a dirty payload.
				if (binding.tagLane) {
					if (binding.tag) binding = {}; // Entry proof supplies the tag.
				} else binding.immediateTagDirty = binding.tag.has_value();
			}
		}
		m_cache.transferTo(entry.registers, SLJIT_R2, SLJIT_FR2);
		if (position == EdgePosition::Tail && target == m_current + 1) entry.fallthrough = true;
		else m_workspace.branches.push_back({sljit_emit_jump(m_compiler, SLJIT_JUMP), target});
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
	// Distinct cache-publication arms share one patchable branch per link.
	if (sharedExternal) {
		if (*sharedExternal) {
			sljit_set_label(sljit_emit_jump(m_compiler, SLJIT_JUMP), *sharedExternal);
			m_terminal = true;
			return;
		}
		*sharedExternal = sljit_emit_label(m_compiler);
	}
	emitTop(exit.registerTop);
	sljit_emit_op2(m_compiler, SLJIT_SUB32 | SLJIT_SET_SIG_GREATER, NativeBlockAbi::budget, 0,
		NativeBlockAbi::budget, 0, SLJIT_IMM, exit.cycles);
	// Positive grants can take the patched edge without loading the exit
	// descriptor. An expired grant or withdrawn target enters the same stub.
	auto* jump = sljit_emit_jump(m_compiler, SLJIT_SIG_GREATER | SLJIT_REWRITABLE_JUMP);
	auto* coldEntry = sljit_emit_label(m_compiler);
	sljit_set_label(jump, coldEntry);
	m_workspace.external.push_back({jump, coldEntry, &exit.link});
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(&exit));
	sljit_emit_ijump(m_compiler, SLJIT_JUMP, SLJIT_IMM, reinterpret_cast<sljit_sw>(nativeBlockGate().leaveSegment));
	m_terminal = true;
}

} // namespace bmsx
