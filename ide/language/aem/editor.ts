import type { RuntimeSourceState } from '../../runtime/sources';
import { aemDocumentFormat, parseStructuredTextDocument } from '../../../machine/ts/rompack/tooling/aem';
import type { ResourceDescriptor } from '../../common/resource';
import { formatAemYamlDocument } from './yaml_formatter';

export function listAemResourceDescriptors(sources: RuntimeSourceState): ResourceDescriptor[] {
	const romSource = sources.activeRomSource;
	const records = romSource.list('aem');
	const descriptors: ResourceDescriptor[] = [];
	const domain = sources.activeCartridgeSlot;
	for (let index = 0; index < records.length; index += 1) {
		const record = records[index]!;
		if (!record.source_path) {
			continue;
		}
		descriptors.push({
			domain,
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
	const format = aemDocumentFormat(path);
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
