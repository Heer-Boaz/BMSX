import { advanceQuickInputSelection } from '../../navigation/quick_input_navigation';
import { updateReferenceSearchMatches } from '../references/search_catalog';
import { resetBlink } from '../../render/caret';
import { symbolPriority } from '../intellisense/semantic_model';
import { refreshSymbolCatalog } from './catalog';
import type { SymbolSearchResult } from '../../../common/models';
import { ensureSymbolSearchSelectionVisible } from './shared';
import { symbolSearchState } from './search_state';

export function updateSymbolSearchMatches(): void {
	if (symbolSearchState.mode === 'references') {
		updateReferenceSearchMatches();
		return;
	}
	refreshSymbolCatalog(false);
	symbolSearchState.matches = [];
	symbolSearchState.selectionIndex = -1;
	symbolSearchState.displayOffset = 0;
	symbolSearchState.hoverIndex = -1;
	if (symbolSearchState.catalog.length === 0) {
		return;
	}
	const query = symbolSearchState.query.trim().toLowerCase();
	if (query.length === 0) {
		symbolSearchState.matches = symbolSearchState.catalog.map(entry => ({ entry, matchIndex: 0 }));
		if (symbolSearchState.matches.length > 0) {
			symbolSearchState.selectionIndex = 0;
		}
		return;
	}
	const matches: SymbolSearchResult[] = [];
	for (const entry of symbolSearchState.catalog) {
		const idx = entry.searchKey.indexOf(query);
		if (idx === -1) {
			continue;
		}
		matches.push({ entry, matchIndex: idx });
	}
	if (matches.length === 0) {
		symbolSearchState.matches = [];
		return;
	}
	matches.sort((a, b) => {
		if (a.matchIndex !== b.matchIndex) {
			return a.matchIndex - b.matchIndex;
		}
		const aPriority = symbolPriority(a.entry.symbol.kind);
		const bPriority = symbolPriority(b.entry.symbol.kind);
		if (aPriority !== bPriority) {
			return bPriority - aPriority;
		}
		if (a.entry.searchKey.length !== b.entry.searchKey.length) {
			return a.entry.searchKey.length - b.entry.searchKey.length;
		}
		if (a.entry.line !== b.entry.line) {
			return a.entry.line - b.entry.line;
		}
		return a.entry.displayName.localeCompare(b.entry.displayName);
	});
	symbolSearchState.matches = matches;
	symbolSearchState.selectionIndex = 0;
	symbolSearchState.displayOffset = 0;
}

export function moveSymbolSearchSelection(delta: number): void {
	const next = advanceQuickInputSelection(
		symbolSearchState.selectionIndex,
		symbolSearchState.matches.length,
		delta
	);
	if (next === symbolSearchState.selectionIndex) {
		return;
	}
	symbolSearchState.selectionIndex = next;
	ensureSymbolSearchSelectionVisible();
	resetBlink();
}
