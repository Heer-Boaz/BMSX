import { clamp } from '../../../../../../machine/ts/common/clamp';
import type { SymbolCatalogEntry, SymbolSearchResult } from '../../../../../common/models';

export function filterLocationCatalog(options: {
	catalog: readonly SymbolCatalogEntry[];
	query: string;
	activeCatalogIndex: number;
	pageSize: number;
}): {
	matches: SymbolSearchResult[];
	selectionIndex: number;
	displayOffset: number;
} {
	const query = options.query.trim().toLowerCase();
	const matches: SymbolSearchResult[] = [];
	for (let index = 0; index < options.catalog.length; index += 1) {
		const entry = options.catalog[index];
		const matchIndex = query.length === 0 ? 0 : entry.searchKey.indexOf(query);
		if (query.length === 0 || matchIndex !== -1) {
			matches.push({ entry, matchIndex, catalogIndex: index });
		}
	}
	if (matches.length === 0) {
		return { matches, selectionIndex: -1, displayOffset: 0 };
	}
	matches.sort(compareLocationSearchResults);
	let selectionIndex = 0;
	for (let index = 0; index < matches.length; index += 1) {
		if (matches[index].catalogIndex === options.activeCatalogIndex) {
			selectionIndex = index;
			break;
		}
	}
	// start value-or-boundary -- location result window offset is bounded once against the filtered list.
	let displayOffset = clamp(selectionIndex - Math.floor(options.pageSize / 2), 0, Math.max(0, matches.length - options.pageSize));
	// end value-or-boundary
	if (selectionIndex >= displayOffset + options.pageSize) {
		displayOffset = selectionIndex - options.pageSize + 1;
	}
	return { matches, selectionIndex, displayOffset };
}

function compareLocationSearchResults(left: SymbolSearchResult, right: SymbolSearchResult): number {
	if (left.matchIndex !== right.matchIndex) {
		return left.matchIndex - right.matchIndex;
	}
	const leftSymbol = left.entry.symbol;
	const rightSymbol = right.entry.symbol;
	if (leftSymbol.location.path !== rightSymbol.location.path) {
		return leftSymbol.location.path.localeCompare(rightSymbol.location.path);
	}
	if (leftSymbol.location.range.startLine !== rightSymbol.location.range.startLine) {
		return leftSymbol.location.range.startLine - rightSymbol.location.range.startLine;
	}
	if (leftSymbol.location.range.startColumn !== rightSymbol.location.range.startColumn) {
		return leftSymbol.location.range.startColumn - rightSymbol.location.range.startColumn;
	}
	return left.entry.displayName.localeCompare(right.entry.displayName);
}
