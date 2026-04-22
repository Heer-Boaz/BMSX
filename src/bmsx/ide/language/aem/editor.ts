import { $ } from '../../../core/engine';
import { extractErrorMessage } from '../../../lua/value';
import { assertValidAemDocument, buildAemValidationLookup, parseStructuredTextDocument, type StructuredTextDocumentFormat } from '../../../audio/aem';
import type { ResourceDescriptor } from '../../../rompack/resource';
import { loadWorkspaceSourceFile, persistWorkspaceSourceFile } from '../../workspace/workspace';
import { formatAemYamlDocument } from './yaml_formatter';

function resolveAemSourceFormat(path: string): StructuredTextDocumentFormat {
	return path.endsWith('.json') ? 'json' : 'yaml';
}

function buildRuntimeAemValidationLookup() {
	const audioIds = Object.keys($.assets.audio);
	const dataAssetNames = Object.keys($.assets.data);
	const dataAssets: Array<{ name: string; value: unknown }> = [];
	for (let index = 0; index < dataAssetNames.length; index += 1) {
		const name = dataAssetNames[index]!;
		dataAssets.push({ name, value: $.assets.data[name] });
	}
	return buildAemValidationLookup({
		audioIds,
		dataAssets,
	});
}

function reloadAem(): void {
	$.evaluate_lua(`rget('aem'):reload()`);
}

export function listAemResourceDescriptors(): ResourceDescriptor[] {
	const assetSource = $.source;
	if (!assetSource) {
		return [];
	}
	const assets = assetSource.list('aem');
	const descriptors: ResourceDescriptor[] = [];
	for (let index = 0; index < assets.length; index += 1) {
		const asset = assets[index]!;
		if (!asset.source_path) {
			continue;
		}
		descriptors.push({
			path: asset.source_path,
			type: asset.type,
			asset_id: asset.resid,
		});
	}
	descriptors.sort((left, right) => left.path.localeCompare(right.path));
	return descriptors;
}

export async function loadAemResourceSource(path: string): Promise<string> {
	return await loadWorkspaceSourceFile(path);
}

export async function saveAemResourceSource(path: string, source: string): Promise<void> {
	await persistWorkspaceSourceFile(path, source);
}

export function formatAemDocument(source: string, path: string): string {
	if (source.length === 0) {
		return '';
	}
	const format = resolveAemSourceFormat(path);
	if (format === 'yaml') {
		try {
			parseStructuredTextDocument(source, format, `AEM file '${path}'`);
			return source;
		} catch {
			const repaired = formatAemYamlDocument(source);
			parseStructuredTextDocument(repaired, format, `AEM file '${path}'`);
			return repaired;
		}
	}
	const doc = parseStructuredTextDocument(source, format, `AEM file '${path}'`);
	const newline = source.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
	const hadTrailingNewline = source.endsWith('\n');
	const formatted = JSON.stringify(doc, null, 2);
	const normalized = newline === '\n'
		? formatted
		// disable-next-line newline_normalization_pattern -- JSON formatting preserves the document's existing line-ending convention.
		: formatted.replace(/\n/g, '\r\n');
	if (hadTrailingNewline) {
		return normalized.endsWith(newline) ? normalized : `${normalized}${newline}`;
	}
	if (normalized.endsWith(newline)) {
		return normalized.slice(0, normalized.length - newline.length);
	}
	return normalized;
}

export function applyAemSourceToRuntime(descriptor: ResourceDescriptor, source: string): void {
	const assetId = descriptor.asset_id;
	if (!assetId) {
		throw new Error(`AEM resource '${descriptor.path}' is missing an asset id.`);
	}
	const doc = parseStructuredTextDocument(source, resolveAemSourceFormat(descriptor.path), `AEM file '${descriptor.path}'`);
	assertValidAemDocument(doc, buildRuntimeAemValidationLookup(), descriptor.path);
	const previousDoc = $.assets.audioevents[assetId];
	try {
		$.assets.audioevents[assetId] = doc as Record<string, unknown>;
		reloadAem();
	} catch (error) {
		$.assets.audioevents[assetId] = previousDoc;
		try {
			reloadAem();
		} catch (restoreError) {
			throw new Error(`${extractErrorMessage(error)}; rollback failed: ${extractErrorMessage(restoreError)}`);
		}
		throw error;
	}
}
