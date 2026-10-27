import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { clamp } from '../../../../machine/ts/common/clamp';
import { readWorkspaceLuaSourceText } from '../../../workspace/files';
import { type RuntimeResource } from '../../../common/resource';
import * as constants from '../../../common/constants';
import { computeResourceTabTitle } from '../../ui/tab/titles';
import { appendTextLines } from '../../../../machine/ts/common/text_lines';
import type { ResourceViewerContent, ResourceViewerState } from './model';

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

export function buildResourceViewerContent(catalog: WorkspaceSourceCatalog, resource: RuntimeResource): ResourceViewerContent {
	const asset = resource.source;
	const title = computeResourceTabTitle(resource);
	const lines: string[] = [
		`Path: ${resource.path || '<none>'}`,
		`Type: ${asset.type}`,
		`Asset ID: ${asset.resid || '<none>'}`,
	];
	const state: ResourceViewerContent = {
		resource,
		lines,
		error: null,
		title,
	};
	let error: string = null;
	const resourcePackage = catalog.getContext(resource.contextId).previewPackage;
	lines.push('');
	switch (asset.type) {
		case 'lua': {
			const source = catalog.resolveLuaSource(resource)!;
			appendResourceViewerLine(lines, '-- Lua Source --');
			lines.push('');
			appendTextLines(lines, readWorkspaceLuaSourceText(source.registry, source.record));
			break;
		}
		case 'data': {
			const dataEntry = resourcePackage.data?.[asset.resid];
			if (dataEntry !== undefined) {
				appendResourceViewerLine(lines, '-- Data --');
				lines.push('');
				appendTextLines(lines, safeJsonStringify(dataEntry));
			} else {
				error = `Data asset '${asset.resid}' not found.`;
			}
			break;
		}
		case 'image':
		case 'romlabel': {
			const image = resourcePackage.img?.[asset.resid];
			if (!image) {
				error = `Image asset '${asset.resid}' not found.`;
				break;
			}
			const meta = image.imgmeta;
			state.image = {
				asset_id: asset.resid,
				width: meta.width,
				height: meta.height,
			};
			appendResourceViewerLine(lines, '-- Image Metadata --');
			appendResourceViewerLine(lines, `Dimensions: ${meta.width}x${meta.height}`);
			const metadata = meta as unknown as Record<string, unknown>;
			for (const key in metadata) {
				switch (key) {
					case 'width':
					case 'height':
						continue;
				}
				appendResourceViewerLine(lines, `${key}: ${describeMetadataValue(metadata[key])}`);
			}
			break;
		}
		case 'audio': {
			const audio = resourcePackage.audio?.[asset.resid];
			if (!audio) {
				error = `Audio asset '${asset.resid}' not found.`;
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
			const model = resourcePackage.model?.[asset.resid];
			if (!model) {
				error = `Model asset '${asset.resid}' not found.`;
				break;
			}
			appendResourceViewerLine(lines, '-- Model Metadata --');
			appendResourceViewerLine(lines, `Keys: ${Object.keys(model).join(', ')}`);
			break;
		}
		case 'aem': {
			const events = resourcePackage.audioevents?.[asset.resid];
			if (!events) {
				error = `Audio event map '${asset.resid}' not found.`;
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

export function layoutResourceViewer(
	layout: ResourceViewerLayout,
	viewer: ResourceViewerState,
	bounds: Readonly<RectBounds>,
	lineHeight: number,
): void {
	const contentTop = bounds.top + 2;
	layout.hasImage = false;
	layout.textTop = contentTop;
	layout.textCapacity = 0;
	const totalHeight = bounds.bottom - bounds.top;
	const paddingX = constants.RESOURCE_PANEL_PADDING_X;
	const availableWidth = bounds.right - bounds.left - paddingX * 2;
	if (viewer.content.image && totalHeight > 0 && availableWidth > 0) {
		const textRows = clamp(viewer.content.lines.length + (viewer.content.error ? 1 : 0), 3, 8);
		const reservedByRatio = totalHeight * 0.45;
		const reservedByRows = lineHeight * textRows;
		const reservedTextHeight = reservedByRatio < reservedByRows ? reservedByRatio : reservedByRows;
		const minImageHeight = lineHeight * 2;
		const remainingImageHeight = totalHeight - reservedTextHeight;
		const maxImageHeight = remainingImageHeight > minImageHeight ? remainingImageHeight : minImageHeight;
		const widthScale = availableWidth / viewer.content.image.width;
		const heightScale = maxImageHeight / viewer.content.image.height;
		const scale = widthScale < heightScale ? widthScale : heightScale;
		let width = (viewer.content.image.width * scale) | 0;
		let height = (viewer.content.image.height * scale) | 0;
		if (width < 1) {
			width = 1;
		}
		if (height < 1) {
			height = 1;
		}
		const left = bounds.left + paddingX + (((availableWidth - width) / 2) | 0);
		const top = contentTop;
		layout.hasImage = true;
		layout.imageLeft = left;
		layout.imageTop = top;
		layout.imageWidth = width;
		layout.imageHeight = height;
		layout.imageBottom = top + height;
		layout.imageScale = scale;
		layout.textTop = layout.imageBottom + lineHeight;
	}
	if (layout.textTop < bounds.bottom) {
		layout.textCapacity = ((bounds.bottom - layout.textTop) / lineHeight) | 0;
	}
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
