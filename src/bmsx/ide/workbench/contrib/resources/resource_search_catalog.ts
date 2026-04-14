import * as constants from '../../../common/constants';
import { showEditorMessage } from '../../common/feedback_state';
import { listResourcesStrict } from '../../ui/tabs';
import { clampQuickInputDisplayOffset, advanceQuickInputSelection } from '../../../editor/navigation/quick_input_navigation';
import { resetBlink } from '../../../editor/render/render_caret';
import { resourceSearchWindowCapacity } from '../../../editor/ui/editor_view';
import { $ } from '../../../../core/engine_core';
import { resourceSearchState } from './resource_widget_state';

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
		resourceSearchState.catalog = augmented.map((descriptor) => {
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
		resourceSearchState.catalog.sort((a, b) => a.displayPath.localeCompare(b.displayPath));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		resourceSearchState.catalog = [];
		resourceSearchState.matches = [];
		resourceSearchState.selectionIndex = -1;
		resourceSearchState.displayOffset = 0;
		resourceSearchState.hoverIndex = -1;
		showEditorMessage(`Failed to list resources: ${message}`, constants.COLOR_STATUS_ERROR, 3.0);
	}
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
