import { clamp } from '../../../../common/clamp';
import { LuaLexer } from '../../../../lua/syntax/lexer';
import type { LuaCompletionItem, LuaCompletionKind } from '../../../common/models';

const COMPLETION_KIND_PRIORITY: Record<LuaCompletionKind, number> = {
	local: 90,
	module: 80,
	global: 70,
	api_method: 60,
	api_property: 60,
	native_method: 50,
	native_property: 50,
	builtin: 40,
	keyword: 30,
};

export type CompletionWordRange = {
	prefix: string;
	replaceFromColumn: number;
	replaceToColumn: number;
	replacementText: string;
};

export function resolveCompletionWordRange(line: string, column: number): CompletionWordRange {
	const safeColumn = clamp(column, 0, line.length);
	let start = safeColumn;
	while (start > 0 && LuaLexer.isIdentifierPart(line.charAt(start - 1))) start -= 1;
	let end = safeColumn;
	while (end < line.length && LuaLexer.isIdentifierPart(line.charAt(end))) end += 1;
	return {
		prefix: line.slice(start, safeColumn),
		replaceFromColumn: start,
		replaceToColumn: end,
		replacementText: line.slice(start, end),
	};
}

function shouldReplaceCompletionItem(existing: LuaCompletionItem, candidate: LuaCompletionItem): boolean {
	const candidatePriority = COMPLETION_KIND_PRIORITY[candidate.kind];
	const existingPriority = COMPLETION_KIND_PRIORITY[existing.kind];
	if (candidatePriority !== existingPriority) {
		return candidatePriority > existingPriority;
	}
	return candidate.sortKey < existing.sortKey;
}

function compareCompletionItems(a: LuaCompletionItem, b: LuaCompletionItem): number {
	const label = a.label.localeCompare(b.label);
	if (label !== 0) {
		return label;
	}
	return a.sortKey.localeCompare(b.sortKey);
}

export function buildCanonicalCompletionItems(items: readonly LuaCompletionItem[]): LuaCompletionItem[] {
	const selected = new Map<string, LuaCompletionItem>();
	for (let index = 0; index < items.length; index += 1) {
		const item = items[index];
		const existing = selected.get(item.label);
		if (!existing || shouldReplaceCompletionItem(existing, item)) {
			selected.set(item.label, item);
		}
	}
	const result = Array.from(selected.values());
	result.sort(compareCompletionItems);
	return result;
}

export function filterCompletionItems(items: readonly LuaCompletionItem[], prefix: string, replacementText: string): LuaCompletionItem[] {
	const matches: Array<{ item: LuaCompletionItem; score: number; exact: boolean }> = [];
	for (let i = 0; i < items.length; i += 1) {
		const item = items[i];
		const insertText = item.kind === 'api_method' || item.kind === 'native_method'
			? `${item.insertText}()`
			: item.insertText;
		if (replacementText.length > 0 && insertText === replacementText) {
			continue;
		}
		const label = item.label;
		let score: number = null;
		let exact = false;
		if (label.startsWith(prefix)) { score = 0; exact = label === prefix; }
		else if (prefix.length > 0) {
			const index = label.indexOf(prefix);
			if (index !== -1) score = index + 10;
		}
		if (score === null) continue;
		matches.push({ item, score, exact });
	}
	if (prefix.length === 0) return matches.map(match => match.item);
	if (matches.length === 0) return [];
	matches.sort((a, b) => {
		if (a.exact !== b.exact) return a.exact ? -1 : 1;
		if (a.score !== b.score) return a.score - b.score;
		const priority = COMPLETION_KIND_PRIORITY[b.item.kind] - COMPLETION_KIND_PRIORITY[a.item.kind];
		if (priority !== 0) return priority;
		return compareCompletionItems(a.item, b.item);
	});
	const filtered: LuaCompletionItem[] = [];
	for (let i = 0; i < matches.length; i += 1) filtered.push(matches[i].item);
	return filtered;
}
