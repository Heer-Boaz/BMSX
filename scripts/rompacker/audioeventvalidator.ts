import { assertValidAemDocument, buildAemValidationLookup, parseStructuredTextDocument } from '../../src/bmsx/audio/aem_definition';
import type { Resource } from './rompacker.rompack';

export function validateAudioEventReferences(resources: Resource[]): void {
	const audioIds: string[] = [];
	const dataAssets: Array<{ name: string; value: unknown }> = [];
	const aemResources: Resource[] = [];
	for (let index = 0; index < resources.length; index += 1) {
		const resource = resources[index]!;
		if (resource.type === 'audio') {
			audioIds.push(resource.name);
			continue;
		}
		if (resource.type === 'data' && resource.buffer && typeof resource.name === 'string') {
			const source = resource.buffer.toString('utf8');
			const format = resource.datatype === 'json' ? 'json' : 'yaml';
			const value = parseStructuredTextDocument(source, format, `data file '${resource.filepath ?? resource.name}'`);
			dataAssets.push({ name: resource.name, value });
			continue;
		}
		if (resource.type === 'aem' && resource.buffer) {
			aemResources.push(resource);
		}
	}
	const lookup = buildAemValidationLookup({
		audioIds,
		dataAssets,
	});
	for (let index = 0; index < aemResources.length; index += 1) {
		const resource = aemResources[index]!;
		const source = resource.buffer.toString('utf8');
		// resource.type is narrowed to 'aem' when pushed into aemResources,
		// but the Resource type is still a union here. Use the literal 'aem'
		// so it matches StructuredTextDocumentFormat.
		const format = 'yaml' as const;
		const fileTag = resource.filepath ?? resource.name;
		const doc = parseStructuredTextDocument(source, format, `AEM file '${fileTag}'`);
		assertValidAemDocument(doc, lookup, fileTag);
	}
}
