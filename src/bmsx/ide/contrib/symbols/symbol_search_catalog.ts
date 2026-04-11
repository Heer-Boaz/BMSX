import { ide_state } from '../../core/ide_state';
import { advanceQuickInputSelection } from '../../navigation/quick_input_navigation';
import { updateReferenceSearchMatches } from '../references/reference_search_catalog';
import { resetBlink } from '../../render/render_caret';
import { symbolPriority } from '../intellisense/semantic_model';
import { refreshSymbolCatalog } from './symbol_catalog';
import type { SymbolSearchResult } from '../../core/types';
import { ensureSymbolSearchSelectionVisible } from './symbol_search_shared';

export function updateSymbolSearchMatches(): void {
	if (ide_state.symbolSearch.mode === 'references') {
		updateReferenceSearchMatches();
		return;
	}
	refreshSymbolCatalog(false);
	ide_state.symbolSearch.matches = [];
	ide_state.symbolSearch.selectionIndex = -1;
	ide_state.symbolSearch.displayOffset = 0;
	ide_state.symbolSearch.hoverIndex = -1;
	if (ide_state.symbolSearch.catalog.length === 0) {
		return;
	}
	const query = ide_state.symbolSearch.query.trim().toLowerCase();
	if (query.length === 0) {
		ide_state.symbolSearch.matches = ide_state.symbolSearch.catalog.map(entry => ({ entry, matchIndex: 0 }));
		if (ide_state.symbolSearch.matches.length > 0) {
			ide_state.symbolSearch.selectionIndex = 0;
		}
		return;
	}
	const matches: SymbolSearchResult[] = [];
	for (const entry of ide_state.symbolSearch.catalog) {
		const idx = entry.searchKey.indexOf(query);
		if (idx === -1) {
			continue;
		}
		matches.push({ entry, matchIndex: idx });
	}
	if (matches.length === 0) {
		ide_state.symbolSearch.matches = [];
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
	ide_state.symbolSearch.matches = matches;
	ide_state.symbolSearch.selectionIndex = 0;
	ide_state.symbolSearch.displayOffset = 0;
}

export function moveSymbolSearchSelection(delta: number): void {
	const next = advanceQuickInputSelection(
		ide_state.symbolSearch.selectionIndex,
		ide_state.symbolSearch.matches.length,
		delta
	);
	if (next === ide_state.symbolSearch.selectionIndex) {
		return;
	}
	ide_state.symbolSearch.selectionIndex = next;
	ensureSymbolSearchSelectionVisible();
	resetBlink();
}
