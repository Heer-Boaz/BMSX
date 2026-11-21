#include "machine/cpu/native_lowering.h"

#include "machine/cpu/cpu.h"
#include "machine/cpu/native_value_emit.h"

namespace bmsx {

void NativeLowering::lowerOperation(const NativeLength& length, const NativeInstruction& instruction) {
	auto& invalid = *instruction.slow;
	constexpr auto value = NativeBlockAbi::helperResultOffset;
	emitRawLoad(length.source, SLJIT_R0, SLJIT_R1);
	emitValueTransportStore(m_compiler, SLJIT_SP, value, SLJIT_R0, SLJIT_R1);
	const auto state = m_cache.state();
	m_cache.spillCall(false, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, remainingCycles), NativeBlockAbi::budget, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, NativeBlockAbi::state, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(m_bindings.strings));
	sljit_get_local_base(m_compiler, SLJIT_R2, 0, value);
	sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS3(32, P, P, P), SLJIT_IMM, SLJIT_FUNC_ADDR(&CPU::readNativeLength));
	m_cache.spillCall(true, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, NativeBlockAbi::budget, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, remainingCycles));
	fault(sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0), invalid, state);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), value + VALUE_LOW_WORD_BYTE_OFFSET);
	const auto target = m_cache.write(length.result, ValueTag::Integer);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, SLJIT_R0, 0);
}

} // namespace bmsx
