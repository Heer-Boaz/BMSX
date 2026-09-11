import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import { CaseFoldedText } from '../../../common/search_text';
import { WordMatcher } from '../../../common/word_matcher';
import type { EditorCommandId } from '../../../common/commands';
import type { QuickPickHighlight, QuickPickItem, QuickPickProjection, QuickPickProvider } from '../../services/quick_input/provider';
import { appendQuickPickHighlights } from '../../services/quick_input/highlights';

export type CommandQuickPickItem = QuickPickItem & { readonly command: EditorCommandId };
const enum CommandMatchKind { Exact, Substring, Words }
type CommandMatch = { readonly itemIndex: number; readonly item: CommandQuickPickItem;
	readonly label: CaseFoldedText; readonly commandId: string; kind: CommandMatchKind;
	highlightStart: number; highlightEnd: number };

/** Command labels/ids, not paths or keyboard-binding text. Catalog order stays provider-owned. */
export class CommandQuickPickProvider implements QuickPickProvider<CommandQuickPickItem> {
	private readonly entries: CommandMatch[];
	private readonly matcher = new WordMatcher();
	private readonly projection = { matches: [] as CommandMatch[], selectionIndex: -1,
		highlights: new ScratchBuffer<QuickPickHighlight>(() => ({ field: 'label', start: 0, end: 0 })) };

	public constructor(public readonly items: readonly CommandQuickPickItem[]) {
		this.entries = items.map((item, itemIndex) => ({ itemIndex, item,
			label: new CaseFoldedText(item.label), commandId: item.command.toLowerCase(), kind: CommandMatchKind.Exact,
			highlightStart: 0, highlightEnd: 0 }));
	}

	public getPicks(value: string): QuickPickProjection {
		const query = value.trim().toLowerCase(), matches = this.projection.matches;
		const highlights = this.projection.highlights;
		matches.length = 0;
		highlights.clear();
		for (const entry of this.entries) {
			entry.highlightStart = highlights.length;
			const label = entry.label.lower;
			const labelIndex = label.indexOf(query);
			if (query.length === 0 || label === query || entry.commandId === query) entry.kind = CommandMatchKind.Exact;
			else if (labelIndex !== -1) entry.kind = CommandMatchKind.Substring;
			else if (this.matcher.test(query, label)) entry.kind = CommandMatchKind.Words;
			else continue;
			if (entry.kind === CommandMatchKind.Words) appendQuickPickHighlights(highlights, entry.item, entry.label, this.matcher.positions);
			else if (query.length > 0 && labelIndex !== -1) {
				const range = highlights.get(highlights.length);
				range.field = 'label'; range.start = entry.label.sourceStart(labelIndex); range.end = entry.label.sourceEnd(labelIndex + query.length);
			}
			entry.highlightEnd = highlights.length;
			matches.push(entry);
		}
		if (query.length > 0) matches.sort(compareMatches);
		this.projection.selectionIndex = matches.length === 0 ? -1 : 0;
		return this.projection;
	}
}

function compareMatches(left: CommandMatch, right: CommandMatch): number {
	return left.kind - right.kind || left.itemIndex - right.itemIndex;
}
