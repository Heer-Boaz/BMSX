#include "machine/cpu/native_lowering.h"

#include "spec/blua32/cop0.h"

namespace bmsx {

void NativeLowering::lowerOperation(const NativeControlAccess& access, const NativeInstruction& instruction) {
	auto* slow = instruction.slow;
	// Operations requiring the CPU's control path already carry a precise
	// exit. That path owns admission and conversion, in that order.
	if (access.mode == NativeControlMode::ReadFault || access.mode == NativeControlMode::WriteSemantic) {
		emitLeave(*slow, Charge::Pending);
		return;
	}

	const bool readsWord = access.mode == NativeControlMode::ReadWord;
	const bool readsZero = access.mode == NativeControlMode::ReadZero;
	const bool writesWord = access.mode == NativeControlMode::WriteWord;
	const bool integer = !readsWord && !readsZero && knownTag(access.slot) == static_cast<int>(ValueTag::Integer);
	constexpr auto bank = offsetof(NativeBlockRunState, cop0Words);
	if (access.checkPrivilege || readsWord || (integer && writesWord))
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state), bank);
	if (access.checkPrivilege) {
		sljit_emit_op2(m_compiler, SLJIT_AND32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R2), COP0_STATUS * sizeof(u32), SLJIT_IMM,
			CPU_STATUS_USER_MODE_CURRENT);
		fault(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0), *slow, m_cache.state());
	}

	const sljit_sw offset = access.field * sizeof(u32);
	if (readsWord || readsZero) {
		const auto target = m_cache.write(access.slot, ValueTag::Integer);
		if (readsZero)
			sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, SLJIT_IMM, 0);
		else
			sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, SLJIT_MEM1(SLJIT_R2), offset);
		return;
	}

	sljit_s32 word;
	if (integer) {
		if (!writesWord) return;
		word = readTyped(access.slot, ValueTag::Integer).reg;
	} else {
		// Ignored writes still consume the word operand. A failed conversion
		// uses the semantic exit before any CP0 mutation.
		emitWordOperand(access.slot, *slow);
		if (!writesWord) return;
		word = SLJIT_R0;
		// Conversion can call the numeric leaf and clobber R2.
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state), bank);
	}
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), offset, word, 0);
}

} // namespace bmsx
