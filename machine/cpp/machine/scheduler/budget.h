#pragma once

#include "common/primitives.h"

namespace bmsx {

struct BudgetAccrual {
	i64 wholeUnits = 0;
	i64 carry = 0;
};

inline void accrueBudgetUnits(BudgetAccrual& out, i64 cpuHz, i64 unitsPerSec, i64 carry, int cycles) {
	const i64 numerator = unitsPerSec * static_cast<i64>(cycles) + carry;
	out.wholeUnits = numerator / cpuHz;
	out.carry = numerator % cpuHz;
}

inline i64 cyclesUntilBudgetUnits(i64 cpuHz, i64 unitsPerSec, i64 carry, i64 targetUnits) {
	const i64 needed = targetUnits * cpuHz - carry;
	return needed <= 0 ? 1 : (needed + unitsPerSec - 1) / unitsPerSec;
}

} // namespace bmsx
