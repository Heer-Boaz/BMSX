import { clamp } from '../../../../machine/ts/common/clamp';
import type { SearchMatch, SymbolCatalogEntry } from '../../../common/models';
import type { ReferenceMatchInfo } from './state';
import { splitText } from '../../../../machine/ts/common/text_lines';
import { computeSourceLabel } from '../../../common/paths';
import { definitionLocationFromSourceRange, searchMatchFromSourceRange } from '../../navigation/source_range';

type FileMetadata = {
	lines: readonly string[];
	sourceLabel: string;
};

export function buildReferenceCatalog(options: {
	info: ReferenceMatchInfo;
	lines: readonly string[];
	path: string;
}): SymbolCatalogEntry[] {
	const metadata = new Map<string, FileMetadata>();
	metadata.set(options.path, {
		lines: options.lines,
		sourceLabel: computeSourceLabel(options.path),
	});
	const query = options.info.query;
	const entries = new Array<SymbolCatalogEntry>(query.targets.length + query.references.length);
	for (let index = 0; index < query.targets.length; index += 1) {
		const range = query.targets[index].declaration.range;
		entries[index] = createCatalogEntry({
			meta: getFileMetadata(metadata, options.info, range.path),
			match: searchMatchFromSourceRange(range),
			location: definitionLocationFromSourceRange(range),
			expression: options.info.expression,
		});
	}
	for (let index = 0; index < query.references.length; index += 1) {
		const range = query.references[index].range;
		entries[query.targets.length + index] = createCatalogEntry({
			meta: getFileMetadata(metadata, options.info, range.path),
			match: searchMatchFromSourceRange(range),
			location: definitionLocationFromSourceRange(range),
			expression: options.info.expression,
		});
	}
	return entries;
}

function getFileMetadata(
	metadata: Map<string, FileMetadata>,
	info: ReferenceMatchInfo,
	path: string,
): FileMetadata {
	let value = metadata.get(path);
	if (value) {
		return value;
	}
	value = {
		lines: splitText(info.snapshot.getFileData(path).source),
		sourceLabel: computeSourceLabel(path),
	};
	metadata.set(path, value);
	return value;
}

function createCatalogEntry(args: {
	meta: FileMetadata;
	match: SearchMatch;
	location: ReturnType<typeof definitionLocationFromSourceRange>;
	expression: string;
}): SymbolCatalogEntry {
	const snippet = buildReferenceSnippet(args.meta.lines, args.match);
	const symbolName = args.expression.length > 0 ? args.expression : snippet;
	return {
		symbol: {
			name: symbolName,
			path: args.meta.sourceLabel,
			kind: 'assignment',
			location: args.location,
		},
		displayName: snippet,
		searchKey: [snippet, symbolName, args.meta.sourceLabel].join(' ').trim().toLowerCase(),
		line: args.match.row + 1,
		kindLabel: 'REF',
		sourceLabel: args.meta.sourceLabel,
	};
}

function buildReferenceSnippet(lines: readonly string[], match: SearchMatch): string {
	const line = lines[match.row];
	const start = clamp(match.start - 20, 0, line.length);
	const end = clamp(match.end + 20, start, line.length);
	const snippet = line.slice(start, end).trim();
	return snippet.length > 0 ? snippet : line.trim();
}
