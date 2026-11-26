#pragma once

#include <algorithm>

#include "machine/cpu/string_pool.h"
#include "machine/cpu/value.h"
#include "spec/blua32/opcode.h"

namespace bmsx {

inline constexpr u32 LONG_STRING_COMPARISON = 2;

// The interpreter and generated generic paths use the same predicate and
// String work charge. The native ABI passes two consecutive Values and
// returns false, true, or LONG_STRING_COMPARISON without a byte charge.
// Only the CPU can latch and resume an unfinished comparison.
template <OpCode op>
inline u32 testValueComparison(const Value (&operands)[2], const StringPool& strings, int& remainingCycles) {
	static_assert(op == OpCode::EQ || op == OpCode::LT || op == OpCode::LE);
	const auto [left, right] = operands;
	if constexpr (op == OpCode::EQ) {
		return valuesEqual(left, right);
	} else {
		if (valueIsNumber(left) && valueIsNumber(right)) {
			const auto order = compareNumbers(left, right);
			return op == OpCode::LT ? order == NumericOrder::Less : static_cast<int>(order) <= 0;
		}
		if (valueIsString(left) && valueIsString(right)) {
			const StringId a = asStringId(left), b = asStringId(right);
			const int an = strings.byteLength(a), bn = strings.byteLength(b), shared = std::min(an, bn);
			if (shared > INLINE_STRING_COMPARE_BYTES) return LONG_STRING_COMPARISON;
			remainingCycles -= shared;
			const int order = strings.compareBytes(a, b, 0, shared);
			if (order == 0) return op == OpCode::LT ? an < bn : an <= bn;
			return order < 0;
		}
		return false;
	}
}

} // namespace bmsx
