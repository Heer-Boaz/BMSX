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
