#pragma once

#include "machine/cpu/jit/ir/region.h"

namespace bmsx {
struct NativeWordConstraints {
	unsigned fixed;
	std::array<u8, 4> freeUntil;
};

// Fixed operands and clobbers of the inline sequences, in SLJIT R0..R3
// order. Calls and unmigrated sequences keep their full ABI scratch set.
inline unsigned fixedWordUses(const auto&) { return 0xf; }
inline unsigned fixedWordUses(const NativeLiteral& op) {
	return valueTag(op.value) == ValueTag::Float ? 1 : 0;
}
inline unsigned fixedWordUses(const NativeMove& op) {
	return op.conversion == ValueMoveKind::Copy && !op.copyTag ? 3 : 1;
}
inline unsigned fixedWordUses(const NativeComparison& op) {
	// Inline compares and their two local transfers use R0..R2. Only the
	// generic C helper owns the full argument/clobber bank.
	const auto* strategy = std::get_if<NativeComparisonStrategy>(&op.strategy);
	return strategy && *strategy == NativeComparisonStrategy::Kernel ? 0xf : 0x7;
}
inline unsigned fixedWordUses(const NativeGlobalAccess& op) {
	return op.access == NativeAccess::Read ? 0 : 0xf;
}
inline unsigned fixedWordUses(const NativeArithmetic& op) {
	const auto& plan = std::get<NativeNumericPlan>(op.strategy);
	if (plan.action == NativeNumericAction::Float) return 1;
	if (plan.action != NativeNumericAction::Word) return 0xf;
	return unsigned(plan.guardLeft || plan.guardRight || op.left < 0)
		| ((!op.unary() && op.right < 0) ? 2u : 0u);
}

// Distance to the next fixed use, including this instruction. Implicit block exits
// reserve the bank; explicit transfers have their own fixed operands.
inline void planWordConstraints(std::span<const NativeInstruction> rows, std::span<NativeWordConstraints> result) {
	std::array<u8, 4> distance{};
	for (size_t i = rows.size(); i-- > 0;) {
		unsigned fixed = std::visit([](const auto& op) { return fixedWordUses(op); }, rows[i].operation);
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
		if (static_cast<size_t>(rows[i].attempt) != 0) fixed |= 1; // Counter increment uses R0.
#endif
		for (unsigned r = 0; r < distance.size(); ++r)
			distance[r] = fixed & (1u << r) ? 0 : distance[r] + 1;
		result[i] = {fixed, distance};
	}
}
} // namespace bmsx
