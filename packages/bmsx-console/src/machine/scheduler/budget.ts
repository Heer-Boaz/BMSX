export type BudgetAccrual = {
	wholeUnits: number;
	carry: number;
};

export function accrueBudgetUnits(out: BudgetAccrual, cpuHz: number, unitsPerSecond: number, carry: number, cycles: number): void {
	const numerator = unitsPerSecond * cycles + carry;
	const nextCarry = numerator % cpuHz;
	out.wholeUnits = (numerator - nextCarry) / cpuHz;
	out.carry = nextCarry;
}

export function cyclesUntilBudgetUnits(cpuHz: number, unitsPerSecond: number, carry: number, targetUnits: number): number {
	const needed = targetUnits * cpuHz - carry;
	if (needed <= 0) {
		return 1;
	}
	const numerator = needed + unitsPerSecond - 1;
	return (numerator - (numerator % unitsPerSecond)) / unitsPerSecond;
}
