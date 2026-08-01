import { writeLE32 } from '../../../machine/ts/common/endian';
import {
	BLUA32_DIAGNOSTIC_DIRECTORY_FILE_COUNT_OFFSET,
	BLUA32_DIAGNOSTIC_DIRECTORY_FILE_TABLE_OFFSET,
	BLUA32_DIAGNOSTIC_DIRECTORY_HEADER_SIZE,
	BLUA32_DIAGNOSTIC_DIRECTORY_LINE_OFFSET_COUNT_OFFSET,
	BLUA32_DIAGNOSTIC_DIRECTORY_LINE_OFFSET_TABLE_OFFSET,
	BLUA32_DIAGNOSTIC_DIRECTORY_PATH_BYTES_COUNT_OFFSET,
	BLUA32_DIAGNOSTIC_DIRECTORY_PATH_TABLE_OFFSET,
	BLUA32_DIAGNOSTIC_DIRECTORY_RANGE_COUNT_OFFSET,
	BLUA32_DIAGNOSTIC_DIRECTORY_RANGE_TABLE_OFFSET,
	BLUA32_DIAGNOSTIC_FILE_LINE_OFFSET_START_INDEX_OFFSET,
	BLUA32_DIAGNOSTIC_FILE_PATH_BYTE_COUNT_OFFSET,
	BLUA32_DIAGNOSTIC_FILE_PATH_OFFSET,
	BLUA32_DIAGNOSTIC_FILE_RECORD_SIZE,
	BLUA32_DIAGNOSTIC_FILE_SOURCE_BYTE_COUNT_OFFSET,
	BLUA32_DIAGNOSTIC_FILE_SOURCE_OFFSET,
	BLUA32_DIAGNOSTIC_NO_SOURCE,
	BLUA32_DIAGNOSTIC_RANGE_COLUMN_OFFSET,
	BLUA32_DIAGNOSTIC_RANGE_LINE_FILE_OFFSET,
	BLUA32_DIAGNOSTIC_RANGE_PC_START_OFFSET,
	BLUA32_DIAGNOSTIC_RANGE_RECORD_SIZE,
} from '../../../machine/ts/spec/blua32/diagnostics';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import type { SourceRange } from '../lua/source_range';

export const BLUA32_DIAGNOSTICS_IMAGE_ID = '__blua32_diagnostics__';

export type Blua32DiagnosticSource = {
	displayPath: string;
	source: string;
};

export type Blua32DiagnosticSourceMap = ReadonlyMap<string, Blua32DiagnosticSource>;

export type PackedBlua32DiagnosticSource = {
	offset: number;
	bytes: Uint8Array;
};

export type Blua32DiagnosticImage = {
	textAddress: number;
	textByteCount: number;
	debugRanges: ReadonlyArray<SourceRange | null>;
	sources: Blua32DiagnosticSourceMap;
};

export type Blua32DiagnosticDirectoryInput = Blua32DiagnosticImage & {
	directoryOffset: number;
	packedSources: ReadonlyMap<string, PackedBlua32DiagnosticSource>;
};

type EncodedDiagnosticSource = {
	rangePath: string;
	pathBytes: Uint8Array;
	sourceBytes: Uint8Array;
	lineOffsets: number[];
	packedSource: PackedBlua32DiagnosticSource | null;
};

type DiagnosticRangeRecord = {
	pcStart: number;
	lineFile: number;
	column: number;
};

const sourceEncoder = new TextEncoder();

function sourceBytesMatch(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) {
		return false;
	}
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}

function buildLineOffsets(sourceBytes: Uint8Array): number[] {
	const offsets = [0];
	for (let index = 0; index < sourceBytes.byteLength; index += 1) {
		if (sourceBytes[index] === 0x0a) {
			offsets.push(index + 1);
		}
	}
	offsets.push(sourceBytes.byteLength);
	return offsets;
}

function sourcePositionMatches(
	left: SourceRange | null,
	right: SourceRange | null,
): boolean {
	if (!left) {
		return !right;
	}
	if (!right) {
		return false;
	}
	return left.path === right.path
		&& left.start.line === right.start.line
		&& left.start.column === right.start.column;
}

export function encodeBlua32DiagnosticDirectory(
	input: Blua32DiagnosticDirectoryInput,
): Uint8Array {
	const referencedRangePaths = new Set<string>();
	for (let index = 0; index < input.debugRanges.length; index += 1) {
		const range = input.debugRanges[index];
		if (range) {
			referencedRangePaths.add(range.path);
		}
	}
	const encodedSources: EncodedDiagnosticSource[] = [];
	for (const [rangePath, source] of input.sources) {
		if (!referencedRangePaths.has(rangePath)) {
			continue;
		}
		const sourceBytes = sourceEncoder.encode(source.source);
		const packedCandidate = input.packedSources.get(rangePath);
		encodedSources.push({
			rangePath,
			pathBytes: sourceEncoder.encode(source.displayPath),
			sourceBytes,
			lineOffsets: buildLineOffsets(sourceBytes),
			packedSource: packedCandidate
				&& sourceBytesMatch(sourceBytes, packedCandidate.bytes)
				? packedCandidate
				: null,
		});
	}
	encodedSources.sort((left, right) => left.rangePath < right.rangePath
		? -1
		: left.rangePath > right.rangePath ? 1 : 0);
	if (encodedSources.length > 0x10000) {
		throw new Error('BLua32 diagnostics exceed the 16-bit source-file index space.');
	}

	const fileIndexByRangePath = new Map<string, number>();
	let lineOffsetCount = 0;
	let pathBytesCount = 0;
	let embeddedSourceBytesCount = 0;
	for (let index = 0; index < encodedSources.length; index += 1) {
		const source = encodedSources[index];
		fileIndexByRangePath.set(source.rangePath, index);
		lineOffsetCount += source.lineOffsets.length;
		pathBytesCount += source.pathBytes.byteLength;
		if (!source.packedSource) {
			embeddedSourceBytesCount += source.sourceBytes.byteLength;
		}
	}

	const ranges: DiagnosticRangeRecord[] = [{
		pcStart: 0,
		lineFile: BLUA32_DIAGNOSTIC_NO_SOURCE,
		column: 0,
	}];
	let previousRange: SourceRange | null = null;
	for (let index = 0; index < input.debugRanges.length; index += 1) {
		const range = input.debugRanges[index];
		if (sourcePositionMatches(previousRange, range)) {
			continue;
		}
		const pcStart = input.textAddress + index * INSTRUCTION_BYTES;
		if (!range) {
			ranges.push({ pcStart, lineFile: BLUA32_DIAGNOSTIC_NO_SOURCE, column: 0 });
		} else {
			const fileIndex = fileIndexByRangePath.get(range.path)!;
			if (range.start.line > 0xffff) {
				throw new Error(`BLua32 diagnostic line ${range.start.line} exceeds the 16-bit line field.`);
			}
			ranges.push({
				pcStart,
				lineFile: ((range.start.line << 16) | fileIndex) >>> 0,
				column: range.start.column,
			});
		}
		previousRange = range;
	}
	ranges.push({
		pcStart: input.textAddress + input.textByteCount,
		lineFile: BLUA32_DIAGNOSTIC_NO_SOURCE,
		column: 0,
	});

	const rangeTableOffset = BLUA32_DIAGNOSTIC_DIRECTORY_HEADER_SIZE;
	const fileTableOffset = rangeTableOffset + ranges.length * BLUA32_DIAGNOSTIC_RANGE_RECORD_SIZE;
	const lineOffsetTableOffset = fileTableOffset + encodedSources.length * BLUA32_DIAGNOSTIC_FILE_RECORD_SIZE;
	const pathTableOffset = lineOffsetTableOffset + lineOffsetCount * 4;
	const embeddedSourceOffset = pathTableOffset + pathBytesCount;
	const payload = new Uint8Array(embeddedSourceOffset + embeddedSourceBytesCount);

	writeLE32(payload, BLUA32_DIAGNOSTIC_DIRECTORY_RANGE_COUNT_OFFSET, ranges.length);
	writeLE32(payload, BLUA32_DIAGNOSTIC_DIRECTORY_RANGE_TABLE_OFFSET, rangeTableOffset);
	writeLE32(payload, BLUA32_DIAGNOSTIC_DIRECTORY_FILE_COUNT_OFFSET, encodedSources.length);
	writeLE32(payload, BLUA32_DIAGNOSTIC_DIRECTORY_FILE_TABLE_OFFSET, fileTableOffset);
	writeLE32(payload, BLUA32_DIAGNOSTIC_DIRECTORY_LINE_OFFSET_COUNT_OFFSET, lineOffsetCount);
	writeLE32(payload, BLUA32_DIAGNOSTIC_DIRECTORY_LINE_OFFSET_TABLE_OFFSET, lineOffsetTableOffset);
	writeLE32(payload, BLUA32_DIAGNOSTIC_DIRECTORY_PATH_TABLE_OFFSET, pathTableOffset);
	writeLE32(payload, BLUA32_DIAGNOSTIC_DIRECTORY_PATH_BYTES_COUNT_OFFSET, pathBytesCount);

	for (let index = 0; index < ranges.length; index += 1) {
		const range = ranges[index];
		const offset = rangeTableOffset + index * BLUA32_DIAGNOSTIC_RANGE_RECORD_SIZE;
		writeLE32(payload, offset + BLUA32_DIAGNOSTIC_RANGE_PC_START_OFFSET, range.pcStart);
		writeLE32(payload, offset + BLUA32_DIAGNOSTIC_RANGE_LINE_FILE_OFFSET, range.lineFile);
		writeLE32(payload, offset + BLUA32_DIAGNOSTIC_RANGE_COLUMN_OFFSET, range.column);
	}

	let lineOffsetIndex = 0;
	let pathOffset = pathTableOffset;
	let embeddedOffset = embeddedSourceOffset;
	for (let index = 0; index < encodedSources.length; index += 1) {
		const source = encodedSources[index];
		const fileOffset = fileTableOffset + index * BLUA32_DIAGNOSTIC_FILE_RECORD_SIZE;
		writeLE32(payload, fileOffset + BLUA32_DIAGNOSTIC_FILE_PATH_OFFSET, pathOffset);
		writeLE32(payload, fileOffset + BLUA32_DIAGNOSTIC_FILE_PATH_BYTE_COUNT_OFFSET, source.pathBytes.byteLength);
		const sourceOffset = source.packedSource
			? source.packedSource.offset
			: input.directoryOffset + embeddedOffset;
		writeLE32(payload, fileOffset + BLUA32_DIAGNOSTIC_FILE_SOURCE_OFFSET, sourceOffset);
		writeLE32(payload, fileOffset + BLUA32_DIAGNOSTIC_FILE_SOURCE_BYTE_COUNT_OFFSET, source.sourceBytes.byteLength);
		writeLE32(payload, fileOffset + BLUA32_DIAGNOSTIC_FILE_LINE_OFFSET_START_INDEX_OFFSET, lineOffsetIndex);
		for (let lineIndex = 0; lineIndex < source.lineOffsets.length; lineIndex += 1) {
			writeLE32(
				payload,
				lineOffsetTableOffset + lineOffsetIndex * 4,
				source.lineOffsets[lineIndex],
			);
			lineOffsetIndex += 1;
		}
		payload.set(source.pathBytes, pathOffset);
		pathOffset += source.pathBytes.byteLength;
		if (!source.packedSource) {
			payload.set(source.sourceBytes, embeddedOffset);
			embeddedOffset += source.sourceBytes.byteLength;
		}
	}

	return payload;
}
