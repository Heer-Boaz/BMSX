import { ScratchBuffer } from '../../../../../machine/ts/common/scratchbuffer';
import { CaseFoldedText } from '../../../../common/search_text';
import { FuzzySymbolScorer } from '../../../../common/fuzzy_symbol_scorer';
import { QuickPickHighlightSet } from '../../../services/quick_input/highlight_set';
import { appendQuickPickHighlights } from '../../../services/quick_input/highlights';
import type { QuickPickHighlight, QuickPickProjection, QuickPickProvider } from '../../../services/quick_input/provider';
import type { SymbolQuickPickItem } from './quick_access';

type SymbolMatch = {
	readonly item: SymbolQuickPickItem;
	readonly itemIndex: number;
	readonly label: CaseFoldedText;
	readonly file: CaseFoldedText | undefined;
	score: number;
	highlightStart: number;
	highlightEnd: number;
};

/** Qualified symbol names, optionally followed by workspace source-path qualifiers. */
export class SymbolQuickPickProvider implements QuickPickProvider<SymbolQuickPickItem> {
	private readonly entries: SymbolMatch[];
	private readonly scorer = new FuzzySymbolScorer();
	private readonly candidate = new QuickPickHighlightSet();
	private readonly projection = { matches: [] as SymbolMatch[], selectionIndex: -1,
		highlights: new ScratchBuffer<QuickPickHighlight>(() => ({ field: 'label', start: 0, end: 0 })) };

	public constructor(public readonly items: readonly SymbolQuickPickItem[], scope: 'file' | 'workspace') {
		this.entries = items.map((item, itemIndex) => ({ item, itemIndex, label: new CaseFoldedText(item.label),
			file: scope === 'workspace' ? new CaseFoldedText(item.description) : undefined,
			score: 0, highlightStart: 0, highlightEnd: 0 }));
	}

	public getPicks(value: string): QuickPickProjection {
		const query = value.trim(), matches = this.projection.matches, highlights = this.projection.highlights;
		matches.length = 0; highlights.clear();
		if (query.length === 0) {
			for (const entry of this.entries) { entry.highlightStart = 0; entry.highlightEnd = 0; matches.push(entry); }
			this.projection.selectionIndex = matches.length === 0 ? -1 : 0;
			return this.projection;
		}
		const terms = query.split(/\s+/), whole = new CaseFoldedText(terms.join(''));
		const pieces = terms.length === 1 ? [whole] : terms.map(term => new CaseFoldedText(term));
		const ranges = this.candidate.ranges;
		for (const entry of this.entries) {
			let score = this.scorer.score(whole, entry.label);
			if (score !== undefined) {
				ranges.clear();
				appendQuickPickHighlights(ranges, entry.item, entry.label, this.scorer.positions);
			} else {
				if (pieces.length === 1 || entry.file === undefined) continue;
				score = this.scorer.score(pieces[0], entry.label);
				if (score === undefined) continue;
				ranges.clear();
				appendQuickPickHighlights(ranges, entry.item, entry.label, this.scorer.positions);
				for (let index = 1; index < pieces.length; index += 1) {
					const part = this.scorer.score(pieces[index], entry.file);
					if (part === undefined) { score = undefined; break; }
					score += part;
					appendQuickPickHighlights(ranges, entry.item, entry.file, this.scorer.positions, entry.item.label.length + 1);
				}
				if (score === undefined) continue;
			}
			entry.score = score;
			entry.highlightStart = highlights.length;
			for (const range of this.candidate.normalize()) {
				const span = highlights.get(highlights.length);
				span.field = range.field; span.start = range.start; span.end = range.end;
			}
			entry.highlightEnd = highlights.length;
			matches.push(entry);
		}
		matches.sort(compareSymbols);
		this.projection.selectionIndex = matches.length === 0 ? -1 : 0;
		return this.projection;
	}
}

function compareSymbols(left: SymbolMatch, right: SymbolMatch): number { return right.score - left.score || left.itemIndex - right.itemIndex; }
