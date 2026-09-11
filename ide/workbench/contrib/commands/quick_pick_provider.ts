import { WordMatcher } from '../../../common/word_matcher';
import type { EditorCommandId } from '../../../common/commands';
import type { QuickPickItem, QuickPickProjection, QuickPickProvider } from '../../services/quick_input/provider';

export type CommandQuickPickItem = QuickPickItem & { readonly command: EditorCommandId };
const enum CommandMatchKind { Exact, Substring, Words }
type CommandMatch = { readonly itemIndex: number; readonly item: CommandQuickPickItem;
	readonly label: string; readonly commandId: string; kind: CommandMatchKind };

/** Command labels/ids, not paths or keyboard-binding text. Catalog order stays provider-owned. */
export class CommandQuickPickProvider implements QuickPickProvider<CommandQuickPickItem> {
	private readonly entries: CommandMatch[];
	private readonly matcher = new WordMatcher();
	private readonly projection = { matches: [] as CommandMatch[], selectionIndex: -1 };

	public constructor(public readonly items: readonly CommandQuickPickItem[]) {
		this.entries = items.map((item, itemIndex) => ({ itemIndex, item,
			label: item.label.toLowerCase(), commandId: item.command.toLowerCase(), kind: CommandMatchKind.Exact }));
	}

	public getPicks(value: string): QuickPickProjection {
		const query = value.trim().toLowerCase(), matches = this.projection.matches;
		matches.length = 0;
		for (const entry of this.entries) {
			if (query.length === 0 || entry.label === query || entry.commandId === query) entry.kind = CommandMatchKind.Exact;
			else if (entry.label.includes(query)) entry.kind = CommandMatchKind.Substring;
			else if (this.matcher.test(query, entry.label)) entry.kind = CommandMatchKind.Words;
			else continue;
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
