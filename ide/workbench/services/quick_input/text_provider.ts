import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import { CaseFoldedText } from '../../../common/search_text';
import { appendQuickPickSourceRange } from './highlights';
import type { QuickPickHighlight, QuickPickItem, QuickPickMatch, QuickPickProjection, QuickPickProvider } from './provider';

type TextQuickPickMatch = QuickPickMatch & {
	readonly searchText: CaseFoldedText;
	matchIndex: number;
	highlightStart: number;
	highlightEnd: number;
};

/** Literal text choices, explicitly selected by providers rather than imposed by the UI. */
export class TextQuickPickProvider<T extends QuickPickItem> implements QuickPickProvider<T> {
	private readonly entries: TextQuickPickMatch[];
	private readonly tokenStarts: number[] = [];
	private readonly tokenOrder: number[] = [];
	private readonly compareTokenStarts = (left: number, right: number): number => this.tokenStarts[left] - this.tokenStarts[right];
	private readonly projection = { matches: [] as TextQuickPickMatch[], selectionIndex: -1,
		highlights: new ScratchBuffer<QuickPickHighlight>(() => ({ field: 'label', start: 0, end: 0 })) };

	public constructor(public readonly items: readonly T[], private readonly initialItemIndex = 0) {
		this.entries = items.map((item, itemIndex) => ({ item, itemIndex,
			searchText: new CaseFoldedText(`${item.label} ${item.description} ${item.detail}`), matchIndex: 0,
			highlightStart: 0, highlightEnd: 0 }));
	}

	public getPicks(value: string): QuickPickProjection {
		const query = value.trim().toLowerCase();
		const matches = this.projection.matches;
		const highlights = this.projection.highlights, tokenStarts = this.tokenStarts, tokenOrder = this.tokenOrder;
		matches.length = 0;
		highlights.clear();
		if (query.length === 0) {
			for (const entry of this.entries) {
				entry.highlightStart = 0; entry.highlightEnd = 0;
				matches.push(entry);
			}
			this.projection.selectionIndex = matches.length === 0 ? -1 : this.initialItemIndex;
			return this.projection;
		}
		const tokens = query.split(/\s+/);
		tokenOrder.length = tokens.length;
		for (let index = 0; index < tokens.length; index += 1) tokenOrder[index] = index;
		for (const entry of this.entries) {
			const searchKey = entry.searchText.lower;
			let score = searchKey.length;
			for (let token = 0; token < tokens.length; token += 1) {
				const index = searchKey.indexOf(tokens[token]);
				if (index === -1) { score = -1; break; }
				if (index < score) score = index;
				tokenStarts[token] = index;
			}
			if (score !== -1) {
				entry.matchIndex = score;
				entry.highlightStart = highlights.length;
				// Literal matches already are ranges. Materialize only admitted
				// results; never expand every character merely to sort it back.
				if (tokens.length > 1) tokenOrder.sort(this.compareTokenStarts);
				const text = entry.searchText, first = tokenOrder[0];
				let start = text.sourceStart(tokenStarts[first]), end = text.sourceEnd(tokenStarts[first] + tokens[first].length);
				for (let index = 1; index < tokenOrder.length; index += 1) {
					const token = tokenOrder[index];
					const nextStart = text.sourceStart(tokenStarts[token]), nextEnd = text.sourceEnd(tokenStarts[token] + tokens[token].length);
					if (nextStart > end) {
						appendQuickPickSourceRange(highlights, entry.item, start, end);
						start = nextStart; end = nextEnd;
					} else end = Math.max(end, nextEnd);
				}
				appendQuickPickSourceRange(highlights, entry.item, start, end);
				entry.highlightEnd = highlights.length;
				matches.push(entry);
			}
		}
		matches.sort(compareMatches);
		this.projection.selectionIndex = matches.length === 0 ? -1 : 0;
		return this.projection;
	}
}

function compareMatches(left: TextQuickPickMatch, right: TextQuickPickMatch): number {
	return left.matchIndex - right.matchIndex || left.item.label.length - right.item.label.length
		|| left.item.label.localeCompare(right.item.label) || left.itemIndex - right.itemIndex;
}
