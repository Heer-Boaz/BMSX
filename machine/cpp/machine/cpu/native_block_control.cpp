#include "machine/cpu/native_block_compiler.h"

#include "machine/cpu/execution_image.h"
#include "spec/blua32/cop0.h"

namespace bmsx {

void NativeBlockCompiler::emitControl(const DecodedInstruction& instruction, const NativeBlockExitSite* exit) {
	SlowPath slow; slow.exit = exit; slow.registers = registerSnapshot();
	const int field = instruction.b;
	const bool read = instruction.op == static_cast<u8>(OpCode::MFC0);
	if (!m_controlPrivilegeGuarded || (read && field != COP0_EXEC && cop0FieldImplemented(field))) {
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0,
			SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, cop0Words));
	}
	// Status writes terminate the body; nothing after this guard can change
	// privilege before the next control operation in the same body.
	if (!m_controlPrivilegeGuarded) {
		sljit_emit_op2(m_compiler, SLJIT_AND32, SLJIT_R1, 0,
			SLJIT_MEM1(SLJIT_R0), COP0_STATUS * sizeof(u32), SLJIT_IMM, CPU_STATUS_USER_MODE_CURRENT);
		slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32,
			SLJIT_R1, 0, SLJIT_IMM, 0);
		m_controlPrivilegeGuarded = true;
	}
	if (read) {
		if (!cop0FieldImplemented(field)) {
			slow.jumps[slow.count++] = sljit_emit_jump(m_compiler, SLJIT_JUMP);
		} else {
			if (field == COP0_EXEC) sljit_emit_fset64(m_compiler, SLJIT_FR0, 0.0);
			else {
				sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_R0, 0,
					SLJIT_MEM1(SLJIT_R0), field * sizeof(u32));
				sljit_emit_fop1(m_compiler, SLJIT_CONV_F64_FROM_U32, SLJIT_FR0, 0, SLJIT_R0, 0);
			}
			writeRegister(instruction.a);
		}
	} else if (field != COP0_EXEC) {
		// EXEC converts only after returning, because it replaces the active
		// execution context. Ordinary writes remain in the generated datapath.
		convertWord(instruction.a);
		if (!cop0FieldImplemented(field)) {
			slow.jumps[slow.count++] = sljit_emit_jump(m_compiler, SLJIT_JUMP);
		} else if (field == COP0_STATUS || field == COP0_EPC) {
			sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0,
				SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, cop0Words));
			sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R1), field * sizeof(u32), SLJIT_R0, 0);
		}
	}
	if (slow.count != 0) m_slowPaths.push_back(slow);
}

} // namespace bmsx
