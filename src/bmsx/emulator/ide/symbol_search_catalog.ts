import { ide_state } from './ide_state';
import { advanceQuickInputSelection } from './quick_input_navigation';
import { updateReferenceSearchMatches } from './reference_search_catalog';
import { resetBlink } from './render/render_caret';
import { symbolPriority } from './semantic_model';
import { refreshSymbolCatalog } from './symbol_catalog';
import type { SymbolSearchResult } from './types';
import { ensureSymbolSearchSelectionVisible } from './symbol_search_shared';

export function updateSymbolSearchMatches(): void {
	if (ide_state.symbolSearchMode === 'references') {
		updateReferenceSearchMatches();
		return;
	}
	refreshSymbolCatalog(false);
	ide_state.symbolSearchMatches = [];
	ide_state.symbolSearchSelectionIndex = -1;
	ide_state.symbolSearchDisplayOffset = 0;
	ide_state.symbolSearchHoverIndex = -1;
	if (ide_state.symbolCatalog.length === 0) {
		return;
	}
	const query = ide_state.symbolSearchQuery.trim().toLowerCase();
	if (query.length === 0) {
		ide_state.symbolSearchMatches = ide_state.symbolCatalog.map(entry => ({ entry, matchIndex: 0 }));
		if (ide_state.symbolSearchMatches.length > 0) {
			ide_state.symbolSearchSelectionIndex = 0;
		}
		return;
	}
	const matches: SymbolSearchResult[] = [];
	for (const entry of ide_state.symbolCatalog) {
		const idx = entry.searchKey.indexOf(query);
		if (idx === -1) {
			continue;
		}
		matches.push({ entry, matchIndex: idx });
	}
	if (matches.length === 0) {
		ide_state.symbolSearchMatches = [];
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
	ide_state.symbolSearchMatches = matches;
	ide_state.symbolSearchSelectionIndex = 0;
	ide_state.symbolSearchDisplayOffset = 0;
}

export function moveSymbolSearchSelection(delta: number): void {
	const next = advanceQuickInputSelection(
		ide_state.symbolSearchSelectionIndex,
		ide_state.symbolSearchMatches.length,
		delta
	);
	if (next === ide_state.symbolSearchSelectionIndex) {
		return;
	}
	ide_state.symbolSearchSelectionIndex = next;
	ensureSymbolSearchSelectionVisible();
	resetBlink();
}
