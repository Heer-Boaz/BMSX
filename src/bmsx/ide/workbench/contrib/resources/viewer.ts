import { clamp } from '../../../../common/clamp';
import * as luaPipeline from '../../../runtime/lua_pipeline';
import type { ResourceDescriptor } from '../../../../rompack/resource';
import * as constants from '../../../common/constants';
import { computeResourceTabTitle } from '../../ui/tab/titles';
import { appendTextLines } from '../../../../common/text_lines';
import type { ResourceViewerState } from '../../../common/models';
import type { Runtime } from '../../../../machine/runtime/runtime';

export type ResourceViewerBounds = {
	codeTop: number;
	codeBottom: number;
	codeLeft: number;
	codeRight: number;
};

export type ResourceViewerLayout = {
	hasImage: boolean;
	imageLeft: number;
	imageTop: number;
	imageWidth: number;
	imageHeight: number;
	imageBottom: number;
	imageScale: number;
	textTop: number;
	textCapacity: number;
};

const resourceViewerLayout: ResourceViewerLayout = {
	hasImage: false,
	imageLeft: 0,
	imageTop: 0,
	imageWidth: 0,
	imageHeight: 0,
	imageBottom: 0,
	imageScale: 1,
	textTop: 0,
	textCapacity: 0,
};

export function buildResourceViewerState(runtime: Runtime, descriptor: ResourceDescriptor): ResourceViewerState {
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
	const assets = runtime.activeAssets;
	lines.push('');
	switch (descriptor.type) {
		case 'lua': {
			const path = descriptor.path ?? descriptor.asset_id;
			const source = luaPipeline.resourceSourceForChunk(runtime, path);
			if (typeof source === 'string') {
				appendResourceViewerLine(lines, '-- Lua Source --');
				lines.push('');
				appendTextLines(lines, source);
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
				appendTextLines(lines, safeJsonStringify(dataEntry));
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
				atlasId: meta.atlasid,
			};
			appendResourceViewerLine(lines, '-- Image Metadata --');
			appendResourceViewerLine(lines, `Dimensions: ${meta.width}x${meta.height}`);
			if (meta.atlasid !== undefined) {
				appendResourceViewerLine(lines, `Atlas ID: ${meta.atlasid}`);
			}
			const metadata = meta as unknown as Record<string, unknown>;
			for (const key in metadata) {
				switch (key) {
					case 'width':
					case 'height':
					case 'atlasid':
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
			if (audio.audiometa) {
				const audioMetadata = audio.audiometa as unknown as Record<string, unknown>;
				for (const key in audioMetadata) {
					appendResourceViewerLine(lines, `${key}: ${describeMetadataValue(audioMetadata[key])}`);
				}
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
			appendTextLines(lines, safeJsonStringify(events));
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

export function resolveResourceViewerLayout(
	viewer: ResourceViewerState,
	bounds: ResourceViewerBounds,
	lineHeight: number,
): ResourceViewerLayout {
	const contentTop = bounds.codeTop + 2;
	resourceViewerLayout.hasImage = false;
	resourceViewerLayout.textTop = contentTop;
	resourceViewerLayout.textCapacity = 0;
	const totalHeight = bounds.codeBottom - bounds.codeTop;
	const paddingX = constants.RESOURCE_PANEL_PADDING_X;
	const availableWidth = bounds.codeRight - bounds.codeLeft - paddingX * 2;
	if (viewer.image && totalHeight > 0 && availableWidth > 0) {
		const textRows = clamp(viewer.lines.length + (viewer.error ? 1 : 0), 3, 8);
		const reservedByRatio = totalHeight * 0.45;
		const reservedByRows = lineHeight * textRows;
		const reservedTextHeight = reservedByRatio < reservedByRows ? reservedByRatio : reservedByRows;
		const minImageHeight = lineHeight * 2;
		const remainingImageHeight = totalHeight - reservedTextHeight;
		const maxImageHeight = remainingImageHeight > minImageHeight ? remainingImageHeight : minImageHeight;
		const widthScale = availableWidth / viewer.image.width;
		const heightScale = maxImageHeight / viewer.image.height;
		const scale = widthScale < heightScale ? widthScale : heightScale;
		let width = (viewer.image.width * scale) | 0;
		let height = (viewer.image.height * scale) | 0;
		if (width < 1) {
			width = 1;
		}
		if (height < 1) {
			height = 1;
		}
		const left = bounds.codeLeft + paddingX + (((availableWidth - width) / 2) | 0);
		const top = contentTop;
		resourceViewerLayout.hasImage = true;
		resourceViewerLayout.imageLeft = left;
		resourceViewerLayout.imageTop = top;
		resourceViewerLayout.imageWidth = width;
		resourceViewerLayout.imageHeight = height;
		resourceViewerLayout.imageBottom = top + height;
		resourceViewerLayout.imageScale = scale;
		resourceViewerLayout.textTop = resourceViewerLayout.imageBottom + lineHeight;
	}
	if (resourceViewerLayout.textTop < bounds.codeBottom) {
		resourceViewerLayout.textCapacity = ((bounds.codeBottom - resourceViewerLayout.textTop) / lineHeight) | 0;
	}
	return resourceViewerLayout;
}

export function resourceViewerTextCapacity(viewer: ResourceViewerState, bounds: ResourceViewerBounds, lineHeight: number): number {
	return resolveResourceViewerLayout(viewer, bounds, lineHeight).textCapacity;
}

export function clampResourceViewerScroll(viewer: ResourceViewerState, bounds: ResourceViewerBounds, lineHeight: number): void {
	setResourceViewerScroll(viewer, bounds, lineHeight, viewer.scroll);
}

export function setResourceViewerScroll(viewer: ResourceViewerState, bounds: ResourceViewerBounds, lineHeight: number, scroll: number): void {
	applyResourceViewerScroll(viewer, resourceViewerTextCapacity(viewer, bounds, lineHeight), scroll);
}

export function applyResourceViewerScroll(viewer: ResourceViewerState, capacity: number, scroll: number): void {
	if (capacity <= 0) {
		viewer.scroll = 0;
		return;
	}
	const scrollLimit = viewer.lines.length - capacity;
	const maxScroll = scrollLimit > 0 ? scrollLimit : 0;
	viewer.scroll = clamp((scroll + 0.5) | 0, 0, maxScroll);
}

function appendResourceViewerLine(target: string[], entry: string): void {
	appendTextLines(target, entry);
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
