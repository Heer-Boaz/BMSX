#include "machine/cpu/jit/sljit/lowering.h"

#include <algorithm>

#include "machine/cpu/cpu.h"
#include "machine/cpu/jit/runtime/execution.h"

namespace bmsx {

void NativeLowering::lowerOperation(const NativeCallSite& site, const NativeInstruction&) {
	auto& block = *m_blocks[m_current];
	auto& call = block.terminal;
	const auto& ir = m_ir[m_current];
	const int base = site.callee;
	if (!ir.completedCall) {
		emitLeave(call, Charge::Pending);
		return;
	}

	if (site.calleeCheck == NativeTagCheck::Dynamic)
		fault(m_cache.guard(base, ValueTag::BuiltinFunction, SLJIT_R0), call, m_cache.state());
	const auto id = readTyped(base, ValueTag::BuiltinFunction);
	sljit_emit_op2(m_compiler, SLJIT_SHL32, SLJIT_R1, 0, SLJIT_IMM, 1, id.reg, 0);
	sljit_emit_op2u(m_compiler, SLJIT_AND32 | SLJIT_SET_Z, SLJIT_R1, 0, SLJIT_IMM, NATIVE_BUILTIN_LEAF_IDS);
	fault(sljit_emit_jump(m_compiler, SLJIT_ZERO), call, m_cache.state());
	m_cache.publishRange(base, base + 1 + site.supplied);

	const auto emitLeafCall = [&] {
		m_cache.spillCall(false, 0);
		sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, remainingCycles),
			NativeBlockAbi::budget, 0, SLJIT_IMM, call.cycles);
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(m_bindings.cpu));
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0, NativeBlockAbi::state, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(&call));
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R3, 0, id.reg, 0);
		sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS4(32, P, P, P, 32), SLJIT_IMM, SLJIT_FUNC_ADDR(&CPU::runNativeBuiltinLeaf));
		m_cache.spillCall(true, 0);
		fault(sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM,
			static_cast<u32>(NativeBuiltinCallOutcome::Declined)), call, m_cache.state());

		if (site.requested != 0) m_cache.discardRange(base, base + 1);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, NativeBlockAbi::budget, 0, SLJIT_MEM1(NativeBlockAbi::state),
			offsetof(NativeBlockRunState, remainingCycles));
		auto& completed = *sideExit(ir.completedCall);
		fault(sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM,
			static_cast<u32>(NativeBuiltinCallOutcome::CompletedStop)), completed, m_cache.state(), Charge::Paid);
		emitExit(completed);
	};
	const auto& prefix = m_cache.state();
	if (!std::ranges::any_of(prefix, [](const auto& slot) { return slot.wordDirty || slot.tagDirty; })) {
		emitLeafCall();
		return;
	}

	// A read-only record can overlap the frame outside the arguments. Emit a
	// separate publication state so neither path writes those slots twice.
	sljit_emit_op2u(m_compiler, SLJIT_AND32 | SLJIT_SET_Z, SLJIT_R1, 0, SLJIT_IMM, NATIVE_BUILTIN_RECORD_OBSERVER_IDS);
	auto* observer = sljit_emit_jump(m_compiler, SLJIT_NOT_ZERO);
	const auto operandOnly = prefix;
	emitLeafCall();
	sljit_set_label(observer, sljit_emit_label(m_compiler));
	m_cache.setState(operandOnly);
	m_cache.publish();
	emitLeafCall();
}

} // namespace bmsx
