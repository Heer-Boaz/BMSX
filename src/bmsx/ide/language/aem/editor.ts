import { extractErrorMessage } from '../../../lua/value';
import { assertValidAemDocument, buildAemValidationLookup, parseStructuredTextDocument, type StructuredTextDocumentFormat } from '../../../audio/aem';
import type { ResourceDescriptor } from '../../../rompack/resource';
import { formatAemYamlDocument } from './yaml_formatter';
import { Runtime } from '../../../machine/runtime/runtime';
import { runConsoleChunkToNative } from '../../../machine/program/executor';

function resolveAemSourceFormat(path: string): StructuredTextDocumentFormat {
	return path.endsWith('.json') ? 'json' : 'yaml';
}

function buildRuntimeAemValidationLookup() {
	const assets = Runtime.instance.activeAssets;
	const audioIds = Object.keys(assets.audio);
	const dataAssetNames = Object.keys(assets.data);
	const dataAssets: Array<{ name: string; value: unknown }> = [];
	for (let index = 0; index < dataAssetNames.length; index += 1) {
		const name = dataAssetNames[index]!;
		dataAssets.push({ name, value: assets.data[name] });
	}
	return buildAemValidationLookup({
		audioIds,
		dataAssets,
	});
}

function reloadAem(): void {
	runConsoleChunkToNative(`rget('aem'):reload()`);
}

export function listAemResourceDescriptors(): ResourceDescriptor[] {
	const assetSource = Runtime.instance.activeAssetSource;
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

export function formatAemDocument(source: string, path: string, lines: readonly string[]): string {
	if (source.length === 0) {
		return '';
	}
	const format = resolveAemSourceFormat(path);
	if (format === 'yaml') {
		try {
			parseStructuredTextDocument(source, format, `AEM file '${path}'`);
			return source;
		} catch {
			const repaired = formatAemYamlDocument(source, lines);
			parseStructuredTextDocument(repaired, format, `AEM file '${path}'`);
			return repaired;
		}
	}
	const doc = parseStructuredTextDocument(source, format, `AEM file '${path}'`);
	const hadTrailingNewline = source.endsWith('\n');
	const formatted = JSON.stringify(doc, null, 2);
	if (hadTrailingNewline) {
		return formatted.endsWith('\n') ? formatted : `${formatted}\n`;
	}
	if (formatted.endsWith('\n')) {
		return formatted.slice(0, formatted.length - 1);
	}
	return formatted;
}

export function applyAemSourceToRuntime(descriptor: ResourceDescriptor, source: string): void {
	const assetId = descriptor.asset_id;
	if (!assetId) {
		throw new Error(`AEM resource '${descriptor.path}' is missing an asset id.`);
	}
	const doc = parseStructuredTextDocument(source, resolveAemSourceFormat(descriptor.path), `AEM file '${descriptor.path}'`);
	assertValidAemDocument(doc, buildRuntimeAemValidationLookup(), descriptor.path);
	const assets = Runtime.instance.activeAssets;
	const previousDoc = assets.audioevents[assetId];
	try {
		assets.audioevents[assetId] = doc as Record<string, unknown>;
		reloadAem();
	} catch (error) {
		assets.audioevents[assetId] = previousDoc;
		try {
			reloadAem();
		} catch (restoreError) {
			throw new Error(`${extractErrorMessage(error)}; rollback failed: ${extractErrorMessage(restoreError)}`);
		}
		throw error;
	}
}
