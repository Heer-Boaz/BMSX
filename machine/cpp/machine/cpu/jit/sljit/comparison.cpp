#include "machine/cpu/jit/sljit/lowering.h"
#include "machine/cpu/jit/sljit/value_transport.h"
#include "machine/cpu/value_comparison.h"
#include "spec/blua32/instruction_format.h"

namespace bmsx {
void NativeLowering::lowerOperation(const NativeComparison& comparison, const NativeInstruction&) {
	const auto& ir = m_ir[m_current];
	auto& taken = *sideExit(ir.taken);
	auto& terminal = m_blocks[m_current]->terminal;
	const auto op = comparison.operation;
	std::array<sljit_label*, 2> external{};
	const auto outcome = [&](bool skip, EdgePosition position) {
		if (!skip && ir.beforeFusedJump) {
			auto& deferred = *sideExit(ir.beforeFusedJump);
			fault(sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32, NativeBlockAbi::budget, 0, SLJIT_IMM,
					  deferred.cycles),
				deferred, m_cache.state());
		}
		emitExit(skip ? taken : terminal, skip, position, &external[skip]);
	};
	const auto icmp = SLJIT_32 | (op == OpCode::EQ ? SLJIT_EQUAL : op == OpCode::LT ? SLJIT_SIG_LESS : SLJIT_SIG_LESS_EQUAL);
	const auto fcmp = op == OpCode::EQ ? SLJIT_ORDERED_EQUAL : op == OpCode::LT ? SLJIT_ORDERED_LESS : SLJIT_ORDERED_LESS_EQUAL;
	sljit_jump *matched, *integerMatch = nullptr, *integerMiss = nullptr, *typeMiss = nullptr;
	if (const auto* eq = std::get_if<NativeTaggedEquality>(&comparison.strategy)) {
		const int other = eq->knownLeft ? comparison.right : comparison.left;
		emitTag(other, SLJIT_R0);
		if (eq->tag <= ValueTag::True) {
			matched = sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, static_cast<u8>(eq->tag));
		} else {
			typeMiss = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, static_cast<u8>(eq->tag));
			emitPayload(comparison.left, SLJIT_R0);
			emitPayload(comparison.right, SLJIT_R1);
			matched = sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_R1, 0);
		}
	} else switch (std::get<NativeComparisonStrategy>(comparison.strategy)) {
	case NativeComparisonStrategy::Word: {
		const auto word = [&](int selector, sljit_s32 scratch) -> std::pair<sljit_s32, sljit_sw> {
			if (selector < 0) {
				if (const auto constant = nativeImageConstant(m_constants, -1 - selector))
					return {SLJIT_IMM, static_cast<i32>(valuePayload(*constant))};
			}
			return {readTyped(selector, ValueTag::Integer, scratch).reg, 0};
		};
		const auto [lhs, lhsArg] = word(comparison.left, SLJIT_R0);
		const auto [rhs, rhsArg] = word(comparison.right, SLJIT_R1);
		matched = sljit_emit_cmp(m_compiler, icmp, lhs, lhsArg, rhs, rhsArg);
		break;
	}
	case NativeComparisonStrategy::Float: {
		const auto left = readTyped(comparison.left, ValueTag::Float, SLJIT_R0, SLJIT_FR0),
				   right = readTyped(comparison.right, ValueTag::Float, SLJIT_R1, SLJIT_FR1);
		matched = sljit_emit_fcmp(m_compiler, fcmp | SLJIT_32, left.reg, 0, right.reg, 0);
		break;
	}
	case NativeComparisonStrategy::LeftInteger: case NativeComparisonStrategy::RightInteger: {
		auto* c = m_compiler;
		const bool left = std::get<NativeComparisonStrategy>(comparison.strategy) == NativeComparisonStrategy::LeftInteger;
		const auto dynamic = left ? comparison.right : comparison.left;
		emitPayload(left ? comparison.left : comparison.right, SLJIT_R0);
		emitRawLoad(dynamic, SLJIT_R1, SLJIT_R2);
		auto* notInteger = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0,
			SLJIT_IMM, static_cast<u8>(ValueTag::Integer));
		integerMatch = sljit_emit_cmp(c, icmp, left ? SLJIT_R0 : SLJIT_R1, 0, left ? SLJIT_R1 : SLJIT_R0, 0);
		integerMiss = sljit_emit_jump(c, SLJIT_JUMP);
		sljit_set_label(notInteger, sljit_emit_label(c));
		typeMiss = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0,
			SLJIT_IMM, static_cast<u8>(ValueTag::Float));
		// Binary64 represents both the signed word and every binary32 number
		// exactly. Never round an Integer to binary32 to compare it.
		sljit_emit_fop1(c, SLJIT_CONV_F64_FROM_S32, SLJIT_FR0, 0, SLJIT_R0, 0);
		sljit_emit_fcopy(c, SLJIT_COPY32_TO_F32, SLJIT_FR1, SLJIT_R1);
		sljit_emit_fop1(c, SLJIT_CONV_F64_FROM_F32, SLJIT_FR1, 0, SLJIT_FR1, 0);
		matched = sljit_emit_fcmp(c, fcmp, left ? SLJIT_FR0 : SLJIT_FR1, 0, left ? SLJIT_FR1 : SLJIT_FR0, 0);
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
		const auto kernel = op == OpCode::EQ ? &testValueComparison<OpCode::EQ>
			: op == OpCode::LT ? &testValueComparison<OpCode::LT> : &testValueComparison<OpCode::LE>;
		sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS3(32, P, P, P), SLJIT_IMM, SLJIT_FUNC_ADDR(kernel));
		m_cache.spillCall(true, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, NativeBlockAbi::budget, 0, SLJIT_MEM1(NativeBlockAbi::state),
			offsetof(NativeBlockRunState, remainingCycles));
		matched = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0);
		break;
	}
	default: BMSX_UNREACHABLE();
	}
	if (typeMiss) {
		auto* miss = sljit_emit_label(m_compiler);
		if (integerMiss) sljit_set_label(integerMiss, miss);
		sljit_set_label(typeMiss, miss);
	}
	const auto state = m_cache.state();
	outcome(!comparison.skipOnMatch, EdgePosition::BeforeAlternate);
	auto* match = sljit_emit_label(m_compiler);
	sljit_set_label(matched, match);
	if (integerMatch) sljit_set_label(integerMatch, match);
	m_cache.setState(state);
	outcome(comparison.skipOnMatch, EdgePosition::Tail);
}
} // namespace bmsx
