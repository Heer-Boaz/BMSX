import { $ } from '../../core/engine_core';
import { tokenKeyFromId } from '../../util/asset_tokens';
import { clamp } from '../../utils/clamp';
import { Runtime } from '../runtime';
import * as runtimeLuaPipeline from '../runtime_lua_pipeline';
import type { ResourceDescriptor } from '../types';
import * as constants from './constants';
import { describeMetadataValue, safeJsonStringify } from './editor_value_preview';
import { splitText } from './text/source_text';
import type { ResourceCatalogEntry, ResourceSearchResult, ResourceViewerState } from './types';

export type ResourcePanelRatioBounds = {
	min: number;
	max: number;
};

export type ResourceViewerImageLayout = {
	left: number;
	top: number;
	width: number;
	height: number;
	bottom: number;
	scale: number;
};

export type ResourceViewerCodeArea = {
	codeTop: number;
	codeBottom: number;
	codeLeft: number;
	codeRight: number;
};

export function buildResourceCatalog(descriptors: readonly ResourceDescriptor[]): ResourceCatalogEntry[] {
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
	const entries: ResourceCatalogEntry[] = augmented.map((descriptor) => {
		const displayPathSource = descriptor.path.length > 0 ? descriptor.path : (descriptor.asset_id ?? '');
		const displayPath = displayPathSource.length > 0 ? displayPathSource : '<unnamed>';
		const typeLabel = descriptor.type ? descriptor.type.toUpperCase() : '';
		const assetLabel = descriptor.asset_id && descriptor.asset_id !== displayPath ? descriptor.asset_id : null;
		const searchKeyParts = [displayPath, descriptor.asset_id ?? '', descriptor.type ?? ''];
		const searchKey = searchKeyParts
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
	entries.sort((a, b) => a.displayPath.localeCompare(b.displayPath));
	return entries;
}

export function computeResourceSearchResults(
	catalog: readonly ResourceCatalogEntry[],
	rawQuery: string,
): { matches: ResourceSearchResult[]; selectionIndex: number } {
	if (catalog.length === 0) {
		return { matches: [], selectionIndex: -1 };
	}
	const query = rawQuery.trim().toLowerCase();
	if (query.length === 0) {
		return {
			matches: catalog.map(entry => ({ entry, matchIndex: 0 })),
			selectionIndex: -1,
		};
	}
	const tokens = query.split(/\s+/).filter(token => token.length > 0);
	const matches: ResourceSearchResult[] = [];
	for (const entry of catalog) {
		let bestIndex = Number.POSITIVE_INFINITY;
		let valid = true;
		for (const token of tokens) {
			const index = entry.searchKey.indexOf(token);
			if (index === -1) {
				valid = false;
				break;
			}
			if (index < bestIndex) {
				bestIndex = index;
			}
		}
		if (!valid) {
			continue;
		}
		matches.push({ entry, matchIndex: bestIndex });
	}
	if (matches.length === 0) {
		return { matches: [], selectionIndex: -1 };
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
	return { matches, selectionIndex: 0 };
}

export function buildResourceViewerState(descriptor: ResourceDescriptor): ResourceViewerState {
	const title = descriptor.path.length > 0 ? descriptor.path : (descriptor.asset_id ?? '<resource>');
	const lines: string[] = [
		`Path: ${descriptor.path || '<none>'}`,
		`Type: ${descriptor.type}`,
		`Asset ID: ${descriptor.asset_id || '<none>'}`,
	];
	const state: ResourceViewerState = {
		descriptor,
		lines,
		error: null,
		title,
		scroll: 0,
	};
	let error: string = null;
	const assets = $.assets;
	lines.push('');
	const data = assets.data;
	const img = assets.img;
	const audioTable = assets.audio;
	const modelTable = assets.model;
	const audioevents = assets.audioevents;
	switch (descriptor.type) {
		case 'lua': {
			const path = descriptor.path ?? descriptor.asset_id;
			const source = runtimeLuaPipeline.resourceSourceForChunk(Runtime.instance, path);
			if (typeof source === 'string') {
				appendResourceViewerLines(lines, ['-- Lua Source --', '']);
				appendResourceViewerLines(lines, source.split(/\r?\n/));
			} else {
				error = `Lua source '${descriptor.asset_id}' unavailable.`;
			}
			break;
		}
		case 'data': {
			const dataEntry = data?.[tokenKeyFromId(descriptor.asset_id)];
			if (dataEntry !== undefined) {
				const json = safeJsonStringify(dataEntry);
				appendResourceViewerLines(lines, ['-- Data --', '']);
				appendResourceViewerLines(lines, json.split(/\r?\n/));
			} else {
				error = `Data asset '${descriptor.asset_id}' not found.`;
			}
			break;
		}
		case 'image':
		case 'atlas':
		case 'romlabel': {
			const image = img?.[tokenKeyFromId(descriptor.asset_id)];
			if (!image) {
				error = `Image asset '${descriptor.asset_id}' not found.`;
				break;
			}
			const meta = image.imgmeta;
			const width = meta.width;
			const height = meta.height;
			const atlasId = meta.atlasid;
			const atlassed = meta.atlassed;
			state.image = {
				asset_id: descriptor.asset_id,
				width: Math.max(1, Math.floor(width)),
				height: Math.max(1, Math.floor(height)),
				atlassed: Boolean(atlassed),
				atlasId: atlasId,
			};
			appendResourceViewerLines(lines, ['-- Image Metadata --']);
			appendResourceViewerLines(lines, [`Dimensions: ${width}x${height}`]);
			appendResourceViewerLines(lines, [`Atlassed: ${atlassed ? 'yes' : 'no'}`]);
			if (atlasId !== undefined) {
				appendResourceViewerLines(lines, [`Atlas ID: ${atlasId}`]);
			}
			for (const [key, value] of Object.entries(meta)) {
				if (key === 'width' || key === 'height' || key === 'atlassed' || key === 'atlasid') {
					continue;
				}
				appendResourceViewerLines(lines, [`${key}: ${describeMetadataValue(value)}`]);
			}
			break;
		}
		case 'audio': {
			const audio = audioTable?.[tokenKeyFromId(descriptor.asset_id)];
			if (!audio) {
				error = `Audio asset '${descriptor.asset_id}' not found.`;
				break;
			}
			const meta = audio.audiometa ?? {};
			appendResourceViewerLines(lines, ['-- Audio Metadata --']);
			const bufferSize = (audio.buffer as { byteLength?: number })?.byteLength;
			if (typeof bufferSize === 'number') {
				appendResourceViewerLines(lines, [`Buffer Size: ${bufferSize} bytes`]);
			}
			for (const [key, value] of Object.entries(meta)) {
				appendResourceViewerLines(lines, [`${key}: ${describeMetadataValue(value)}`]);
			}
			break;
		}
		case 'model': {
			const model = modelTable?.[tokenKeyFromId(descriptor.asset_id)];
			if (!model) {
				error = `Model asset '${descriptor.asset_id}' not found.`;
				break;
			}
			const keys = Object.keys(model);
			appendResourceViewerLines(lines, ['-- Model Metadata --', `Keys: ${keys.join(', ')}`]);
			break;
		}
		case 'aem': {
			const events = audioevents?.[tokenKeyFromId(descriptor.asset_id)];
			if (!events) {
				error = `Audio event map '${descriptor.asset_id}' not found.`;
				break;
			}
			const json = safeJsonStringify(events);
			appendResourceViewerLines(lines, ['-- Audio Events --', '']);
			appendResourceViewerLines(lines, json.split(/\r?\n/));
			break;
		}
		default: {
			appendResourceViewerLines(lines, ['<no preview available for this asset type>']);
			break;
		}
	}
	if (error) {
		lines.push('');
		lines.push(`Error: ${error}`);
	}
	if (lines.length === 0) {
		lines.push('<empty>');
	}
	state.error = error;
	return state;
}

export function appendResourceViewerLines(target: string[], additions: Iterable<string>): void {
	for (const entry of additions) {
		target.push(...splitText(entry));
	}
}

export function computeResourcePanelRatioBounds(): ResourcePanelRatioBounds {
	const minRatio = constants.RESOURCE_PANEL_MIN_RATIO;
	const minEditorRatio = constants.RESOURCE_PANEL_MIN_EDITOR_RATIO;
	const availableForPanel = Math.max(0, 1 - minEditorRatio);
	const maxRatio = Math.max(minRatio, Math.min(constants.RESOURCE_PANEL_MAX_RATIO, availableForPanel));
	return { min: minRatio, max: maxRatio };
}

export function clampResourcePanelRatio(ratio: number): number {
	const bounds = computeResourcePanelRatioBounds();
	return clamp(ratio, bounds.min, bounds.max);
}

export function computeDefaultResourcePanelRatio(viewportWidth: number, screenWidth: number): number {
	const relative = Math.min(1, viewportWidth / screenWidth);
	const responsiveness = 1 - relative;
	const ratio = constants.RESOURCE_PANEL_DEFAULT_RATIO
		+ responsiveness * (constants.RESOURCE_PANEL_MAX_RATIO - constants.RESOURCE_PANEL_DEFAULT_RATIO) * 0.6;
	return clampResourcePanelRatio(ratio);
}

export function computeResourcePanelPixelWidth(viewportWidth: number, ratio: number): number {
	return Math.floor(viewportWidth * clampResourcePanelRatio(ratio));
}

export function computeResourceViewerImageLayout(
	viewer: ResourceViewerState,
	bounds: ResourceViewerCodeArea,
	lineHeight: number,
): ResourceViewerImageLayout {
	const info = viewer.image;
	if (!info) {
		return null;
	}
	const width = Math.max(1, info.width);
	const height = Math.max(1, info.height);
	const totalHeight = Math.max(0, bounds.codeBottom - bounds.codeTop);
	if (totalHeight <= 0) {
		return null;
	}
	const paddingX = constants.RESOURCE_PANEL_PADDING_X;
	const contentTop = bounds.codeTop + 2;
	const availableWidth = Math.max(1, bounds.codeRight - bounds.codeLeft - paddingX * 2);
	const estimatedTextLines = Math.max(3, Math.min(8, viewer.lines.length + (viewer.error ? 1 : 0)));
	const reservedTextHeight = Math.min(totalHeight * 0.45, lineHeight * estimatedTextLines);
	const maxImageHeight = Math.max(lineHeight * 2, totalHeight - reservedTextHeight);
	let scale = Math.min(availableWidth / width, maxImageHeight / height);
	if (!Number.isFinite(scale) || scale <= 0) {
		scale = Math.min(availableWidth / width, totalHeight / height);
		if (!Number.isFinite(scale) || scale <= 0) {
			return null;
		}
	}
	const drawWidth = width * scale;
	const drawHeight = height * scale;
	const leftMargin = bounds.codeLeft + paddingX;
	const centeredOffset = Math.max(0, Math.floor((availableWidth - drawWidth) * 0.5));
	const left = leftMargin + centeredOffset;
	const top = contentTop;
	const bottom = top + drawHeight;
	return { left, top, width: drawWidth, height: drawHeight, bottom, scale };
}

export function computeResourceViewerTextCapacity(
	viewer: ResourceViewerState,
	bounds: ResourceViewerCodeArea,
	lineHeight: number,
): number {
	const contentTop = bounds.codeTop + 2;
	const layout = computeResourceViewerImageLayout(viewer, bounds, lineHeight);
	let textTop = contentTop;
	if (layout) {
		textTop = Math.floor(layout.bottom + lineHeight);
	}
	if (textTop >= bounds.codeBottom) {
		return 0;
	}
	const availableHeight = Math.max(0, bounds.codeBottom - textTop);
	return Math.max(0, Math.floor(availableHeight / lineHeight));
}
