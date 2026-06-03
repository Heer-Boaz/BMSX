import { KEYWORDS } from '../../../../lua/syntax/token';
import type { LuaCompletionItem } from '../../../common/models';

export function getKeywordCompletions(): LuaCompletionItem[] {
	const sorted = Array.from(KEYWORDS);
	sorted.sort((a, b) => a.localeCompare(b));
	const items: LuaCompletionItem[] = [];
	for (let i = 0; i < sorted.length; i += 1) {
		const keyword = sorted[i];
		items.push({
			label: keyword,
			insertText: keyword,
			sortKey: `keyword:${keyword}`,
			kind: 'keyword',
			detail: 'Lua keyword',
		});
	}
	return items;
}
