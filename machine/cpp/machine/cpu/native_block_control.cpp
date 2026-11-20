#include "machine/cpu/native_lowering.h"
#include "machine/cpu/execution_image.h"

namespace bmsx {
void NativeLowering::emitControl(const NativeOperands& instruction, NativeBlockExitSite* slow, NativeControlAccess access) {
	const bool read = instruction.op == OpCode::MFC0;
	const int field = instruction.b;
	const bool writesWord = field == COP0_STATUS || field == COP0_EPC;
	const bool integer = !read && knownTag(instruction.a) == static_cast<int>(ValueTag::Integer);
	constexpr auto bank = offsetof(NativeBlockRunState, cop0Words);
	if (access.checkPrivilege || (read && field != COP0_EXEC && cop0FieldImplemented(field)) || (integer && writesWord))
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state), bank);
	if (access.checkPrivilege) {
		sljit_emit_op2(m_compiler, SLJIT_AND32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R2), COP0_STATUS * sizeof(u32), SLJIT_IMM,
			CPU_STATUS_USER_MODE_CURRENT);
		fault(
			sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0), *slow, m_cache.state());
	}
	if (read) {
		if (!cop0FieldImplemented(field)) {
			fault(sljit_emit_jump(m_compiler, SLJIT_JUMP), *slow, m_cache.state());
			return;
		}
		const auto target = m_cache.write(instruction.a, ValueTag::Integer);
		if (field == COP0_EXEC)
			sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, SLJIT_IMM, 0);
		else
			sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, SLJIT_MEM1(SLJIT_R2), field * sizeof(u32));
		return;
	}
	if (field == COP0_EXEC || !cop0FieldImplemented(field)) {
		emitLeave(*slow, Charge::Pending);
		return;
	}
	sljit_s32 word;
	if (integer) {
		if (!writesWord) return;
		word = readTyped(instruction.a, ValueTag::Integer).reg;
	} else {
		// An ignored field still consumes a word operand. On failure the
		// instruction's control exit owns the fault, before any CP0 mutation.
		emitWordOperand(instruction.a, *slow);
		if (!writesWord) return;
		word = SLJIT_R0;
		// The Float conversion can call the numeric leaf and clobber R2.
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state), bank);
	}
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), field * sizeof(u32), word, 0);
}
} // namespace bmsx
