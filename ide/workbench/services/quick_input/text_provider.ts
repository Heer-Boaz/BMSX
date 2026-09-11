import type { QuickPickItem, QuickPickMatch, QuickPickProjection, QuickPickProvider } from './provider';

type TextQuickPickMatch = QuickPickMatch & {
	readonly searchKey: string;
	matchIndex: number;
};

/** Literal text choices, explicitly selected by providers rather than imposed by the UI. */
export class TextQuickPickProvider<T extends QuickPickItem> implements QuickPickProvider<T> {
	private readonly entries: TextQuickPickMatch[];
	private readonly projection = { matches: [] as TextQuickPickMatch[], selectionIndex: -1 };

	public constructor(public readonly items: readonly T[]) {
		this.entries = items.map((item, itemIndex) => ({ item, itemIndex,
			searchKey: `${item.label} ${item.description} ${item.detail}`.toLowerCase(), matchIndex: 0 }));
	}

	public getPicks(value: string): QuickPickProjection {
		const query = value.trim().toLowerCase();
		const tokens = query.length === 0 ? [] : query.split(/\s+/);
		const matches = this.projection.matches;
		matches.length = 0;
		for (const entry of this.entries) {
			let score = entry.searchKey.length;
			for (const token of tokens) {
				const index = entry.searchKey.indexOf(token);
				if (index === -1) { score = -1; break; }
				if (index < score) score = index;
			}
			if (score !== -1) {
				entry.matchIndex = score;
				matches.push(entry);
			}
		}
		if (tokens.length > 0) matches.sort(compareMatches);
		this.projection.selectionIndex = matches.length === 0 ? -1 : 0;
		return this.projection;
	}
}

function compareMatches(left: TextQuickPickMatch, right: TextQuickPickMatch): number {
	return left.matchIndex - right.matchIndex || left.item.label.length - right.item.label.length
		|| left.item.label.localeCompare(right.item.label) || left.itemIndex - right.itemIndex;
}
