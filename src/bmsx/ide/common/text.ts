import * as constants from './constants';

type LuaCommentTextBuffer = {
	readonly version: number;
	getLineCount(): number;
	getLineContent(row: number): string;
};

export function expandTabs(source: string): string {
	if (source.indexOf('\t') === -1) return source;
	let result = '';
	for (let i = 0; i < source.length; i++) {
		const ch = source.charAt(i);
		if (ch === '\t') {
			for (let j = 0; j < constants.TAB_SPACES; j++) result += ' ';
		} else {
			result += ch;
		}
	}
	return result;
}

function isStringQuote(ch: string): boolean {
	switch (ch) {
		case '"':
		case '\'':
		case '`':
			return true;
		default:
			return false;
	}
}

export function applyCaseOutsideStrings(text: string, transform: (ch: string) => string): string {
	let inString = false;
	let quote = '';
	let escapeNext = false;
	let result = '';
	let mutated = false;
	for (let i = 0; i < text.length; i += 1) {
		const ch = text.charAt(i);
		if (inString) {
			if (mutated) {
				result += ch;
			}
			if (escapeNext) {
				escapeNext = false;
				continue;
			}
			if (ch === '\\') {
				escapeNext = true;
				continue;
			}
			if (ch === quote) {
				inString = false;
				quote = '';
			}
			continue;
		}
		if (isStringQuote(ch)) {
			inString = true;
			quote = ch;
			if (mutated) {
				result += ch;
			}
			continue;
		}
		const transformed = transform(ch);
		if (transformed === ch) {
			if (mutated) {
				result += ch;
			}
			continue;
		}
		if (!mutated) {
			result = text.slice(0, i);
			mutated = true;
		}
		result += transformed;
	}
	return mutated ? result : text;
}

export type TextRangeMeasure = (text: string, start: number, end: number) => number;

function isHorizontalWhitespaceCode(code: number): boolean {
	return code === 32 || code === 9;
}

function skipLeadingHorizontalWhitespace(text: string, index: number, end: number): number {
	let cursor = index;
	while (cursor < end && isHorizontalWhitespaceCode(text.charCodeAt(cursor))) {
		cursor += 1;
	}
	return cursor;
}

function trimTrailingHorizontalWhitespace(text: string, start: number, end: number): number {
	let cursor = end;
	while (cursor > start && isHorizontalWhitespaceCode(text.charCodeAt(cursor - 1))) {
		cursor -= 1;
	}
	return cursor;
}

function findMeasuredWrapEnd(text: string, start: number, end: number, maxWidth: number, measureRange: TextRangeMeasure): number {
	if (maxWidth <= 0) {
		return start + 1;
	}
	let cursor = start;
	let width = 0;
	let breakIndex = start;
	while (cursor < end) {
		const advance = measureRange(text, cursor, cursor + 1);
		if (width + advance > maxWidth) {
			if (cursor === start) {
				return cursor + 1;
			}
			return breakIndex > start ? breakIndex : cursor;
		}
		width += advance;
		cursor += 1;
		if (isHorizontalWhitespaceCode(text.charCodeAt(cursor - 1))) {
			breakIndex = cursor;
		}
	}
	return end;
}

function findMeasuredPrefixEnd(text: string, maxWidth: number, measureRange: TextRangeMeasure): number {
	let low = 0;
	let high = text.length;
	let best = 0;
	while (low <= high) {
		const mid = (low + high) >>> 1;
		if (measureRange(text, 0, mid) <= maxWidth) {
			best = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return best;
}

export function truncateMeasuredText(text: string, maxWidth: number, measureRange: TextRangeMeasure, marker = '...'): string {
	if (maxWidth <= 0) {
		return '';
	}
	if (measureRange(text, 0, text.length) <= maxWidth) {
		return text;
	}
	const markerWidth = measureRange(marker, 0, marker.length);
	if (markerWidth > maxWidth) {
		return '';
	}
	const bodyWidth = maxWidth - markerWidth;
	return text.slice(0, findMeasuredPrefixEnd(text, bodyWidth, measureRange)) + marker;
}

export function appendMeasuredTruncationMarker(text: string, maxWidth: number, measureRange: TextRangeMeasure, marker = '...'): string {
	const markerWidth = measureRange(marker, 0, marker.length);
	if (markerWidth > maxWidth) {
		return '';
	}
	const bodyWidth = maxWidth - markerWidth;
	if (measureRange(text, 0, text.length) <= bodyWidth) {
		return text + marker;
	}
	return text.slice(0, findMeasuredPrefixEnd(text, bodyWidth, measureRange)) + marker;
}

export function writeWrappedMeasuredText(
	lines: string[],
	text: string,
	firstLineWidth: number,
	subsequentWidth: number,
	maxLines: number,
	measureRange: TextRangeMeasure,
	truncationMarker = '...',
): void {
	lines.length = 0;
	let lineStart = skipLeadingHorizontalWhitespace(text, 0, text.length);
	let lineWidth = firstLineWidth;
	for (let lineIndex = 0; lineIndex < maxLines && lineStart < text.length; lineIndex += 1) {
		const lineEnd = findMeasuredWrapEnd(text, lineStart, text.length, lineWidth, measureRange);
		const trimmedEnd = trimTrailingHorizontalWhitespace(text, lineStart, lineEnd);
		lines.push(text.slice(lineStart, trimmedEnd));
		lineStart = skipLeadingHorizontalWhitespace(text, lineEnd, text.length);
		lineWidth = subsequentWidth;
	}
	if (lines.length === 0) {
		lines.push('');
		return;
	}
	if (lineStart < text.length) {
		const lastIndex = lines.length - 1;
		const lastLineWidth = lines.length === 1 ? firstLineWidth : subsequentWidth;
		lines[lastIndex] = appendMeasuredTruncationMarker(lines[lastIndex], lastLineWidth, measureRange, truncationMarker);
	}
}

export function writeWrappedMeasuredLine(
	segments: string[],
	line: string,
	maxWidth: number,
	measureRange: TextRangeMeasure,
): void {
	const initialLength = segments.length;
	if (line.length === 0) {
		segments.push('');
		return;
	}
	let segmentStart = 0;
	let lastBreak = -1;
	let segmentWidth = 0;
	for (let index = 0; index < line.length; index += 1) {
		const code = line.charCodeAt(index);
		if (isHorizontalWhitespaceCode(code)) {
			lastBreak = index;
		}
		segmentWidth += measureRange(line, index, index + 1);
		if (segmentWidth <= maxWidth) {
			continue;
		}
		if (lastBreak >= segmentStart) {
			segments.push(line.slice(segmentStart, lastBreak));
			segmentStart = lastBreak + 1;
			lastBreak = -1;
			index = segmentStart - 1;
			segmentWidth = 0;
			continue;
		}
		if (index === segmentStart) {
			segments.push(line.charAt(index));
			segmentStart = index + 1;
			segmentWidth = 0;
		} else {
			segments.push(line.slice(segmentStart, index));
			segmentStart = index;
			index = segmentStart - 1;
			segmentWidth = 0;
		}
		lastBreak = -1;
	}
	if (segmentStart < line.length) {
		segments.push(line.slice(segmentStart));
	}
	if (segments.length === initialLength) {
		segments.push('');
	}
}

function measureWithWholeTextCallback(text: string, start: number, end: number, measure: (text: string) => number): number {
	return start === 0 && end === text.length ? measure(text) : measure(text.slice(start, end));
}

export function wrapTextDynamic(
	text: string,
	firstLineWidth: number,
	subsequentWidth: number,
	measure: (text: string) => number,
	maxLines: number
): string[] {
	const lines: string[] = [];
	writeWrappedMeasuredText(
		lines,
		text,
		firstLineWidth,
		subsequentWidth,
		maxLines,
		(value, start, end) => measureWithWholeTextCallback(value, start, end, measure),
	);
	return lines;
}

export function isLuaCommentContext(
	buffer: LuaCommentTextBuffer,
	targetRow: number,
	targetColumn: number
): boolean {
	const lineCount = buffer.getLineCount();
	if (targetRow < 0 || targetRow >= lineCount) {
		return false;
	}
	const cache = getLuaCommentContextCache(buffer);
	ensureLuaCommentStateUpTo(buffer, cache, targetRow);
	const line = buffer.getLineContent(targetRow);
	const state = scanLuaLineMode(line, cache.modeState[targetRow], cache.levelState[targetRow], targetColumn, true);
	const mode = stateMode(state);
	return mode === MODE_LONG_COMMENT;
}

class LuaCommentContextCache {
	public version = -1;
	public lineCount = 0;
	public validThroughRow = 0;
	public modeState = new Uint8Array(1);
	public levelState = new Uint32Array(1);

	public reset(lineCount: number, version: number): void {
		this.version = version;
		this.lineCount = lineCount;
		this.validThroughRow = 0;
		this.modeState = new Uint8Array(lineCount + 1);
		this.levelState = new Uint32Array(lineCount + 1);
	}
}

const luaCommentContextCache = new WeakMap<LuaCommentTextBuffer, LuaCommentContextCache>();

export function invalidateLuaCommentContextFromRow(buffer: LuaCommentTextBuffer, row: number): void {
	let cache = luaCommentContextCache.get(buffer);
	if (!cache) {
		cache = new LuaCommentContextCache();
		cache.reset(buffer.getLineCount(), buffer.version);
		luaCommentContextCache.set(buffer, cache);
	}
	const lineCount = buffer.getLineCount();
	const clampedRow = Math.min(row, lineCount);
	if (cache.lineCount !== lineCount) {
		const validThroughRow = Math.min(cache.validThroughRow, clampedRow);
		const nextModeState = new Uint8Array(lineCount + 1);
		const nextLevelState = new Uint32Array(lineCount + 1);
		nextModeState.set(cache.modeState.subarray(0, validThroughRow + 1));
		nextLevelState.set(cache.levelState.subarray(0, validThroughRow + 1));
		cache.version = buffer.version;
		cache.lineCount = lineCount;
		cache.validThroughRow = validThroughRow;
		cache.modeState = nextModeState;
		cache.levelState = nextLevelState;
		return;
	}
	cache.version = buffer.version;
	cache.validThroughRow = Math.min(cache.validThroughRow, clampedRow);
}

function getLuaCommentContextCache(buffer: LuaCommentTextBuffer): LuaCommentContextCache {
	let cache = luaCommentContextCache.get(buffer);
	if (!cache) {
		cache = new LuaCommentContextCache();
		cache.reset(buffer.getLineCount(), buffer.version);
		luaCommentContextCache.set(buffer, cache);
	}
	return cache;
}

function ensureLuaCommentStateUpTo(buffer: LuaCommentTextBuffer, cache: LuaCommentContextCache, targetRow: number): void {
	const lineCount = buffer.getLineCount();
	if (cache.lineCount !== lineCount) {
		cache.reset(lineCount, buffer.version);
	}
	if (cache.version !== buffer.version) {
		cache.version = buffer.version;
		cache.validThroughRow = 0;
	}
	while (cache.validThroughRow < targetRow) {
		const row = cache.validThroughRow;
		let mode = cache.modeState[row];
		let level = cache.levelState[row];
		const line = buffer.getLineContent(row);
		const state = scanLuaLineMode(line, mode, level, line.length, false);
		mode = stateMode(state);
		level = stateLevel(state);
		cache.modeState[row + 1] = mode;
		cache.levelState[row + 1] = level;
		cache.validThroughRow = row + 1;
	}
}

const MODE_NORMAL = 0;
const MODE_STRING_SINGLE = 1;
const MODE_STRING_DOUBLE = 2;
const MODE_LONG_STRING = 3;
const MODE_LONG_COMMENT = 4;

function packLuaLineState(mode: number, level: number): number {
	return mode | (level << 3);
}

function stateMode(state: number): number {
	return state & 7;
}

function stateLevel(state: number): number {
	return state >>> 3;
}

function luaStringCloseCode(mode: number): number {
	return mode === MODE_STRING_SINGLE ? 39 : 34;
}

function scanLuaLineMode(line: string, startMode: number, startLevel: number, endColumn: number, keepLineComment: boolean): number {
	let mode = startMode;
	let level = startLevel;
	let index = 0;
	const end = endColumn < line.length ? endColumn : line.length;
	while (index < end) {
		if (mode === MODE_LONG_COMMENT || mode === MODE_LONG_STRING) {
			const ch = line.charCodeAt(index);
			if (ch === 93) {
				const closeLen = longBracketCloseLengthAt(line, index, level);
				if (closeLen > 0) {
					mode = MODE_NORMAL;
					level = 0;
					index += closeLen;
					continue;
				}
			}
			index += 1;
			continue;
		}
		if (mode === MODE_STRING_SINGLE || mode === MODE_STRING_DOUBLE) {
			const ch = line.charCodeAt(index);
			if (ch === 92) {
				const nextIndex = index + 1;
				index += nextIndex < line.length && line.charCodeAt(nextIndex) === 122
					? 2 + skipLuaStringWhitespace(line, index + 2)
					: 2;
				continue;
			}
			if (ch === luaStringCloseCode(mode)) {
				mode = MODE_NORMAL;
				index += 1;
				continue;
			}
			index += 1;
			continue;
		}

		const ch = line.charCodeAt(index);
		const nextIndex = index + 1;
		const next = nextIndex < line.length ? line.charCodeAt(nextIndex) : 0;
		if (ch === 45 && next === 45) {
			const openIndex = index + 2;
			const openLevel = openIndex < line.length ? longBracketLevelAt(line, openIndex) : -1;
			if (openLevel >= 0) {
				mode = MODE_LONG_COMMENT;
				level = openLevel;
				index = openIndex + openLevel + 2;
				continue;
			}
			return packLuaLineState(keepLineComment ? MODE_LONG_COMMENT : mode, level);
		}
		if (ch === 91) {
			const openLevel = longBracketLevelAt(line, index);
			if (openLevel >= 0) {
				mode = MODE_LONG_STRING;
				level = openLevel;
				index += openLevel + 2;
				continue;
			}
		}
		if (ch === 39) {
			mode = MODE_STRING_SINGLE;
			index += 1;
			continue;
		}
		if (ch === 34) {
			mode = MODE_STRING_DOUBLE;
			index += 1;
			continue;
		}
		index += 1;
	}
	return packLuaLineState(mode, level);
}

function longBracketLevelAt(line: string, index: number): number {
	if (line.charCodeAt(index) !== 91) {
		return -1;
	}
	let level = 0;
	let cursor = index + 1;
	while (cursor < line.length && line.charCodeAt(cursor) === 61) {
		level += 1;
		cursor += 1;
	}
	return cursor < line.length && line.charCodeAt(cursor) === 91 ? level : -1;
}

function longBracketCloseLengthAt(line: string, index: number, level: number): number {
	if (line.charCodeAt(index) !== 93) {
		return 0;
	}
	let cursor = index + 1;
	for (let i = 0; i < level; i += 1) {
		if (cursor >= line.length || line.charCodeAt(cursor) !== 61) {
			return 0;
		}
		cursor += 1;
	}
	return cursor < line.length && line.charCodeAt(cursor) === 93 ? level + 2 : 0;
}

function skipLuaStringWhitespace(line: string, index: number): number {
	let skipped = 0;
	let cursor = index;
	while (cursor < line.length) {
		const code = line.charCodeAt(cursor);
		if (!isLuaWhitespaceCode(code)) {
			break;
		}
		cursor += 1;
		skipped += 1;
	}
	return skipped;
}

function isLuaWhitespaceCode(code: number): boolean {
	switch (code) {
		case 9:
		case 10:
		case 11:
		case 12:
		case 13:
		case 32:
			return true;
		default:
			return false;
	}
}
export function truncateWithMeasure(text: string, maxWidth: number, measure: (t: string) => number): string {
	return truncateMeasuredText(text, maxWidth, (value, start, end) => measureWithWholeTextCallback(value, start, end, measure));
}
