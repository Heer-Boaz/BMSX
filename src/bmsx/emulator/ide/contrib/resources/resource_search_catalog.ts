import * as constants from '../../core/constants';
import { ide_state } from '../../core/ide_state';
import { listResourcesStrict } from '../../browser/editor_tabs';
import { clampQuickInputDisplayOffset, advanceQuickInputSelection } from '../../navigation/quick_input_navigation';
import { resetBlink } from '../../render/render_caret';
import { resourceSearchWindowCapacity } from '../../browser/editor_view';
import { $ } from '../../../../core/engine_core';

export function refreshResourceCatalog(): void {
	try {
		const descriptors = listResourcesStrict();
		const augmented = descriptors.slice();
		const imgAssets = Object.values($.assets.img);
		for (const asset of imgAssets) {
			if (asset.type !== 'atlas') {
				continue;
			}
			const key = asset.resid;
			if (key !== '_atlas_primary' && !key.startsWith('atlas') && !key.startsWith('_atlas_')) {
				continue;
			}
			if (augmented.some(entry => entry.asset_id === key)) {
				continue;
			}
			augmented.push({ path: `atlas/${key}`, type: 'atlas', asset_id: key });
		}
		ide_state.resourceCatalog = augmented.map((descriptor) => {
			const displayPathSource = descriptor.path.length > 0 ? descriptor.path : (descriptor.asset_id ?? '');
			const displayPath = displayPathSource.length > 0 ? displayPathSource : '<unnamed>';
			const typeLabel = descriptor.type ? descriptor.type.toUpperCase() : '';
			const assetLabel = descriptor.asset_id && descriptor.asset_id !== displayPath ? descriptor.asset_id : null;
			const searchKey = [displayPath, descriptor.asset_id ?? '', descriptor.type ?? '']
				.filter(part => part.length > 0)
				.map(part => part.toLowerCase())
				.join(' ');
			return {
				descriptor,
				displayPath,
				searchKey,
				typeLabel,
				assetLabel,
			};
		});
		ide_state.resourceCatalog.sort((a, b) => a.displayPath.localeCompare(b.displayPath));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ide_state.resourceCatalog = [];
		ide_state.resourceSearchMatches = [];
		ide_state.resourceSearchSelectionIndex = -1;
		ide_state.resourceSearchDisplayOffset = 0;
		ide_state.resourceSearchHoverIndex = -1;
		ide_state.showMessage(`Failed to list resources: ${message}`, constants.COLOR_STATUS_ERROR, 3.0);
	}
}

export function updateResourceSearchMatches(): void {
	ide_state.resourceSearchMatches = [];
	ide_state.resourceSearchSelectionIndex = -1;
	ide_state.resourceSearchDisplayOffset = 0;
	ide_state.resourceSearchHoverIndex = -1;
	if (ide_state.resourceCatalog.length === 0) {
		return;
	}
	const query = ide_state.resourceSearchQuery.trim().toLowerCase();
	if (query.length === 0) {
		ide_state.resourceSearchMatches = ide_state.resourceCatalog.map(entry => ({ entry, matchIndex: 0 }));
		return;
	}
	const tokens = query.split(/\s+/).filter(token => token.length > 0);
	const matches = ide_state.resourceCatalog
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
	ide_state.resourceSearchMatches = matches;
	ide_state.resourceSearchSelectionIndex = 0;
}

export function ensureResourceSearchSelectionVisible(): void {
	ide_state.resourceSearchDisplayOffset = clampQuickInputDisplayOffset(
		ide_state.resourceSearchSelectionIndex,
		ide_state.resourceSearchDisplayOffset,
		ide_state.resourceSearchMatches.length,
		Math.max(1, resourceSearchWindowCapacity())
	);
}

export function moveResourceSearchSelection(delta: number): void {
	const next = advanceQuickInputSelection(
		ide_state.resourceSearchSelectionIndex,
		ide_state.resourceSearchMatches.length,
		delta
	);
	if (next === ide_state.resourceSearchSelectionIndex) {
		return;
	}
	ide_state.resourceSearchSelectionIndex = next;
	ensureResourceSearchSelectionVisible();
	resetBlink();
}
