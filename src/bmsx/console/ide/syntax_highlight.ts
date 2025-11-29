import * as constants from './constants';
import { KEYWORDS } from './intellisense';
import type { SemanticAnnotations, SymbolKind } from './semantic_model';
import type { HighlightLine } from './types';
import { DEFAULT_LUA_BUILTIN_NAMES } from '../lua_builtins';

// Lightweight Lua syntax highlighter used by the console editor.
// Pure functions with no runtime/editor state dependencies beyond provided inputs.

function isDigit(ch: string): boolean {
	return ch >= '0' && ch <= '9';
}

function isHexDigit(ch: string): boolean {
	return (ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'F') || (ch >= 'a' && ch <= 'f');
}

function isIdentifierStart(ch: string): boolean {
	return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_';
}

function isIdentifierPart(ch: string): boolean {
	return isIdentifierStart(ch) || isDigit(ch);
}

function isOperatorChar(ch: string): boolean {
	return '+-*/%<>=#(){}[]:,.;&|~^'.includes(ch);
}

function isNumberStart(line: string, index: number): boolean {
	const ch = line.charAt(index);
	if (ch >= '0' && ch <= '9') return true;
	if (ch === '.' && index + 1 < line.length) {
		const next = line.charAt(index + 1);
		return next >= '0' && next <= '9';
	}
	return false;
}

function readNumber(line: string, start: number): number {
	let index = start;
	const length = line.length;
	if (line.startsWith('0x', index) || line.startsWith('0X', index)) {
		index += 2;
		while (index < length && isHexDigit(line.charAt(index))) index += 1;
		if (index < length && line.charAt(index) === '.') {
			index += 1;
			while (index < length && isHexDigit(line.charAt(index))) index += 1;
		}
		if (index < length && (line.charAt(index) === 'p' || line.charAt(index) === 'P')) {
			index += 1;
			if (index < length && (line.charAt(index) === '+' || line.charAt(index) === '-')) index += 1;
			while (index < length && isDigit(line.charAt(index))) index += 1;
		}
		return index;
	}
	while (index < length && isDigit(line.charAt(index))) index += 1;
	if (index < length && line.charAt(index) === '.') {
		index += 1;
		while (index < length && isDigit(line.charAt(index))) index += 1;
	}
	if (index < length && (line.charAt(index) === 'e' || line.charAt(index) === 'E')) {
		index += 1;
		if (index < length && (line.charAt(index) === '+' || line.charAt(index) === '-')) index += 1;
		while (index < length && isDigit(line.charAt(index))) index += 1;
	}
	return index;
}

function readIdentifier(line: string, start: number): number {
	let index = start;
	while (index < line.length && isIdentifierPart(line.charAt(index))) index += 1;
	return index;
}

type IdentifierPath = {
	segments: Array<{ start: number; end: number }>;
	delimiters: number[];
	end: number;
};

function readIdentifierPath(line: string, start: number): IdentifierPath {
	const segments: Array<{ start: number; end: number }> = [];
	const delimiters: number[] = [];
	let index = start;
	while (index < line.length && isIdentifierStart(line.charAt(index))) {
		const segmentStart = index;
		index = readIdentifier(line, index);
		segments.push({ start: segmentStart, end: index });
		if (index >= line.length) {
			break;
		}
		const separator = line.charAt(index);
		if ((separator === '.' || separator === ':') && index + 1 < line.length && isIdentifierStart(line.charAt(index + 1))) {
			delimiters.push(index);
			index += 1;
			continue;
		}
		break;
	}
	return { segments, delimiters, end: index };
}

function skipWhitespace(line: string, start: number): number {
	let index = start;
	while (index < line.length) {
		const ch = line.charAt(index);
		if (ch !== ' ' && ch !== '\t') break;
		index += 1;
	}
	return index;
}

const MULTI_CHAR_OPERATORS = new Set(['==', '~=', '<=', '>=', '..', '//', '<<', '>>']);

const COMMENT_ANNOTATIONS = ['TODO', 'FIXME', 'BUG', 'HACK', 'NOTE', 'WARNING'];

type BuiltinLookup = (word: string) => boolean;

const BUILTIN_LOOKUP_FROM_SET = new WeakMap<ReadonlySet<string>, BuiltinLookup>();
const BUILTIN_LOOKUP_FROM_KEY = new Map<string, BuiltinLookup>();

function createLookupFromNames(names: Iterable<string>): BuiltinLookup {
	const exact = new Set<string>();
	const canonical = new Set<string>();
	for (const candidate of names) {
		if (typeof candidate !== 'string') {
			continue;
		}
		const trimmed = candidate.trim();
		if (trimmed.length === 0) {
			continue;
		}
		exact.add(trimmed);
		canonical.add(trimmed.toLowerCase());
	}
	return (word: string) => {
		if (!word) {
			return false;
		}
		if (exact.has(word)) {
			return true;
		}
		return canonical.has(word.toLowerCase());
	};
}

function createLookupWithExtras(extras: Iterable<string>): BuiltinLookup {
	const names: string[] = [];
	for (let index = 0; index < DEFAULT_LUA_BUILTIN_NAMES.length; index += 1) {
		names.push(DEFAULT_LUA_BUILTIN_NAMES[index]);
	}
	for (const value of extras) {
		if (typeof value !== 'string') {
			continue;
		}
		names.push(value);
	}
	return createLookupFromNames(names);
}

function buildBuiltinCacheKey(values: readonly string[]): string {
	if (values.length === 0) {
		return '';
	}
	const normalized: string[] = [];
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index];
		if (typeof value !== 'string') {
			continue;
		}
		const trimmed = value.trim();
		if (trimmed.length === 0) {
			continue;
		}
		normalized.push(trimmed);
	}
	if (normalized.length === 0) {
		return '';
	}
	normalized.sort((a, b) => {
		if (a < b) return -1;
		if (a > b) return 1;
		return 0;
	});
	return normalized.join('\u0000');
}

const DEFAULT_BUILTIN_LOOKUP = createLookupFromNames(DEFAULT_LUA_BUILTIN_NAMES);

function getBuiltinLookup(extra: Iterable<string> | null | undefined): BuiltinLookup {
	if (!extra) {
		return DEFAULT_BUILTIN_LOOKUP;
	}
	if (extra instanceof Set) {
		const existing = BUILTIN_LOOKUP_FROM_SET.get(extra as ReadonlySet<string>);
		if (existing) {
			return existing;
		}
		const lookup = createLookupWithExtras(extra);
		BUILTIN_LOOKUP_FROM_SET.set(extra as ReadonlySet<string>, lookup);
		return lookup;
	}
	if (Array.isArray(extra)) {
		const key = buildBuiltinCacheKey(extra);
		const existing = BUILTIN_LOOKUP_FROM_KEY.get(key);
		if (existing) {
			return existing;
		}
		const lookup = createLookupWithExtras(extra);
		BUILTIN_LOOKUP_FROM_KEY.set(key, lookup);
		return lookup;
	}
	const collected = Array.from(extra);
	const key = buildBuiltinCacheKey(collected);
	const existing = BUILTIN_LOOKUP_FROM_KEY.get(key);
	if (existing) {
		return existing;
	}
	const lookup = createLookupWithExtras(collected);
	BUILTIN_LOOKUP_FROM_KEY.set(key, lookup);
	return lookup;
}

function extractIdentifierAt(line: string, column: number): string {
	let start = column;
	while (start > 0 && isIdentifierPart(line.charAt(start - 1))) {
		start -= 1;
	}
	let end = column;
	while (end < line.length && isIdentifierPart(line.charAt(end))) {
		end += 1;
	}
	return line.slice(start, end);
}

function resolveIdentifierPathAt(line: string, column: number): string | null {
	if (column < 0 || column >= line.length) {
		return null;
	}
	let start = column;
	while (start > 0) {
		const prev = line.charAt(start - 1);
		if (isIdentifierPart(prev) || prev === '.' || prev === ':') {
			start -= 1;
			continue;
		}
		break;
	}
	while (start < line.length && !isIdentifierStart(line.charAt(start))) {
		if (start >= column) {
			return null;
		}
		start += 1;
	}
	if (!isIdentifierStart(line.charAt(start))) {
		return null;
	}
	const path = readIdentifierPath(line, start);
	if (path.segments.length === 0) {
		return null;
	}
	let inside = false;
	for (let index = 0; index < path.segments.length; index += 1) {
		const segment = path.segments[index];
		if (column >= segment.start && column < segment.end) {
			inside = true;
			break;
		}
	}
	if (!inside) {
		return null;
	}
	const names: string[] = [];
	for (let index = 0; index < path.segments.length; index += 1) {
		const segment = path.segments[index];
		names.push(line.slice(segment.start, segment.end));
	}
	return names.join('.');
}

function resolveColorForSymbolKind(kind: SymbolKind): number {
	switch (kind) {
		case 'parameter':
			return constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_PARAMETER;
		case 'local':
			return constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_LOCAL_FUNCTION;
		case 'function':
			return constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_FUNCTION_HANDLE;
		case 'global':
			return constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_GLOBAL_VARIABLE;
		case 'tableField':
			return constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_LOCAL_TABLE_FIELD;
		case 'module':
			return constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_MODULE;
		case 'type':
			return constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_TYPE;
		case 'label':
			return constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_LABEL;
		case 'keyword':
			return constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_KEYWORD;
		default:
			return constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT;
	}
}

function highlightCommentAnnotations(line: string, start: number, end: number, columnColors: number[]): void {
	const upper = line.toUpperCase();
	for (let annotationIndex = 0; annotationIndex < COMMENT_ANNOTATIONS.length; annotationIndex += 1) {
		const annotation = COMMENT_ANNOTATIONS[annotationIndex];
		let matchIndex = upper.indexOf(annotation, start);
		while (matchIndex !== -1 && matchIndex < end) {
			const limit = Math.min(end, matchIndex + annotation.length);
			for (let column = matchIndex; column < limit; column += 1) columnColors[column] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_KEYWORD;
			matchIndex = upper.indexOf(annotation, matchIndex + annotation.length);
		}
	}
}

function highlightComment(line: string, start: number, columnColors: number[]): number {
	const length = line.length;
	if (line.startsWith('--[', start)) {
		const blockMatch = line.slice(start + 2).match(/^\[=*\[/);
		if (blockMatch) {
			const equalsCount = blockMatch[0].length - 2;
			const terminator = ']' + '='.repeat(equalsCount) + ']';
			const searchStart = start + 2 + blockMatch[0].length;
			const closeIndex = line.indexOf(terminator, searchStart);
			const end = closeIndex !== -1 ? closeIndex + terminator.length : length;
			for (let index = start; index < end; index += 1) columnColors[index] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_COMMENT;
			highlightCommentAnnotations(line, start, end, columnColors);
			return end;
		}
	}
	for (let index = start; index < length; index += 1) columnColors[index] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_COMMENT;
	highlightCommentAnnotations(line, start, length, columnColors);
	return length;
}

function highlightScopedLabel(line: string, start: number, columnColors: number[]): number {
	if (!line.startsWith('::', start)) return start;
	let index = start + 2;
	index = skipWhitespace(line, index);
	if (index >= line.length || !isIdentifierStart(line.charAt(index))) return start;
	const labelStart = index;
	const labelEnd = readIdentifier(line, labelStart);
	index = skipWhitespace(line, labelEnd);
	if (!line.startsWith('::', index)) return start;
	const end = index + 2;
	for (let column = start; column < end; column += 1) columnColors[column] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_LABEL;
	return end;
}

function highlightFunctionNamePath(line: string, start: number, columnColors: number[]): number {
	let index = start;
	const segments: Array<{ start: number; end: number }> = [];
	while (index < line.length && isIdentifierStart(line.charAt(index))) {
		const segmentStart = index;
		index = readIdentifier(line, index);
		segments.push({ start: segmentStart, end: index });
		if (index < line.length && (line.charAt(index) === '.' || line.charAt(index) === ':')) {
			columnColors[index] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_OPERATOR;
			index += 1;
			continue;
		}
		break;
	}
	for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
		const segment = segments[segmentIndex];
		for (let column = segment.start; column < segment.end; column += 1) {
			columnColors[column] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_FUNCTION_NAME;
		}
	}
	return index;
}

function highlightParameterList(line: string, openParenIndex: number, columnColors: number[]): number {
	const length = line.length;
	columnColors[openParenIndex] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_OPERATOR;
	let index = openParenIndex + 1;
	while (index < length) {
		index = skipWhitespace(line, index);
		if (index >= length) break;
		const ch = line.charAt(index);
		if (ch === ')') {
			columnColors[index] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_OPERATOR;
			return index + 1;
		}
		if (index + 3 <= length && line.slice(index, index + 3) === '...') {
			columnColors[index] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_PARAMETER;
			columnColors[index + 1] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_PARAMETER;
			columnColors[index + 2] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_PARAMETER;
			index += 3;
			continue;
		}
		if (isIdentifierStart(ch)) {
			const end = readIdentifier(line, index);
			for (let column = index; column < end; column += 1) columnColors[column] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_PARAMETER;
			index = end;
			continue;
		}
		columnColors[index] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_OPERATOR;
		index += 1;
	}
	return length;
}

function highlightFunctionSignature(line: string, start: number, columnColors: number[]): number {
	let index = skipWhitespace(line, start);
	index = highlightFunctionNamePath(line, index, columnColors);
	index = skipWhitespace(line, index);
	if (index < line.length && line.charAt(index) === '(') {
		return highlightParameterList(line, index, columnColors);
	}
	return index;
}

function highlightGotoLabel(line: string, start: number, columnColors: number[]): number {
	let index = skipWhitespace(line, start);
	if (index >= line.length || !isIdentifierStart(line.charAt(index))) return index;
	const labelEnd = readIdentifier(line, index);
	for (let column = index; column < labelEnd; column += 1) columnColors[column] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_LABEL;
	return labelEnd;
}

function highlightBuiltinIdentifierPath(line: string, path: IdentifierPath, builtinLookup: BuiltinLookup, columnColors: number[]): number | null {
	const names: string[] = [];
	for (let index = 0; index < path.segments.length; index += 1) {
		const segment = path.segments[index];
		names.push(line.slice(segment.start, segment.end));
	}
	for (let length = names.length; length >= 1; length -= 1) {
		const candidate = names.slice(0, length).join('.');
		if (!builtinLookup(candidate)) {
			continue;
		}
		for (let segmentIndex = 0; segmentIndex < length; segmentIndex += 1) {
			const segment = path.segments[segmentIndex];
			for (let column = segment.start; column < segment.end; column += 1) {
				columnColors[column] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_BUILTIN;
			}
			if (segmentIndex < length - 1) {
				const delimiterColumn = path.delimiters[segmentIndex];
				columnColors[delimiterColumn] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_OPERATOR;
			}
		}
		return path.segments[length - 1].end;
	}
	if (names.length > 1 && builtinLookup(names[0])) {
		for (let segmentIndex = 0; segmentIndex < names.length; segmentIndex += 1) {
			const segment = path.segments[segmentIndex];
			for (let column = segment.start; column < segment.end; column += 1) {
				columnColors[column] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_BUILTIN;
			}
			if (segmentIndex < path.delimiters.length) {
				columnColors[path.delimiters[segmentIndex]] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_OPERATOR;
			}
		}
		return path.segments[path.segments.length - 1].end;
	}
	return null;
}

function applySemanticAnnotations(
	line: string,
	columnColors: number[],
	annotations: SemanticAnnotations[number] | undefined,
	builtinLookup: BuiltinLookup,
): void {
	if (!annotations) {
		return;
	}
	for (let index = 0; index < annotations.length; index += 1) {
		const annotation = annotations[index];
		if (annotation.role === 'definition' && annotation.kind === 'function') {
			continue;
		}
		const start = Math.max(0, Math.min(annotation.start, columnColors.length));
		const rawEnd = Math.max(annotation.end, start);
		if (start >= columnColors.length) {
			continue;
		}
		const end = Math.min(rawEnd, columnColors.length);
		let skip = false;
		if (annotation.role === 'usage' && annotation.kind === 'tableField') {
			const pathName = resolveIdentifierPathAt(line, start);
			if (pathName && builtinLookup(pathName)) {
				skip = true;
			}
		}
		if (annotation.role === 'usage' && (annotation.kind === 'global' || annotation.kind === 'function')) {
			const searchStart = Math.max(0, start - 1);
			const searchEnd = Math.min(columnColors.length, Math.max(end + 1, searchStart + 1));
			for (let column = searchStart; column < searchEnd; column += 1) {
				if (columnColors[column] !== constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_BUILTIN) {
					continue;
				}
				const identifier = extractIdentifierAt(line, column);
				if (identifier.length === 0) {
					continue;
				}
				if (builtinLookup(identifier)) {
					skip = true;
					break;
				}
			}
			if (!skip) {
				const trimmed = line.slice(start, Math.min(rawEnd, line.length)).trim();
				if (trimmed.length > 0 && builtinLookup(trimmed)) {
					skip = true;
				}
			}
		}
		if (skip) {
			continue;
		}
		const color = resolveColorForSymbolKind(annotation.kind);
		for (let column = start; column < end && column < columnColors.length; column += 1) {
			columnColors[column] = color;
		}
	}
}

export function highlightLine(
	source: readonly string[] | string,
	rowOrSemantics?: number | SemanticAnnotations | null,
	maybeSemantics?: SemanticAnnotations | null,
	builtinIdentifiers?: Iterable<string> | null,
): HighlightLine {
	let lines: readonly string[];
	let row = 0;
	let annotations: SemanticAnnotations | null = null;
	let builtinCollection: Iterable<string> | null | undefined = builtinIdentifiers ?? null;
	if (typeof source === 'string') {
		lines = [source];
		row = 0;
	} else {
		lines = source;
		if (typeof rowOrSemantics === 'number') {
			row = rowOrSemantics;
			annotations = maybeSemantics ?? null;
		} else {
			annotations = rowOrSemantics ?? null;
			if (builtinIdentifiers === undefined && maybeSemantics !== undefined) {
				builtinCollection = maybeSemantics as Iterable<string> | null | undefined;
			}
		}
	}
	if (builtinIdentifiers !== undefined) {
		builtinCollection = builtinIdentifiers;
	}
	const line = row >= 0 && row < lines.length ? lines[row] ?? '' : '';
	const length = line.length;
	const columnColors: number[] = new Array(length).fill(constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT);
	const builtinLookup = getBuiltinLookup(builtinCollection);
	let i = 0;
	while (i < length) {
		if (i === 0 && line.startsWith('#!')) {
			for (let column = 0; column < length; column += 1) columnColors[column] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_COMMENT;
			break;
		}
		if (line.startsWith('--', i)) {
			i = highlightComment(line, i, columnColors);
			continue;
		}
		const labelEnd = highlightScopedLabel(line, i, columnColors);
		if (labelEnd > i) {
			i = labelEnd;
			continue;
		}
		const longStringMatch = line.slice(i).match(/^\[=*\[/);
		if (longStringMatch) {
			const equalsCount = longStringMatch[0].length - 2;
			const terminator = ']' + '='.repeat(equalsCount) + ']';
			const closeIndex = line.indexOf(terminator, i + longStringMatch[0].length);
			const end = closeIndex !== -1 ? closeIndex + terminator.length : length;
			for (let column = i; column < end; column += 1) columnColors[column] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_STRING;
			i = end;
			continue;
		}
		const ch = line.charAt(i);
		if (ch === '"' || ch === '\'') {
			const delimiter = ch;
			columnColors[i] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_STRING;
			i += 1;
			while (i < length) {
				const current = line.charAt(i);
				columnColors[i] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_STRING;
				if (current === '\\' && i + 1 < length) {
					columnColors[i + 1] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_STRING;
					i += 2;
					continue;
				}
				if (current === delimiter) {
					i += 1;
					break;
				}
				i += 1;
			}
			continue;
		}
		if (i + 3 <= length && line.slice(i, i + 3) === '...') {
			columnColors[i] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_OPERATOR;
			columnColors[i + 1] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_OPERATOR;
			columnColors[i + 2] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_OPERATOR;
			i += 3;
			continue;
		}
		if (i + 2 <= length) {
			const pair = line.slice(i, i + 2);
			if (MULTI_CHAR_OPERATORS.has(pair)) {
				columnColors[i] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_OPERATOR;
				columnColors[i + 1] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_OPERATOR;
				i += 2;
				continue;
			}
		}
		if (isNumberStart(line, i)) {
			const end = readNumber(line, i);
			for (let column = i; column < end; column += 1) columnColors[column] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_NUMBER;
			i = end;
			continue;
		}
		if (isIdentifierStart(ch)) {
			const path = readIdentifierPath(line, i);
			const first = path.segments[0];
			const word = line.slice(first.start, first.end);
			const lowerWord = word.toLowerCase();
			if (KEYWORDS.has(lowerWord)) {
				for (let column = first.start; column < first.end; column += 1) {
					columnColors[column] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_KEYWORD;
				}
			}
			const builtinEnd = highlightBuiltinIdentifierPath(line, path, builtinLookup, columnColors);
			if (builtinEnd !== null) {
				i = builtinEnd;
				continue;
			}
			if (lowerWord === 'function') {
				i = highlightFunctionSignature(line, first.end, columnColors);
				continue;
			}
			if (lowerWord === 'goto') {
				i = highlightGotoLabel(line, first.end, columnColors);
				continue;
			}
			if (lowerWord === '::') {
				i = highlightScopedLabel(line, first.end, columnColors);
				continue;
			}
			i = first.end;
			continue;
		}
		if (isOperatorChar(ch)) {
			columnColors[i] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_OPERATOR;
		}
		i += 1;
	}

	if (annotations) {
		const lineAnnotations = row >= 0 && row < annotations.length ? annotations[row] : undefined;
		applySemanticAnnotations(line, columnColors, lineAnnotations, builtinLookup);
	}

	const chars: string[] = [];
	const colors: number[] = [];
	const columnToDisplay: number[] = [];
	for (let column = 0; column < length; column += 1) {
		columnToDisplay.push(chars.length);
		const ch = line.charAt(column);
		const color = columnColors[column];
		if (ch === '\t') {
			for (let tab = 0; tab < constants.TAB_SPACES; tab += 1) {
				chars.push(' ');
				colors.push(color);
			}
		} else {
			chars.push(ch);
			colors.push(color);
		}
	}
	columnToDisplay.push(chars.length);
	return { chars, colors, columnToDisplay };
}
