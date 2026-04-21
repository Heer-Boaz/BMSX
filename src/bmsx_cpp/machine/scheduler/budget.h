#pragma once

#include "core/primitives.h"

namespace bmsx {

inline i64 accrueBudgetUnits(i64 cpuHz, i64 unitsPerSec, i64& carry, int cycles) {
	const i64 numerator = unitsPerSec * static_cast<i64>(cycles) + carry;
	const i64 wholeUnits = numerator / cpuHz;
	carry = numerator % cpuHz;
	return wholeUnits;
}

inline i64 cyclesUntilBudgetUnits(i64 cpuHz, i64 unitsPerSec, i64 carry, i64 targetUnits) {
	const i64 needed = targetUnits * cpuHz - carry;
	return needed <= 0 ? 1 : (needed + unitsPerSec - 1) / unitsPerSec;
}

} // namespace bmsx
