export type FunctionUsageInfo = {
	readonly totalCounts: ReadonlyMap<string, number>;
	readonly referenceCounts: ReadonlyMap<string, number>;
};

export function incrementUsageCount(counts: Map<string, number>, name: string | null | undefined): void {
	if (!name || name.length === 0) {
		return;
	}
	counts.set(name, (counts.get(name) ?? 0) + 1);
}
