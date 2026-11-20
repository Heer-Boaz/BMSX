#include "machine/cpu/native_lowering.h"

#include "machine/cpu/cpu.h"
#include "machine/cpu/native_execution.h"

namespace bmsx {

sljit_jump* NativeBlockAbi::emitNonleafBuiltinJump(sljit_compiler* compiler, sljit_s32 id) {
	static_assert(BUILTIN_FUNCTION_COUNT <= 32);
	constexpr u32 leafIds = (1u << static_cast<u32>(BuiltinFunctionId::SetMetatable))
		| (1u << static_cast<u32>(BuiltinFunctionId::GetMetatable))
		| (1u << static_cast<u32>(BuiltinFunctionId::StringByte))
		| (1u << static_cast<u32>(BuiltinFunctionId::ToInteger));
	sljit_emit_op2(compiler, SLJIT_LSHR32, SLJIT_R1, 0, SLJIT_IMM, leafIds, id, 0);
	sljit_emit_op2u(compiler, SLJIT_AND32 | SLJIT_SET_Z, SLJIT_R1, 0, SLJIT_IMM, 1);
	return sljit_emit_jump(compiler, SLJIT_ZERO);
}

void NativeLowering::emitBuiltinCall(const NativeOperands& instruction) {
	auto& block = *m_blocks[m_current];
	auto& call = block.terminal;
	const auto& ir = m_ir[m_current];
	const int base = instruction.a;
	const int tag = knownTag(base);
	if (!ir.completedCall || ir.successors[0] == m_ir.size()
		|| (tag >= 0 && tag != static_cast<int>(ValueTag::BuiltinFunction))) {
		emitLeave(call, Charge::Pending);
		return;
	}

	fault(m_cache.guard(base, ValueTag::BuiltinFunction, SLJIT_R0), call, m_cache.state());
	const auto id = readTyped(base, ValueTag::BuiltinFunction);
	fault(NativeBlockAbi::emitNonleafBuiltinJump(m_compiler, id.reg), call, m_cache.state());
	// The already loaded builtin word crosses the ABI directly. Keep
	// unrelated guest payloads in the same registers across the host call.
	m_cache.publishRange(base, base + instruction.b);
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

	if (instruction.c != 1) m_cache.discardRange(base, base + 1);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, NativeBlockAbi::budget, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, remainingCycles));
	auto& completed = *ir.completedCall;
	fault(sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM,
		static_cast<u32>(NativeBuiltinCallOutcome::CompletedStop)), completed, m_cache.state(), Charge::Paid);
	emitExit(completed, ir.successors[0]);
}

} // namespace bmsx
