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

export function printQualityLedger(ledger: QualityLedger): void {
	const entries = qualityLedgerEntries(ledger);
	if (entries.length === 0) {
		return;
	}
	console.log('Quality exception ledger:');
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		console.log(`  ${entry.name}: ${entry.count}`);
	}
	console.log('');
}
