import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { readWorkspaceLuaSourceText } from '../../../workspace/files';
import { type RuntimeResource } from '../../../common/resource';
import { computeResourceTabTitle } from '../../ui/tab/titles';
import { appendTextLines } from '../../../../machine/ts/common/text_lines';
import type { ResourceViewerContent } from './model';

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
	const context = catalog.getContext(resource.contextId), resourcePackage = context.previewPackage;
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
		case 'image': {
			state.image = { asset, rom: context.previewRom };
			if (context.previewRom === null) {
				appendTextLines(lines, 'No packed image preview. Build this project to preview its image assets.');
				break;
			}
			appendTextLines(lines, '-- Image Metadata --');
			appendTextLines(lines, safeJsonStringify(asset.imgmeta));
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
