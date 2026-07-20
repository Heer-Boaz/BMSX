export type BudgetAccrual = {
	wholeUnits: number;
	carry: number;
};

export function accrueBudgetUnits(out: BudgetAccrual, cpuHz: number, unitsPerSec: number, carry: number, cycles: number): void {
	const numerator = unitsPerSec * cycles + carry;
	out.wholeUnits = Math.trunc(numerator / cpuHz);
	out.carry = numerator % cpuHz;
}

export function cyclesUntilBudgetUnits(cpuHz: number, unitsPerSec: number, carry: number, targetUnits: number): number {
	const needed = targetUnits * cpuHz - carry;
	if (needed <= 0) {
		return 1;
	}
	const numerator = needed + unitsPerSec - 1;
	return (numerator - (numerator % unitsPerSec)) / unitsPerSec;
}

// Same cycles-for-N-units math as cyclesUntilBudgetUnits, but without its
// "at least one cycle" scheduling floor. That floor exists so a single
// service deadline never stalls at the current cycle; applied once per
// admitted batch it's harmless, but summing per-unit deltas of this
// function lets a caller recover an exact, non-negative per-unit cost
// breakdown that still telescopes to the same batch total as one bulk
// cyclesUntilBudgetUnits(..., N) call -- which repeated single-unit calls to
// cyclesUntilBudgetUnits do NOT do, since each call's floor is paid
// separately instead of once for the batch.
export function cyclesForBudgetUnitsNoFloor(cpuHz: number, unitsPerSec: number, carry: number, targetUnits: number): number {
	const needed = targetUnits * cpuHz - carry;
	if (needed <= 0) {
		return 0;
	}
	const numerator = needed + unitsPerSec - 1;
	return (numerator - (numerator % unitsPerSec)) / unitsPerSec;
}
