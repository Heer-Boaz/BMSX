import { $ } from '../../core/engine_core';
import { extractErrorMessage } from '../../lua/luavalue';
import { assertValidAemDocument, buildAemValidationLookup, parseStructuredTextDocument, type StructuredTextDocumentFormat } from '../../audio/aem_definition';
import type { ResourceDescriptor } from '../types';
import { loadWorkspaceSourceFile, persistWorkspaceSourceFile } from '../workspace';

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

function reloadAudioRouter(): void {
	$.evaluate_lua(`rget('audiorouter'):reload()`);
}

export function listAemResourceDescriptors(): ResourceDescriptor[] {
	const assetSource = $.asset_source;
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
		reloadAudioRouter();
	} catch (error) {
		$.assets.audioevents[assetId] = previousDoc;
		try {
			reloadAudioRouter();
		} catch (restoreError) {
			throw new Error(`${extractErrorMessage(error)}; rollback failed: ${extractErrorMessage(restoreError)}`);
		}
		throw error;
	}
}
