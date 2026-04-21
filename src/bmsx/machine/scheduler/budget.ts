const MAX_SAFE_CYCLES = BigInt(Number.MAX_SAFE_INTEGER);

export function cyclesUntilBudgetUnits(cpuHz: bigint, unitsPerSecond: bigint, carry: bigint, targetUnits: number): number {
	const needed = BigInt(targetUnits) * cpuHz - carry;
	if (needed <= 0n) {
		return 1;
	}
	const cycles = (needed + unitsPerSecond - 1n) / unitsPerSecond;
	return Number(cycles > MAX_SAFE_CYCLES ? MAX_SAFE_CYCLES : cycles);
}
