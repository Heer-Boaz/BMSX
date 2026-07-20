#pragma once

#include "common/primitives.h"

namespace bmsx {

struct BudgetAccrual {
	i64 wholeUnits = 0;
	i64 carry = 0;
};

inline void accrueBudgetUnits(BudgetAccrual& out, i64 cpuHz, i64 unitsPerSec, i64 carry, i64 cycles) {
	const i64 numerator = unitsPerSec * cycles + carry;
	out.wholeUnits = numerator / cpuHz;
	out.carry = numerator % cpuHz;
}

inline i64 cyclesUntilBudgetUnits(i64 cpuHz, i64 unitsPerSec, i64 carry, i64 targetUnits) {
	const i64 needed = targetUnits * cpuHz - carry;
	return needed <= 0 ? 1 : (needed + unitsPerSec - 1) / unitsPerSec;
}

// Same cycles-for-N-units math as cyclesUntilBudgetUnits, but without its
// "at least one cycle" scheduling floor. That floor exists so a single
// service deadline never stalls at the current cycle; applied once per
// admitted batch it's harmless, but summing per-unit deltas of this
// function lets a caller recover an exact, non-negative per-unit cost
// breakdown that still telescopes to the same batch total as one bulk
// cyclesUntilBudgetUnits(..., N) call — which repeated single-unit calls to
// cyclesUntilBudgetUnits do NOT do, since each call's floor is paid
// separately instead of once for the batch.
inline i64 cyclesForBudgetUnitsNoFloor(i64 cpuHz, i64 unitsPerSec, i64 carry, i64 targetUnits) {
	const i64 needed = targetUnits * cpuHz - carry;
	return needed <= 0 ? 0 : (needed + unitsPerSec - 1) / unitsPerSec;
}

} // namespace bmsx
