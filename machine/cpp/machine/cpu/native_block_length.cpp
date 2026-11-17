#include "machine/cpu/native_block_compiler.h"
#include "machine/cpu/native_value_emit.h"
#include "machine/cpu/execution_image.h"

namespace bmsx {
namespace {
u32 lengthKernel(NativeBlockRunState* state, const StringPool* strings, const GcHeap* heap, Value* value) noexcept {
	if (valueIsString(*value)) {
		*value = valueInteger(static_cast<i32>(strings->codepointCount(asStringId(*value))));
		return 1;
	}
	if (valueIsTable(*value)) {
		u32 probes;
		const auto boundary = Table::length(asTable(*value, *heap), &probes);
		state->remainingCycles -= static_cast<int>(probes) * TABLE_LENGTH_PROBE_CYCLES;
		*value = valueInteger(boundary);
		return 1;
	}
	return 0;
}
} // namespace
void NativeBlockCompiler::emitLength(const DecodedInstruction& instruction, NativeBlockExitSite& invalid) {
	constexpr auto value = NativeBlockAbi::helperResultOffset;
	emitRawLoad(instruction.b, SLJIT_R0, SLJIT_R1);
	emitValueTransportStore(m_compiler, SLJIT_SP, value, SLJIT_R0, SLJIT_R1);
	const auto state = m_cache.state();
	m_cache.spillCall(false, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, remainingCycles), NativeBlockAbi::budget, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, NativeBlockAbi::state, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(m_bindings.strings));
	sljit_emit_op1(
		m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, heap));
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R3, 0, SLJIT_SP, 0, SLJIT_IMM, value);
	sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS4(32, P, P, P, P), SLJIT_IMM, SLJIT_FUNC_ADDR(lengthKernel));
	m_cache.spillCall(true, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, NativeBlockAbi::budget, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, remainingCycles));
	fault(sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0), invalid, state);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), value + VALUE_LOW_WORD_BYTE_OFFSET);
	const auto target = m_cache.write(instruction.a, ValueTag::Integer);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, SLJIT_R0, 0);
}
} // namespace bmsx
