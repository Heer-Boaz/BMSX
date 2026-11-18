#include "machine/cpu/native_block_compiler.h"

#include "machine/cpu/cpu.h"
#include "machine/cpu/native_execution.h"

namespace bmsx {

void NativeBlockCompiler::emitBuiltinCall(const DecodedInstruction& instruction) {
	auto& block = *m_blocks[m_current];
	auto& call = block.terminal;
	const int base = instruction.a;
	const int tag = knownTag(base);
	if (!m_bindings.cpu || instruction.b < 1 || instruction.b > 3 || static_cast<u32>(instruction.c) > 2
		|| (tag >= 0 && tag != static_cast<int>(ValueTag::BuiltinFunction))
		|| regionEntryIndex(call.nextPc) == m_blocks.size()) {
		emitExit(call);
		return;
	}

	fault(m_cache.guard(base, ValueTag::BuiltinFunction, SLJIT_R0), call, m_cache.state());
	// Most builtins use the full call owner. Reject their IDs in generated
	// code rather than entering the leaf once here and again at the shared gate.
	static_assert(BUILTIN_FUNCTION_COUNT <= 32);
	constexpr u32 leafIds = (1u << static_cast<u32>(BuiltinFunctionId::SetMetatable))
		| (1u << static_cast<u32>(BuiltinFunctionId::GetMetatable))
		| (1u << static_cast<u32>(BuiltinFunctionId::StringByte))
		| (1u << static_cast<u32>(BuiltinFunctionId::ToInteger));
	const auto id = readTyped(base, ValueTag::BuiltinFunction);
	sljit_emit_op2(m_compiler, SLJIT_LSHR32, SLJIT_R1, 0, SLJIT_IMM, leafIds, id.reg, 0);
	sljit_emit_op2u(m_compiler, SLJIT_AND32 | SLJIT_SET_Z, SLJIT_R1, 0, SLJIT_IMM, 1);
	fault(sljit_emit_jump(m_compiler, SLJIT_ZERO), call, m_cache.state());
	// The nonallocating leaf reads only its callee and arguments. Keep all
	// unrelated guest payloads in the same registers across the host call.
	m_cache.publishRange(base, base + instruction.b);
	m_cache.spillCall(false, 0);
	sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, remainingCycles),
		NativeBlockAbi::budget, 0, SLJIT_IMM, call.cycles);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(m_bindings.cpu));
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0, NativeBlockAbi::state, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(&call));
	sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS3(32, P, P, P), SLJIT_IMM, SLJIT_FUNC_ADDR(&CPU::runNativeBuiltinLeaf));
	m_cache.spillCall(true, 0);
	fault(sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM,
		static_cast<u32>(NativeBuiltinCallOutcome::Declined)), call, m_cache.state());

	if (instruction.c != 1) m_cache.discardRange(base, base + 1);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, NativeBlockAbi::budget, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, remainingCycles));
	auto& completed = block.sideExits.emplace_back(call);
	completed.exit = NativeBlockExit::CompletedCall;
	completed.cycles = completed.registerTop = 0;
	fault(sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM,
		static_cast<u32>(NativeBuiltinCallOutcome::CompletedStop)), completed, m_cache.state(), true);
	emitExit(completed);
}

} // namespace bmsx
