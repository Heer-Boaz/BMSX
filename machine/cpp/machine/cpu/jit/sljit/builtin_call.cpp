#include "machine/cpu/jit/sljit/lowering.h"

#include "machine/cpu/cpu.h"
#include "machine/cpu/jit/runtime/execution.h"

namespace bmsx {

sljit_jump* NativeBlockAbi::emitNonleafBuiltinJump(sljit_compiler* compiler, sljit_s32 id) {
	sljit_emit_op2(compiler, SLJIT_LSHR32, SLJIT_R1, 0, SLJIT_IMM, NATIVE_BUILTIN_LEAF_IDS, id, 0);
	sljit_emit_op2u(compiler, SLJIT_AND32 | SLJIT_SET_Z, SLJIT_R1, 0, SLJIT_IMM, 1);
	return sljit_emit_jump(compiler, SLJIT_ZERO);
}

void NativeLowering::lowerOperation(const NativeCallSite& site, const NativeInstruction&) {
	auto& block = *m_blocks[m_current];
	auto& call = block.terminal;
	const auto& ir = m_ir[m_current];
	const int base = site.callee;
	if (!ir.completedCall || ir.successors[0] == m_ir.size() || site.calleeCheck == NativeTagCheck::Rejected) {
		emitLeave(call, Charge::Pending);
		return;
	}

	if (site.calleeCheck == NativeTagCheck::Dynamic)
		fault(m_cache.guard(base, ValueTag::BuiltinFunction, SLJIT_R0), call, m_cache.state());
	const auto id = readTyped(base, ValueTag::BuiltinFunction);
	fault(NativeBlockAbi::emitNonleafBuiltinJump(m_compiler, id.reg), call, m_cache.state());
	// The already loaded builtin word crosses the ABI directly. Keep
	// unrelated guest payloads in the same registers across the host call.
	m_cache.publishRange(base, base + 1 + site.supplied);
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
	emitExit(completed, ir.successors[0]);
}

} // namespace bmsx
