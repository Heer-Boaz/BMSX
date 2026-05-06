import { extractErrorMessage } from '../../../lua/value';
import { assertValidAemDocument, buildAemValidationLookup, parseStructuredTextDocument, type StructuredTextDocumentFormat } from '../../../rompack/tooling/aem';
import type { ResourceDescriptor } from '../../../rompack/tooling/resource';
import { formatAemYamlDocument } from './yaml_formatter';
import type { Runtime } from '../../../machine/runtime/runtime';
import { runConsoleChunkToNative } from '../../../machine/program/executor';

function resolveAemSourceFormat(path: string): StructuredTextDocumentFormat {
	return path.endsWith('.json') ? 'json' : 'yaml';
}

function buildRuntimeAemValidationLookup(runtime: Runtime) {
	const activePackage = runtime.activePackage;
	const audioIds = Object.keys(activePackage.audio);
	const dataRecordNames = Object.keys(activePackage.data);
	const dataRecords: Array<{ name: string; value: unknown }> = [];
	for (let index = 0; index < dataRecordNames.length; index += 1) {
		const name = dataRecordNames[index]!;
		dataRecords.push({ name, value: activePackage.data[name] });
	}
	return buildAemValidationLookup({
		audioIds,
		dataRecords,
	});
}

function reloadAem(runtime: Runtime): void {
	runConsoleChunkToNative(runtime, `rget('aem'):reload()`);
}

export function listAemResourceDescriptors(runtime: Runtime): ResourceDescriptor[] {
	const romSource = runtime.activeRomSource;
	if (!romSource) {
		return [];
	}
	const records = romSource.list('aem');
	const descriptors: ResourceDescriptor[] = [];
	for (let index = 0; index < records.length; index += 1) {
		const record = records[index]!;
		if (!record.source_path) {
			continue;
		}
		descriptors.push({
			path: record.source_path,
			type: record.type,
			asset_id: record.resid,
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

export function applyAemSourceToRuntime(runtime: Runtime, descriptor: ResourceDescriptor, source: string): void {
	const assetId = descriptor.asset_id;
	if (!assetId) {
		throw new Error(`AEM resource '${descriptor.path}' is missing an asset id.`);
	}
	const doc = parseStructuredTextDocument(source, resolveAemSourceFormat(descriptor.path), `AEM file '${descriptor.path}'`);
	assertValidAemDocument(doc, buildRuntimeAemValidationLookup(runtime), descriptor.path);
	const activePackage = runtime.activePackage;
	const previousDoc = activePackage.audioevents[assetId];
	try {
		activePackage.audioevents[assetId] = doc as Record<string, unknown>;
		reloadAem(runtime);
	} catch (error) {
		activePackage.audioevents[assetId] = previousDoc;
		try {
			reloadAem(runtime);
		} catch (restoreError) {
			throw new Error(`${extractErrorMessage(error)}; rollback failed: ${extractErrorMessage(restoreError)}`);
		}
		throw error;
	}
}
