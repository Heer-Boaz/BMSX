import type { SourcePosition, SourceRange } from '../source_range';
import type {
	InlineCallSite,
	LocalSlotDebug,
	ProgramMetadata,
	ProgramResumePoint,
	ProgramStatementPoint,
} from './program';

export type LuaSourceMapSource = {
	rangePath: string;
	displayPath: string;
	source: string;
};

type LuaSourceMapLine = {
	sourceIndex: number;
	sourceLine: number;
};

export type LuaSourceMap = {
	generatedPath: string;
	lines: ReadonlyArray<LuaSourceMapLine | null>;
	sources: ReadonlyArray<LuaSourceMapSource>;
};

export type LuaSourceFragment =
	| {
		kind: 'generated';
		source: string;
	}
	| ({
		kind: 'source';
		startOffset?: number;
		endOffset?: number;
	} & LuaSourceMapSource);

export type ComposedLuaSource = {
	source: string;
	sourceMap: LuaSourceMap;
};

export type MappedLuaSourcePosition = {
	rangePath: string;
	displayPath: string;
	line: number;
	column: number;
};

/**
 * Concatenates whole-line source fragments while retaining their authored
 * coordinates. Generated glue remains intentionally unmapped.
 */
export function composeLuaSource(
	generatedPath: string,
	fragments: ReadonlyArray<LuaSourceFragment>,
): ComposedLuaSource {
	const chunks: string[] = [];
	const lines: Array<LuaSourceMapLine | null> = [];
	const sources: LuaSourceMapSource[] = [];
	let generatedLine = 1;

	for (let fragmentIndex = 0; fragmentIndex < fragments.length; fragmentIndex += 1) {
		const fragment = fragments[fragmentIndex];
		const sourceIndex = fragment.kind === 'source' ? sources.length : -1;
		let fragmentSource = fragment.source;
		let sourceLine = 1;
		if (fragment.kind === 'source') {
			sources.push({
				rangePath: fragment.rangePath,
				displayPath: fragment.displayPath,
				source: fragment.source,
			});
			const startOffset = fragment.startOffset === undefined ? 0 : fragment.startOffset;
			for (let index = 0; index < startOffset; index += 1) {
				if (fragment.source.charCodeAt(index) === 10) {
					sourceLine += 1;
				}
			}
			fragmentSource = fragment.source.slice(startOffset, fragment.endOffset);
		}
		if (lines.length < generatedLine) {
			lines.push(null);
		}
		if (fragmentSource.length !== 0 && sourceIndex >= 0) {
			lines[generatedLine - 1] = { sourceIndex, sourceLine };
		}
		for (let index = 0; index < fragmentSource.length; index += 1) {
			if (fragmentSource.charCodeAt(index) !== 10) {
				continue;
			}
			generatedLine += 1;
			sourceLine += 1;
			lines.push(index + 1 < fragmentSource.length && sourceIndex >= 0
				? { sourceIndex, sourceLine }
				: null);
		}
		chunks.push(fragmentSource);
		if (fragmentSource.length === 0
			|| fragmentSource.charCodeAt(fragmentSource.length - 1) !== 10) {
			chunks.push('\n');
			generatedLine += 1;
			lines.push(null);
		}
	}

	return {
		source: chunks.join(''),
		sourceMap: {
			generatedPath,
			lines,
			sources,
		},
	};
}

export function mapLuaSourcePosition(
	sourceMaps: ReadonlyMap<string, LuaSourceMap>,
	path: string,
	position: SourcePosition,
): MappedLuaSourcePosition {
	const sourceMap = sourceMaps.get(path);
	if (sourceMap === undefined) {
		return {
			rangePath: path,
			displayPath: path,
			line: position.line,
			column: position.column,
		};
	}
	const mapping = sourceMap.lines[position.line - 1];
	if (mapping === null) {
		return {
			rangePath: path,
			displayPath: path,
			line: position.line,
			column: position.column,
		};
	}
	const source = sourceMap.sources[mapping.sourceIndex];
	return {
		rangePath: source.rangePath,
		displayPath: source.displayPath,
		line: mapping.sourceLine,
		column: position.column,
	};
}

function mapLuaSourceRange(
	sourceMaps: ReadonlyMap<string, LuaSourceMap>,
	range: SourceRange,
): SourceRange {
	const start = mapLuaSourcePosition(sourceMaps, range.path, range.start);
	const end = mapLuaSourcePosition(sourceMaps, range.path, range.end);
	if (start.rangePath !== end.rangePath) {
		return range;
	}
	if (start.rangePath === range.path
		&& start.line === range.start.line
		&& start.column === range.start.column
		&& end.line === range.end.line
		&& end.column === range.end.column) {
		return range;
	}
	return {
		path: start.rangePath,
		start: { line: start.line, column: start.column },
		end: { line: end.line, column: end.column },
	};
}

export function mapProgramMetadataSourceRanges(
	metadata: ProgramMetadata,
	sourceMaps: ReadonlyMap<string, LuaSourceMap>,
): ProgramMetadata {
	if (sourceMaps.size === 0) {
		return metadata;
	}

	const inlineCallSiteCache = new Map<
		ReadonlyArray<InlineCallSite>,
		ReadonlyArray<InlineCallSite>
	>();
	const mapInlineCallSites = (
		callSites: ReadonlyArray<InlineCallSite>,
	): ReadonlyArray<InlineCallSite> => {
		const cached = inlineCallSiteCache.get(callSites);
		if (cached !== undefined) {
			return cached;
		}
		let mapped: InlineCallSite[] | null = null;
		for (let index = 0; index < callSites.length; index += 1) {
			const callSite = callSites[index];
			const callRange = mapLuaSourceRange(sourceMaps, callSite.callRange);
			if (callRange !== callSite.callRange && mapped === null) {
				mapped = callSites.slice(0, index);
			}
			if (mapped !== null) {
				mapped.push(callRange === callSite.callRange
					? callSite
					: { ...callSite, callRange });
			}
		}
		const result = mapped === null ? callSites : mapped;
		inlineCallSiteCache.set(callSites, result);
		return result;
	};

	const debugRanges = new Array<SourceRange | null>(metadata.debugRanges.length);
	for (let index = 0; index < metadata.debugRanges.length; index += 1) {
		const range = metadata.debugRanges[index];
		debugRanges[index] = range === null ? null : mapLuaSourceRange(sourceMaps, range);
	}
	const debugInlineCallSites = new Array<ReadonlyArray<InlineCallSite>>(
		metadata.debugInlineCallSites.length,
	);
	for (let index = 0; index < metadata.debugInlineCallSites.length; index += 1) {
		debugInlineCallSites[index] = mapInlineCallSites(metadata.debugInlineCallSites[index]);
	}

	const statementPointsByProto = new Array<ReadonlyArray<ProgramStatementPoint>>(
		metadata.statementPointsByProto.length,
	);
	for (let protoIndex = 0; protoIndex < metadata.statementPointsByProto.length; protoIndex += 1) {
		const points = metadata.statementPointsByProto[protoIndex];
		const mapped = new Array<ProgramStatementPoint>(points.length);
		for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
			const point = points[pointIndex];
			mapped[pointIndex] = {
				...point,
				range: mapLuaSourceRange(sourceMaps, point.range),
				inlineCallSites: mapInlineCallSites(point.inlineCallSites),
			};
		}
		statementPointsByProto[protoIndex] = mapped;
	}

	const resumePointsByProto = new Array<ReadonlyArray<ProgramResumePoint>>(
		metadata.resumePointsByProto.length,
	);
	for (let protoIndex = 0; protoIndex < metadata.resumePointsByProto.length; protoIndex += 1) {
		const points = metadata.resumePointsByProto[protoIndex];
		const mapped = new Array<ProgramResumePoint>(points.length);
		for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
			const point = points[pointIndex];
			mapped[pointIndex] = {
				...point,
				range: mapLuaSourceRange(sourceMaps, point.range),
				inlineCallSites: mapInlineCallSites(point.inlineCallSites),
			};
		}
		resumePointsByProto[protoIndex] = mapped;
	}

	const localSlotsByProto = new Array<ReadonlyArray<LocalSlotDebug>>(
		metadata.localSlotsByProto.length,
	);
	for (let protoIndex = 0; protoIndex < metadata.localSlotsByProto.length; protoIndex += 1) {
		const slots = metadata.localSlotsByProto[protoIndex];
		const mapped = new Array<LocalSlotDebug>(slots.length);
		for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
			const slot = slots[slotIndex];
			mapped[slotIndex] = {
				...slot,
				definition: mapLuaSourceRange(sourceMaps, slot.definition),
				scope: mapLuaSourceRange(sourceMaps, slot.scope),
				inlineCallSites: mapInlineCallSites(slot.inlineCallSites),
			};
		}
		localSlotsByProto[protoIndex] = mapped;
	}

	return {
		...metadata,
		debugRanges,
		debugInlineCallSites,
		statementPointsByProto,
		resumePointsByProto,
		localSlotsByProto,
	};
}
