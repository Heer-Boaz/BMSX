#include "machine/cpu/native_lowering.h"
#include "machine/cpu/native_value_emit.h"
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
void NativeLowering::lowerOperation(const NativeComparison& comparison, const NativeInstruction&) {
	auto& taken = *sideExit(m_ir[m_current].taken);
	const auto op = comparison.operation;
	sljit_jump* matched;
	switch (comparison.strategy) {
	case NativeComparisonStrategy::Word: {
		const auto left = readTyped(comparison.left, ValueTag::Integer, SLJIT_R0),
				   right = readTyped(comparison.right, ValueTag::Integer, SLJIT_R1);
		matched = sljit_emit_cmp(m_compiler,
			(op == OpCode::EQ	   ? SLJIT_EQUAL
				: op == OpCode::LT ? SLJIT_SIG_LESS
								   : SLJIT_SIG_LESS_EQUAL) |
				SLJIT_32,
			left.reg, 0, right.reg, 0);
		break;
	}
	case NativeComparisonStrategy::Float: {
		const auto left = readTyped(comparison.left, ValueTag::Float, SLJIT_R0, SLJIT_FR0),
				   right = readTyped(comparison.right, ValueTag::Float, SLJIT_R1, SLJIT_FR1);
		matched = sljit_emit_fcmp(m_compiler,
			(op == OpCode::EQ	   ? SLJIT_ORDERED_EQUAL
				: op == OpCode::LT ? SLJIT_ORDERED_LESS
								   : SLJIT_ORDERED_LESS_EQUAL) |
				SLJIT_32,
			left.reg, 0, right.reg, 0);
		break;
	}
	case NativeComparisonStrategy::Kernel: {
		constexpr auto args = NativeBlockAbi::helperResultOffset;
		emitRawLoad(comparison.left, SLJIT_R0, SLJIT_R1);
		emitValueTransportStore(m_compiler, SLJIT_SP, args, SLJIT_R0, SLJIT_R1);
		emitRawLoad(comparison.right, SLJIT_R0, SLJIT_R1);
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
		break;
	}
	default: BMSX_UNREACHABLE();
	}
	const auto state = m_cache.state();
	const auto& ir = m_ir[m_current];
	auto& terminal = m_blocks[m_current]->terminal;
	const auto outcome = [&](bool skip) {
		if (!skip && ir.beforeFusedJump) {
			auto& deferred = *sideExit(ir.beforeFusedJump);
			fault(sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32, NativeBlockAbi::budget, 0, SLJIT_IMM,
					  deferred.cycles),
				deferred, m_cache.state());
		}
		emitExit(skip ? taken : terminal, ir.successors[skip ? 1 : 0]);
	};
	outcome(!comparison.skipOnMatch);
	sljit_set_label(matched, sljit_emit_label(m_compiler));
	m_cache.setState(state);
	outcome(comparison.skipOnMatch);
}
} // namespace bmsx
