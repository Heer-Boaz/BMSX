#include "machine/cpu/native_block_compiler.h"

#include "machine/cpu/cpu.h"
#include "machine/cpu/native_execution.h"

namespace bmsx {

void NativeBlockCompiler::emitBuiltinCall(const DecodedInstruction& instruction) {
	if (!m_bindings.cpu || instruction.b < 1 || instruction.b > 3
		|| static_cast<u32>(instruction.c) > 2u) return;
	auto& exit = m_block->terminal;
	const size_t targetIndex = regionEntryIndex(exit.nextPc);
	if (targetIndex == m_blocks.size() || m_entries[targetIndex].inherited) return;
	const int scratch = NativeBlockAbi::helperResultOffset;
	// Non-leaf calls leave before argument capture or cache admission. The
	// early guard map and the later semantic-decline map name distinct CALL
	// descriptors because loading arguments can evict dirty cache bindings.
	auto& guardedCall = m_block->sideExits.emplace_back(exit);
	SlowPath guarded; guarded.exit = &guardedCall; guarded.registers = registerSnapshot();
	loadHeader(instruction.a, SLJIT_R0);
	guarded.jumps[guarded.count++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R0, 0,
		SLJIT_IMM, valueFromTag(ValueTag::BuiltinFunction) >> 48u);
	loadPayload(instruction.a, SLJIT_R3, SLJIT_R2);
	sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R0, 0,
		SLJIT_MEM1(SLJIT_R3), offsetof(BuiltinFunction, id));
	auto* setMetatable = sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0,
		SLJIT_IMM, static_cast<u32>(BuiltinFunctionId::SetMetatable));
	auto* getMetatable = sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0,
		SLJIT_IMM, static_cast<u32>(BuiltinFunctionId::GetMetatable));
	guarded.jumps[guarded.count++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R0, 0,
		SLJIT_IMM, static_cast<u32>(BuiltinFunctionId::StringByte));
	m_slowPaths.push_back(guarded);
	auto* supported = sljit_emit_label(m_compiler);
	sljit_set_label(setMetatable, supported); sljit_set_label(getMetatable, supported);
	for (int index = 0; index < 2; ++index) {
		if (index + 1 < instruction.b) loadOperand(static_cast<int>(instruction.a) + 1 + index, SLJIT_FR0);
		else sljit_emit_fset64(m_compiler, SLJIT_FR0, asNumber(valueNil()));
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_SP),
			scratch + offsetof(NativeBuiltinCallState, arguments) + index * sizeof(Value), SLJIT_FR0, 0);
	}
	SlowPath slow; slow.exit = &exit; slow.registers = registerSnapshot();

	sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_R0, 0, SLJIT_S4, 0, SLJIT_IMM, exit.cycles);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP),
		scratch + offsetof(NativeBuiltinCallState, remainingCycles), SLJIT_R0, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_S5, 0);
	if (exit.registerTop != 0) {
		auto* retained = sljit_emit_cmp(m_compiler, SLJIT_SIG_GREATER_EQUAL | SLJIT_32,
			SLJIT_R0, 0, SLJIT_IMM, exit.registerTop);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM, exit.registerTop);
		sljit_set_label(retained, sljit_emit_label(m_compiler));
	}
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP),
		scratch + offsetof(NativeBuiltinCallState, registerTop), SLJIT_R0, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(m_bindings.cpu));
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(&exit));
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R2, 0, SLJIT_SP, 0, SLJIT_IMM, scratch);
	emitCallSpills(false);
	sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS4(32, P, P, P, P), SLJIT_IMM,
		SLJIT_FUNC_ADDR(&CPU::runNativeBuiltinLeaf));
	emitCallSpills(true);
	slow.jumps[slow.count++] = sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0,
		SLJIT_IMM, static_cast<u32>(NativeBuiltinCallOutcome::Declined));
	m_slowPaths.push_back(slow);

	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_S4, 0, SLJIT_MEM1(SLJIT_SP),
		scratch + offsetof(NativeBuiltinCallState, remainingCycles));
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_S5, 0, SLJIT_MEM1(SLJIT_SP),
		scratch + offsetof(NativeBuiltinCallState, registerTop));
	if (instruction.c != 1) {
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_FR0, 0, SLJIT_MEM1(SLJIT_SP),
			scratch + offsetof(NativeBuiltinCallState, arguments));
		writeRegister(instruction.a);
	}
	// prepare() reserved both additional descriptors before any side-exit
	// address was emitted. CALL has completed; no stop may replay its effect.
	auto& completed = m_block->sideExits.emplace_back(exit);
	completed.exit = NativeBlockExit::CompletedCall;
	completed.cycles = completed.registerTop = 0;
	const auto& target = m_entries[targetIndex];
	emitRegisterTransfer(m_registers, target.registers, completed);
	m_registers = target.registers;
	setExitRegisterMap(completed, registerSnapshot());
	// Transfers use only FPRs and memory. Keep the helper's outcome in R1
	// while naming the already-charged completion for every deadline exit.
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_R0, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(&completed));
	m_shortGrants.push_back(sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R1, 0,
		SLJIT_IMM, static_cast<u32>(NativeBuiltinCallOutcome::CompletedStop)));
	m_internalBranches.push_back({sljit_emit_jump(m_compiler, SLJIT_JUMP), targetIndex, &completed, m_registers, false});
	m_hasTerminal = true;
}

} // namespace bmsx
