export type InlineSourceMap = {
	version: number;
	sources: string[];
	names: string[];
	mappings: string;
	sourcesContent?: Array<string | null>;
	sourceRoot?: string;
};

type MappingSegment = {
	generatedColumn: number;
	sourceIndex: number;
	originalLine: number;
	originalColumn: number;
};

type DecodedLine = MappingSegment[];

type DecodedMappings = DecodedLine[];

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_MAP: Uint8Array = (() => {
	const arr = new Uint8Array(128);
	arr.fill(255);
	for (let i = 0; i < BASE64_CHARS.length; i += 1) {
		arr[BASE64_CHARS.charCodeAt(i)] = i;
	}
	return arr;
})();

function decodeVlqValue(str: string, indexRef: { index: number }): number {
	let result = 0;
	let shift = 0;
	let continuation: number;
	do {
		const ch = str.charCodeAt(indexRef.index);
		const digit = ch < 128 ? BASE64_MAP[ch] : 255;
		indexRef.index += 1;
		continuation = digit & 32;
		const value = digit & 31;
		result |= value << shift;
		shift += 5;
	} while (continuation);
	const negative = (result & 1) === 1;
	result >>= 1;
	return negative ? -result : result;
}

function decodeMappings(mappings: string): DecodedMappings {
	const lines: DecodedMappings = [];
	let generatedLine: DecodedLine = [];
	lines.push(generatedLine);

	let previousGeneratedColumn = 0;
	let previousSourceIndex = 0;
	let previousOriginalLine = 0;
	let previousOriginalColumn = 0;

	const indexRef = { index: 0 };
	while (indexRef.index < mappings.length) {
		const ch = mappings.charCodeAt(indexRef.index);
		if (ch === 59) { // ';'
			indexRef.index += 1;
			generatedLine = [];
			lines.push(generatedLine);
			previousGeneratedColumn = 0;
			continue;
		}
		if (ch === 44) { // ','
			indexRef.index += 1;
			continue;
		}

		const generatedColumnDelta = decodeVlqValue(mappings, indexRef);
		previousGeneratedColumn += generatedColumnDelta;

		if (indexRef.index >= mappings.length) {
			continue;
		}
		const peek = mappings.charCodeAt(indexRef.index);
		if (peek === 44 || peek === 59) {
			continue;
		}

		const sourceDelta = decodeVlqValue(mappings, indexRef);
		previousSourceIndex += sourceDelta;
		const originalLineDelta = decodeVlqValue(mappings, indexRef);
		previousOriginalLine += originalLineDelta;
		const originalColumnDelta = decodeVlqValue(mappings, indexRef);
		previousOriginalColumn += originalColumnDelta;

		// Optional name field exists, but we don't need it.
		if (indexRef.index < mappings.length) {
			const next = mappings.charCodeAt(indexRef.index);
			if (next !== 44 && next !== 59) {
				decodeVlqValue(mappings, indexRef);
			}
		}

		generatedLine.push({
			generatedColumn: previousGeneratedColumn,
			sourceIndex: previousSourceIndex,
			originalLine: previousOriginalLine,
			originalColumn: previousOriginalColumn,
		});
	}
	return lines;
}

export type MinimalSourceMapConsumer = {
	map: InlineSourceMap;
	decoded: DecodedMappings;
};

export function createMinimalSourceMapConsumer(map: InlineSourceMap): MinimalSourceMapConsumer {
	return {
		map,
		decoded: decodeMappings(map.mappings),
	};
}

export function originalPositionFor(consumer: MinimalSourceMapConsumer, pos: { line: number; column: number }): { source: string; line: number; column: number } {
	// Source maps store originalLine/originalColumn 0-based. Lines in stack traces are 1-based.
	const lineIndex = pos.line - 1;
	if (lineIndex < 0 || lineIndex >= consumer.decoded.length) {
		return { source: null, line: null, column: null };
	}
	const segments = consumer.decoded[lineIndex];
	if (segments.length === 0) {
		return { source: null, line: null, column: null };
	}
	let lo = 0;
	let hi = segments.length - 1;
	let best = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const seg = segments[mid];
		if (seg.generatedColumn <= pos.column) {
			best = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	if (best < 0) {
		return { source: null, line: null, column: null };
	}
	const seg = segments[best];
	const source = consumer.map.sources[seg.sourceIndex];
	return {
		source,
		line: seg.originalLine + 1,
		column: seg.originalColumn + 1,
	};
}
