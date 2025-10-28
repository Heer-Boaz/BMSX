import type { ReferenceMatchInfo, ReferenceState } from './reference_navigation';
import type { SymbolCatalogEntry, SymbolSearchResult, SearchMatch } from './types';
import type { ConsoleLuaDefinitionLocation, ConsoleLuaSymbolEntry } from '../types';

export type ReferenceSymbolEntry = ConsoleLuaSymbolEntry & {
	__referenceMatch: SearchMatch;
	__referenceIndex: number;
	__referenceColumn: number;
};

export type ReferenceCatalogEntry = SymbolCatalogEntry & {
	symbol: ReferenceSymbolEntry;
};

type BuildCatalogOptions = {
	info: ReferenceMatchInfo;
	lines: readonly string[];
	chunkName: string;
	assetId: string | null;
	path: string | null;
	sourceLabel: string | null;
};

export function buildReferenceCatalog(options: BuildCatalogOptions): ReferenceCatalogEntry[] {
	const { info, lines, chunkName, assetId, path, sourceLabel } = options;
	const entries: ReferenceCatalogEntry[] = [];
	for (let index = 0; index < info.matches.length; index += 1) {
		const match = info.matches[index];
		const snippet = buildReferenceSnippet(lines, match);
		const location: ConsoleLuaDefinitionLocation = {
			chunkName,
			assetId,
			path: path ?? undefined,
			range: {
				startLine: match.row + 1,
				startColumn: match.start + 1,
				endLine: match.row + 1,
				endColumn: match.end,
			},
		};
		const referenceSymbol: ReferenceSymbolEntry = {
			name: snippet,
			path: sourceLabel ?? chunkName,
			kind: 'assignment',
			location,
			__referenceMatch: match,
			__referenceIndex: index,
			__referenceColumn: match.start + 1,
		};
		const searchTokens: string[] = [snippet.toLowerCase()];
		if (sourceLabel) {
			searchTokens.push(sourceLabel.toLowerCase());
		}
		if (info.expression) {
			searchTokens.push(info.expression.toLowerCase());
		}
		const entry: ReferenceCatalogEntry = {
			symbol: referenceSymbol,
			displayName: snippet,
			searchKey: searchTokens.join(' ').trim(),
			line: match.row + 1,
			kindLabel: 'REF',
			sourceLabel: sourceLabel ?? null,
		};
		entries.push(entry);
	}
	return entries;
}

type FilterCatalogOptions = {
	catalog: readonly ReferenceCatalogEntry[];
	query: string;
	state: ReferenceState;
	pageSize: number;
};

export function filterReferenceCatalog(options: FilterCatalogOptions): {
	matches: SymbolSearchResult[];
	selectionIndex: number;
	displayOffset: number;
} {
	const { catalog, query, state, pageSize } = options;
	const normalized = query.trim().toLowerCase();
	const matches: SymbolSearchResult[] = [];
	for (let index = 0; index < catalog.length; index += 1) {
		const entry = catalog[index];
		const key = entry.searchKey;
		const matchIndex = normalized.length === 0 ? 0 : key.indexOf(normalized);
		if (normalized.length === 0 || matchIndex !== -1) {
			matches.push({
				entry,
				matchIndex: matchIndex === -1 ? Number.MAX_SAFE_INTEGER : matchIndex,
			});
		}
	}
	if (matches.length === 0) {
		state.setActiveIndex(-1);
		return { matches: [], selectionIndex: -1, displayOffset: 0 };
	}
	matches.sort((a, b) => {
		if (a.matchIndex !== b.matchIndex) {
			return a.matchIndex - b.matchIndex;
		}
		const symbolA = a.entry.symbol as ReferenceSymbolEntry;
		const symbolB = b.entry.symbol as ReferenceSymbolEntry;
		const lineDiff = symbolA.location.range.startLine - symbolB.location.range.startLine;
		if (lineDiff !== 0) {
			return lineDiff;
		}
		const columnDiff = symbolA.__referenceColumn - symbolB.__referenceColumn;
		if (columnDiff !== 0) {
			return columnDiff;
		}
		return a.entry.displayName.localeCompare(b.entry.displayName);
	});

	const activeIndex = state.getActiveIndex();
	let selectionIndex = matches.length > 0 ? 0 : -1;
	if (activeIndex >= 0 && activeIndex < matches.length) {
		selectionIndex = activeIndex;
	}
	state.setActiveIndex(selectionIndex);

	let displayOffset = 0;
	if (selectionIndex >= 0) {
		displayOffset = clamp(selectionIndex - Math.floor(pageSize / 2), 0, Math.max(0, matches.length - pageSize));
		if (selectionIndex >= displayOffset + pageSize) {
			displayOffset = selectionIndex - pageSize + 1;
		}
		if (displayOffset < 0) {
			displayOffset = 0;
		}
	}
	return { matches, selectionIndex, displayOffset };
}

function buildReferenceSnippet(lines: readonly string[], match: SearchMatch): string {
	const line = lines[match.row] ?? '';
	if (!line) {
		return '<empty line>';
	}
	const windowSize = 48;
	const startWindow = Math.max(0, match.start - windowSize);
	const endWindow = Math.min(line.length, match.end + windowSize);
	const before = line.slice(startWindow, match.start).trimStart();
	const target = line.slice(match.start, match.end);
	const after = line.slice(match.end, endWindow).trimEnd();
	let snippet = `${before}${target}${after}`.replace(/\s+/g, ' ').trim();
	if (startWindow > 0) {
		snippet = `…${snippet}`;
	}
	if (endWindow < line.length) {
		snippet = `${snippet}…`;
	}
	if (snippet.length === 0) {
		return target.length > 0 ? target : '<empty reference>';
	}
	const maxLength = 160;
	if (snippet.length > maxLength) {
		snippet = `${snippet.slice(0, maxLength - 1)}…`;
	}
	return snippet;
}

function clamp(value: number, min: number, max: number): number {
	if (value < min) {
		return min;
	}
	if (value > max) {
		return max;
	}
	return value;
}
