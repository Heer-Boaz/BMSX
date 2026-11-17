#include "machine/cpu/native_block_compiler.h"
#include "machine/cpu/execution_image.h"

namespace bmsx {
void NativeBlockCompiler::emitControl(const DecodedInstruction& instruction, NativeBlockExitSite* slow) {
	const bool read = instruction.op == static_cast<u8>(OpCode::MFC0);
	const int field = instruction.b;
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, cop0Words));
	if (!m_controlPrivilegeGuarded) {
		sljit_emit_op2(m_compiler, SLJIT_AND32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R2), COP0_STATUS * sizeof(u32), SLJIT_IMM,
			CPU_STATUS_USER_MODE_CURRENT);
		fault(
			sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0), *slow, m_cache.state());
		m_controlPrivilegeGuarded = true;
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
	if (field == COP0_EXEC || !cop0FieldImplemented(field) ||
		knownTag(instruction.a) != static_cast<int>(ValueTag::Integer)) {
		emitExit(*slow);
		return;
	}
	const auto source = readTyped(instruction.a, ValueTag::Integer);
	if (field == COP0_STATUS || field == COP0_EPC)
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), field * sizeof(u32), source.reg, 0);
}
} // namespace bmsx
