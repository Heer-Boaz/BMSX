import {
	assertValidAemDocument,
	buildAemEventMap,
	buildAemValidationLookup,
	parseStructuredTextDocument,
} from '../../toolchain/ts/rompack/aem';
import type { AemResource, Resource } from './rompacker.rompack';

export function compileAudioEventResources(resources: Resource[]): void {
	const audioIds: string[] = [];
	const dataRecords: Array<{ name: string; value: unknown }> = [];
	const aemResources: AemResource[] = [];
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
			dataRecords.push({ name: resource.name, value });
			continue;
		}
		if (resource.type === 'aem' && resource.buffer) {
			aemResources.push(resource);
		}
	}
	const lookup = buildAemValidationLookup({
		audioIds,
		dataRecords,
	});
	for (let index = 0; index < aemResources.length; index += 1) {
		const resource = aemResources[index]!;
		const source = resource.buffer.toString('utf8');
		const fileTag = resource.filepath ?? resource.name;
		const doc = parseStructuredTextDocument(source, resource.datatype, `AEM file '${fileTag}'`);
		assertValidAemDocument(doc, lookup, fileTag);
		resource.eventMap = buildAemEventMap(doc, lookup);
	}
}
