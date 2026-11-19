#include "machine/cpu/native_block_compiler.h"
#include "machine/cpu/native_value_emit.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/string_pool.h"

namespace bmsx {
namespace {
template <OpCode op> u32 compareKernel(const Value* args, const StringPool* strings, int* budget) {
	const Value a = args[0], b = args[1];
	if constexpr (op == OpCode::EQ)
		return valuesEqual(a, b);
	if (valueIsNumber(a) && valueIsNumber(b)) {
		const auto order = compareNumbers(a, b);
		return op == OpCode::LT ? order == NumericOrder::Less : static_cast<int>(order) <= 0;
	}
	if (valueIsString(a) && valueIsString(b)) {
		const int order = compareStringIds(strings, asStringId(a), asStringId(b), budget);
		return op == OpCode::LT ? order < 0 : order <= 0;
	}
	return 0;
}
} // namespace
void NativeBlockCompiler::emitComparison(const DecodedInstruction& instruction, NativeBlockExitSite& taken) {
	const auto op = static_cast<OpCode>(instruction.op);
	const int a = knownTag(instruction.b), b = knownTag(instruction.c);
	sljit_jump* matched;
	if (a == static_cast<int>(ValueTag::Integer) && b == a) {
		const auto left = readTyped(instruction.b, ValueTag::Integer, SLJIT_R0),
				   right = readTyped(instruction.c, ValueTag::Integer, SLJIT_R1);
		matched = sljit_emit_cmp(m_compiler,
			(op == OpCode::EQ	   ? SLJIT_EQUAL
				: op == OpCode::LT ? SLJIT_SIG_LESS
								   : SLJIT_SIG_LESS_EQUAL) |
				SLJIT_32,
			left.reg, 0, right.reg, 0);
	} else if (a == static_cast<int>(ValueTag::Float) && b == a) {
		const auto left = readTyped(instruction.b, ValueTag::Float, SLJIT_R0, SLJIT_FR0),
				   right = readTyped(instruction.c, ValueTag::Float, SLJIT_R1, SLJIT_FR1);
		matched = sljit_emit_fcmp(m_compiler,
			(op == OpCode::EQ	   ? SLJIT_ORDERED_EQUAL
				: op == OpCode::LT ? SLJIT_ORDERED_LESS
								   : SLJIT_ORDERED_LESS_EQUAL) |
				SLJIT_32,
			left.reg, 0, right.reg, 0);
	} else {
		constexpr auto args = NativeBlockAbi::helperResultOffset;
		emitRawLoad(instruction.b, SLJIT_R0, SLJIT_R1);
		emitValueTransportStore(m_compiler, SLJIT_SP, args, SLJIT_R0, SLJIT_R1);
		emitRawLoad(instruction.c, SLJIT_R0, SLJIT_R1);
		emitValueTransportStore(m_compiler, SLJIT_SP, args + sizeof(Value), SLJIT_R0, SLJIT_R1);
		m_cache.spillCall(false, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(NativeBlockAbi::state),
			offsetof(NativeBlockRunState, remainingCycles), NativeBlockAbi::budget, 0);
		sljit_get_local_base(m_compiler, SLJIT_R0, 0, args);
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(m_bindings.strings));
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R2, 0, NativeBlockAbi::state, 0, SLJIT_IMM,
			offsetof(NativeBlockRunState, remainingCycles));
		const auto kernel = op == OpCode::EQ   ? &compareKernel<OpCode::EQ>
							: op == OpCode::LT ? &compareKernel<OpCode::LT>
											   : &compareKernel<OpCode::LE>;
		sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS3(32, P, P, P), SLJIT_IMM, SLJIT_FUNC_ADDR(kernel));
		m_cache.spillCall(true, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, NativeBlockAbi::budget, 0, SLJIT_MEM1(NativeBlockAbi::state),
			offsetof(NativeBlockRunState, remainingCycles));
		matched = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0);
	}
	const auto state = m_cache.state();
	const auto outcome = [&](NativeBlockExitSite& exit) {
		if (m_blocks[m_current]->hasFusedJump && &exit == &m_blocks[m_current]->terminal) {
			auto& deferred = m_blocks[m_current]->sideExits[m_blocks[m_current]->sideExits.size() - 2];
			fault(sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32, NativeBlockAbi::budget, 0, SLJIT_IMM,
					  deferred.cycles),
				deferred, m_cache.state());
		}
		emitExit(exit);
	};
	outcome(instruction.a != 0 ? taken : m_blocks[m_current]->terminal);
	sljit_set_label(matched, sljit_emit_label(m_compiler));
	m_cache.setState(state);
	outcome(instruction.a != 0 ? m_blocks[m_current]->terminal : taken);
}
} // namespace bmsx
