export type QualityLedger = {
	counters: Map<string, number>;
};

export type QualityLedgerEntry = {
	name: string;
	count: number;
};

export function createQualityLedger(): QualityLedger {
	return { counters: new Map<string, number>() };
}

export function noteQualityLedger(ledger: QualityLedger, name: string, count = 1): void {
	if (count <= 0) {
		return;
	}
	ledger.counters.set(name, (ledger.counters.get(name) ?? 0) + count);
}

export function qualityLedgerEntries(ledger: QualityLedger): QualityLedgerEntry[] {
	return Array.from(ledger.counters.entries())
		.map(([name, count]) => ({ name, count }))
		.sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}
