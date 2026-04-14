import { $ } from '../../../../core/engine_core';
import { clamp } from '../../../../utils/clamp';
import { Runtime } from '../../../../emulator/runtime';
import * as runtimeLuaPipeline from '../../../../emulator/runtime_lua_pipeline';
import type { ResourceDescriptor } from '../../../../emulator/types';
import * as constants from '../../../common/constants';
import { setActiveTab } from '../../ui/tabs';
import { computeResourceTabTitle } from '../../ui/tab_titles';
import { splitText } from '../../../editor/text/source_text';
import type { EditorTabId, ResourceViewerState } from '../../../common/types';
import { editorSessionState } from '../../../editor/ui/editor_session_state';

export type ResourceViewerBounds = {
	codeTop: number;
	codeBottom: number;
	codeLeft: number;
	codeRight: number;
};

export function getActiveResourceViewer(): ResourceViewerState {
	for (let index = 0; index < editorSessionState.tabs.length; index += 1) {
		const tab = editorSessionState.tabs[index];
		if (tab.id !== editorSessionState.activeTabId) {
			continue;
		}
		return tab.kind === 'resource_view' ? tab.resource : null;
	}
	return null;
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
				appendResourceViewerLine(lines, '-- Lua Source --');
				lines.push('');
				appendResourceViewerLines(lines, source.split(/\r?\n/));
			} else {
				error = `Lua source '${descriptor.asset_id}' unavailable.`;
			}
			break;
		}
		case 'data': {
			const dataEntry = assets.data?.[descriptor.asset_id];
			if (dataEntry !== undefined) {
				appendResourceViewerLine(lines, '-- Data --');
				lines.push('');
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
				width: meta.width,
				height: meta.height,
				atlassed: Boolean(meta.atlassed),
				atlasId: meta.atlasid,
			};
			appendResourceViewerLine(lines, '-- Image Metadata --');
			appendResourceViewerLine(lines, `Dimensions: ${meta.width}x${meta.height}`);
			appendResourceViewerLine(lines, `Atlassed: ${meta.atlassed ? 'yes' : 'no'}`);
			if (meta.atlasid !== undefined) {
				appendResourceViewerLine(lines, `Atlas ID: ${meta.atlasid}`);
			}
			const metadata = meta as unknown as Record<string, unknown>;
			for (const key in metadata) {
				if (key === 'width' || key === 'height' || key === 'atlassed' || key === 'atlasid') {
					continue;
				}
				appendResourceViewerLine(lines, `${key}: ${describeMetadataValue(metadata[key])}`);
			}
			break;
		}
		case 'audio': {
			const audio = assets.audio?.[descriptor.asset_id];
			if (!audio) {
				error = `Audio asset '${descriptor.asset_id}' not found.`;
				break;
			}
			appendResourceViewerLine(lines, '-- Audio Metadata --');
			const bufferSize = (audio.buffer as { byteLength?: number })?.byteLength;
			if (typeof bufferSize === 'number') {
				appendResourceViewerLine(lines, `Buffer Size: ${bufferSize} bytes`);
			}
			const audioMetadata = (audio.audiometa ?? {}) as Record<string, unknown>;
			for (const key in audioMetadata) {
				appendResourceViewerLine(lines, `${key}: ${describeMetadataValue(audioMetadata[key])}`);
			}
			break;
		}
		case 'model': {
			const model = assets.model?.[descriptor.asset_id];
			if (!model) {
				error = `Model asset '${descriptor.asset_id}' not found.`;
				break;
			}
			appendResourceViewerLine(lines, '-- Model Metadata --');
			appendResourceViewerLine(lines, `Keys: ${Object.keys(model).join(', ')}`);
			break;
		}
		case 'aem': {
			const events = assets.audioevents?.[descriptor.asset_id];
			if (!events) {
				error = `Audio event map '${descriptor.asset_id}' not found.`;
				break;
			}
			appendResourceViewerLine(lines, '-- Audio Events --');
			lines.push('');
			appendResourceViewerLines(lines, safeJsonStringify(events).split(/\r?\n/));
			break;
		}
		default: {
			appendResourceViewerLine(lines, '<no preview available for this asset type>');
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
	let tab = null;
	for (let index = 0; index < editorSessionState.tabs.length; index += 1) {
		const candidate = editorSessionState.tabs[index];
		if (candidate.id === tabId) {
			tab = candidate;
			break;
		}
	}
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
	editorSessionState.tabs.push(tab);
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
	const scale = Math.min(availableWidth / viewer.image.width, maxImageHeight / viewer.image.height);
	const width = Math.max(1, Math.trunc(viewer.image.width * scale));
	const height = Math.max(1, Math.trunc(viewer.image.height * scale));
	const left = bounds.codeLeft + paddingX + Math.max(0, Math.trunc((availableWidth - width) / 2));
	const top = bounds.codeTop + 2;
	return { left, top, width, height, bottom: top + height, scale };
}

export function resourceViewerTextCapacity(viewer: ResourceViewerState, bounds: ResourceViewerBounds, lineHeight: number): number {
	const layout = resourceViewerImageLayout(viewer, bounds, lineHeight);
	const textTop = layout ? layout.bottom + lineHeight : bounds.codeTop + 2;
	if (textTop >= bounds.codeBottom) {
		return 0;
	}
	return Math.max(0, Math.floor((bounds.codeBottom - textTop) / lineHeight));
}

export function clampResourceViewerScroll(viewer: ResourceViewerState, bounds: ResourceViewerBounds, lineHeight: number): void {
	setResourceViewerScroll(viewer, bounds, lineHeight, viewer.scroll);
}

export function setResourceViewerScroll(viewer: ResourceViewerState, bounds: ResourceViewerBounds, lineHeight: number, scroll: number): void {
	const capacity = resourceViewerTextCapacity(viewer, bounds, lineHeight);
	if (capacity <= 0) {
		viewer.scroll = 0;
		return;
	}
	const maxScroll = Math.max(0, viewer.lines.length - capacity);
	viewer.scroll = clamp(Math.round(scroll), 0, maxScroll);
}

function appendResourceViewerLine(target: string[], entry: string): void {
	const parts = splitText(entry);
	for (let index = 0; index < parts.length; index += 1) {
		target.push(parts[index]);
	}
}

function appendResourceViewerLines(target: string[], additions: Iterable<string>): void {
	for (const entry of additions) {
		appendResourceViewerLine(target, entry);
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
