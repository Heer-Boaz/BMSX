export function cyclesUntilBudgetUnits(cpuHz: number, unitsPerSecond: number, carry: number, targetUnits: number): number {
	const needed = targetUnits * cpuHz - carry;
	if (needed <= 0) {
		return 1;
	}
	const numerator = needed + unitsPerSecond - 1;
	return (numerator - (numerator % unitsPerSecond)) / unitsPerSecond;
}
