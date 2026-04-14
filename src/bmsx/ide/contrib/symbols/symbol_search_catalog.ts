import { advanceQuickInputSelection } from '../../navigation/quick_input_navigation';
import { updateReferenceSearchMatches } from '../references/reference_search_catalog';
import { resetBlink } from '../../render/render_caret';
import { symbolPriority } from '../intellisense/semantic_model';
import { refreshSymbolCatalog } from './symbol_catalog';
import type { SymbolSearchResult } from '../../core/types';
import { ensureSymbolSearchSelectionVisible } from './symbol_search_shared';
import { editorFeatureState } from '../../core/editor_feature_state';

export function updateSymbolSearchMatches(): void {
	if (editorFeatureState.symbolSearch.mode === 'references') {
		updateReferenceSearchMatches();
		return;
	}
	refreshSymbolCatalog(false);
	editorFeatureState.symbolSearch.matches = [];
	editorFeatureState.symbolSearch.selectionIndex = -1;
	editorFeatureState.symbolSearch.displayOffset = 0;
	editorFeatureState.symbolSearch.hoverIndex = -1;
	if (editorFeatureState.symbolSearch.catalog.length === 0) {
		return;
	}
	const query = editorFeatureState.symbolSearch.query.trim().toLowerCase();
	if (query.length === 0) {
		editorFeatureState.symbolSearch.matches = editorFeatureState.symbolSearch.catalog.map(entry => ({ entry, matchIndex: 0 }));
		if (editorFeatureState.symbolSearch.matches.length > 0) {
			editorFeatureState.symbolSearch.selectionIndex = 0;
		}
		return;
	}
	const matches: SymbolSearchResult[] = [];
	for (const entry of editorFeatureState.symbolSearch.catalog) {
		const idx = entry.searchKey.indexOf(query);
		if (idx === -1) {
			continue;
		}
		matches.push({ entry, matchIndex: idx });
	}
	if (matches.length === 0) {
		editorFeatureState.symbolSearch.matches = [];
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
	editorFeatureState.symbolSearch.matches = matches;
	editorFeatureState.symbolSearch.selectionIndex = 0;
	editorFeatureState.symbolSearch.displayOffset = 0;
}

export function moveSymbolSearchSelection(delta: number): void {
	const next = advanceQuickInputSelection(
		editorFeatureState.symbolSearch.selectionIndex,
		editorFeatureState.symbolSearch.matches.length,
		delta
	);
	if (next === editorFeatureState.symbolSearch.selectionIndex) {
		return;
	}
	editorFeatureState.symbolSearch.selectionIndex = next;
	ensureSymbolSearchSelectionVisible();
	resetBlink();
}
