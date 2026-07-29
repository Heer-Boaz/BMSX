import { clampQuickInputDisplayOffset, advanceQuickInputSelection } from '../../../../editor/navigation/quick_input_navigation';
import { resetBlink } from '../../../../editor/render/caret';
import { resourceSearchWindowCapacity } from '../../../common/layout';
import { resourceSearchState } from '../widget_state';
import type { RuntimeSourceState } from '../../../../runtime/sources';

export function refreshResourceCatalog(sources: RuntimeSourceState): void {
	resourceSearchState.catalog = sources.activeResources.map((resource) => {
		const asset = resource.source;
		const displayPath = resource.path || asset.resid || '<unnamed>';
		const assetLabel = asset.resid && asset.resid !== displayPath ? asset.resid : null;
		const searchKey = `${displayPath} ${asset.resid} ${asset.type}`.toLowerCase();
		return {
			resource,
			displayPath,
			searchKey,
			typeLabel: asset.type.toUpperCase(),
			assetLabel,
		};
	});
	resourceSearchState.catalog.sort((a, b) => a.displayPath.localeCompare(b.displayPath));
}

export function updateResourceSearchMatches(): void {
	resourceSearchState.matches = [];
	resourceSearchState.selectionIndex = -1;
	resourceSearchState.displayOffset = 0;
	resourceSearchState.hoverIndex = -1;
	if (resourceSearchState.catalog.length === 0) {
		return;
	}
	const query = resourceSearchState.query.trim().toLowerCase();
	if (query.length === 0) {
		resourceSearchState.matches = resourceSearchState.catalog.map(entry => ({ entry, matchIndex: 0 }));
		return;
	}
	const tokens = query.split(/\s+/).filter(token => token.length > 0);
	const matches = resourceSearchState.catalog
		.filter((entry) => {
			for (const token of tokens) {
				if (entry.searchKey.indexOf(token) === -1) {
					return false;
				}
			}
			return true;
		})
		.map((entry) => {
			let matchIndex = Number.POSITIVE_INFINITY;
			for (const token of tokens) {
				const index = entry.searchKey.indexOf(token);
				if (index < matchIndex) {
					matchIndex = index;
				}
			}
			return { entry, matchIndex };
		});
	if (matches.length === 0) {
		return;
	}
	matches.sort((a, b) => {
		if (a.matchIndex !== b.matchIndex) {
			return a.matchIndex - b.matchIndex;
		}
		if (a.entry.displayPath.length !== b.entry.displayPath.length) {
			return a.entry.displayPath.length - b.entry.displayPath.length;
		}
		return a.entry.displayPath.localeCompare(b.entry.displayPath);
	});
	resourceSearchState.matches = matches;
	resourceSearchState.selectionIndex = 0;
}

export function ensureResourceSearchSelectionVisible(): void {
	resourceSearchState.displayOffset = clampQuickInputDisplayOffset(
		resourceSearchState.selectionIndex,
		resourceSearchState.displayOffset,
		resourceSearchState.matches.length,
		Math.max(1, resourceSearchWindowCapacity())
	);
}

export function moveResourceSearchSelection(delta: number): void {
	const next = advanceQuickInputSelection(
		resourceSearchState.selectionIndex,
		resourceSearchState.matches.length,
		delta
	);
	if (next === resourceSearchState.selectionIndex) {
		return;
	}
	resourceSearchState.selectionIndex = next;
	ensureResourceSearchSelectionVisible();
	resetBlink();
}
