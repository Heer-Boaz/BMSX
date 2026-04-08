import { $ } from '../../../../core/engine_core';
import { clamp } from '../../../../utils/clamp';
import { Runtime } from '../../../runtime';
import * as runtimeLuaPipeline from '../../../runtime_lua_pipeline';
import type { ResourceDescriptor } from '../../../types';
import * as constants from '../../core/constants';
import { computeResourceTabTitle, setActiveTab } from '../../browser/editor_tabs';
import { ide_state } from '../../core/ide_state';
import { splitText } from '../../text/source_text';
import type { EditorTabId, ResourceViewerState } from '../../core/types';

export type ResourceViewerBounds = {
	codeTop: number;
	codeBottom: number;
	codeLeft: number;
	codeRight: number;
};

export function getActiveResourceViewer(): ResourceViewerState {
	const tab = ide_state.tabs.find(candidate => candidate.id === ide_state.activeTabId);
	if (!tab || tab.kind !== 'resource_view' || !tab.resource) {
		return null;
	}
	return tab.resource;
}

export function buildResourceViewerState(descriptor: ResourceDescriptor): ResourceViewerState {
	const title = computeResourceTabTitle(descriptor);
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
			const dataEntry = assets.data?.[descriptor.asset_id];
			if (dataEntry !== undefined) {
				appendResourceViewerLines(lines, ['-- Data --', '']);
				appendResourceViewerLines(lines, safeJsonStringify(dataEntry).split(/\r?\n/));
			} else {
				error = `Data asset '${descriptor.asset_id}' not found.`;
			}
			break;
		}
		case 'image':
		case 'atlas':
		case 'romlabel': {
			const image = assets.img?.[descriptor.asset_id];
			if (!image) {
				error = `Image asset '${descriptor.asset_id}' not found.`;
				break;
			}
			const meta = image.imgmeta;
			state.image = {
				asset_id: descriptor.asset_id,
				width: Math.floor(meta.width),
				height: Math.floor(meta.height),
				atlassed: Boolean(meta.atlassed),
				atlasId: meta.atlasid,
			};
			appendResourceViewerLines(lines, ['-- Image Metadata --']);
			appendResourceViewerLines(lines, [`Dimensions: ${meta.width}x${meta.height}`]);
			appendResourceViewerLines(lines, [`Atlassed: ${meta.atlassed ? 'yes' : 'no'}`]);
			if (meta.atlasid !== undefined) {
				appendResourceViewerLines(lines, [`Atlas ID: ${meta.atlasid}`]);
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
			const audio = assets.audio?.[descriptor.asset_id];
			if (!audio) {
				error = `Audio asset '${descriptor.asset_id}' not found.`;
				break;
			}
			appendResourceViewerLines(lines, ['-- Audio Metadata --']);
			const bufferSize = (audio.buffer as { byteLength?: number })?.byteLength;
			if (typeof bufferSize === 'number') {
				appendResourceViewerLines(lines, [`Buffer Size: ${bufferSize} bytes`]);
			}
			for (const [key, value] of Object.entries(audio.audiometa ?? {})) {
				appendResourceViewerLines(lines, [`${key}: ${describeMetadataValue(value)}`]);
			}
			break;
		}
		case 'model': {
			const model = assets.model?.[descriptor.asset_id];
			if (!model) {
				error = `Model asset '${descriptor.asset_id}' not found.`;
				break;
			}
			appendResourceViewerLines(lines, ['-- Model Metadata --', `Keys: ${Object.keys(model).join(', ')}`]);
			break;
		}
		case 'aem': {
			const events = assets.audioevents?.[descriptor.asset_id];
			if (!events) {
				error = `Audio event map '${descriptor.asset_id}' not found.`;
				break;
			}
			appendResourceViewerLines(lines, ['-- Audio Events --', '']);
			appendResourceViewerLines(lines, safeJsonStringify(events).split(/\r?\n/));
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
	state.error = error;
	return state;
}

export function openResourceViewerTab(descriptor: ResourceDescriptor): void {
	const tabId: EditorTabId = `resource:${descriptor.path}`;
	let tab = ide_state.tabs.find(candidate => candidate.id === tabId);
	const state = buildResourceViewerState(descriptor);
	if (tab) {
		tab.title = state.title;
		tab.resource = state;
		tab.dirty = false;
		setActiveTab(tabId);
		return;
	}
	tab = {
		id: tabId,
		kind: 'resource_view',
		title: state.title,
		closable: true,
		dirty: false,
		resource: state,
	};
	ide_state.tabs.push(tab);
	setActiveTab(tabId);
}

export function resourceViewerImageLayout(
	viewer: ResourceViewerState,
	bounds: ResourceViewerBounds,
	lineHeight: number,
): { left: number; top: number; width: number; height: number; bottom: number; scale: number } {
	if (!viewer.image) {
		return null;
	}
	const totalHeight = bounds.codeBottom - bounds.codeTop;
	if (totalHeight <= 0) {
		return null;
	}
	const paddingX = constants.RESOURCE_PANEL_PADDING_X;
	const availableWidth = bounds.codeRight - bounds.codeLeft - paddingX * 2;
	if (availableWidth <= 0) {
		return null;
	}
	const reservedTextHeight = Math.min(totalHeight * 0.45, lineHeight * clamp(viewer.lines.length + (viewer.error ? 1 : 0), 3, 8));
	const maxImageHeight = Math.max(lineHeight * 2, totalHeight - reservedTextHeight);
	let scale = Math.min(availableWidth / viewer.image.width, maxImageHeight / viewer.image.height);
	if (!Number.isFinite(scale) || scale <= 0) {
		scale = Math.min(availableWidth / viewer.image.width, totalHeight / viewer.image.height);
		if (!Number.isFinite(scale) || scale <= 0) {
			return null;
		}
	}
	const width = viewer.image.width * scale;
	const height = viewer.image.height * scale;
	const left = bounds.codeLeft + paddingX + Math.max(0, Math.floor((availableWidth - width) * 0.5));
	const top = bounds.codeTop + 2;
	return { left, top, width, height, bottom: top + height, scale };
}

export function resourceViewerTextCapacity(viewer: ResourceViewerState, bounds: ResourceViewerBounds, lineHeight: number): number {
	const layout = resourceViewerImageLayout(viewer, bounds, lineHeight);
	const textTop = layout ? Math.floor(layout.bottom + lineHeight) : bounds.codeTop + 2;
	if (textTop >= bounds.codeBottom) {
		return 0;
	}
	return Math.max(0, Math.floor((bounds.codeBottom - textTop) / lineHeight));
}

export function clampResourceViewerScroll(viewer: ResourceViewerState, bounds: ResourceViewerBounds, lineHeight: number): void {
	const capacity = resourceViewerTextCapacity(viewer, bounds, lineHeight);
	if (capacity <= 0) {
		viewer.scroll = 0;
		return;
	}
	const maxScroll = Math.max(0, viewer.lines.length - capacity);
	if (!Number.isFinite(viewer.scroll) || viewer.scroll < 0) {
		viewer.scroll = 0;
		return;
	}
	if (viewer.scroll > maxScroll) {
		viewer.scroll = maxScroll;
	}
}

function appendResourceViewerLines(target: string[], additions: Iterable<string>): void {
	for (const entry of additions) {
		const parts = splitText(entry);
		for (let index = 0; index < parts.length; index += 1) {
			target.push(parts[index]);
		}
	}
}

function safeJsonStringify(value: unknown, space = 2): string {
	return JSON.stringify(value, (_key, val) => {
		if (typeof val === 'bigint') {
			return Number(val);
		}
		return val;
	}, space);
}

function describeMetadataValue(value: unknown): string {
	if (value === null || value === undefined) {
		return '<none>';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (Array.isArray(value)) {
		const preview = value.slice(0, 4).map(entry => describeMetadataValue(entry)).join(', ');
		return `[${preview}${value.length > 4 ? ', …' : ''}]`;
	}
	if (typeof value === 'object') {
		return `{${Object.keys(value as Record<string, unknown>).join(', ')}}`;
	}
	return String(value);
}
