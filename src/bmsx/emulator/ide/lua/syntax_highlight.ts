import type { SemanticAnnotations, SymbolKind } from '../contrib/intellisense/semantic_model';
import type { HighlightLine } from '../core/types';
import * as constants from '../core/constants';
import { DEFAULT_LUA_BUILTIN_NAMES } from '../../lua_builtin_descriptors';
import { LuaLexer } from '../../../lua/syntax/lualexer';
import { KEYWORDS } from '../../../lua/syntax/luatoken';
import { clamp } from '../../../utils/clamp';
import { ScratchBuffer } from '../../../utils/scratchbuffer';

// Lightweight Lua syntax highlighter used by the IDE.
// Pure functions with no runtime/editor state dependencies beyond provided inputs.

const TAB_EXPANSION = ' '.repeat(constants.TAB_SPACES);

function isDigit(ch: string): boolean {
	return LuaLexer.isDigit(ch);
}

function isHexDigit(ch: string): boolean {
	return LuaLexer.isHexDigit(ch);
}

function isIdentifierStart(ch: string): boolean {
	return LuaLexer.isIdentifierStart(ch);
}

function isIdentifierPart(ch: string): boolean {
	return LuaLexer.isIdentifierPart(ch);
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

const createNumber = (): number => 0;
const identifierPathStartScratch = new ScratchBuffer<number>(createNumber, 8);
const identifierPathEndScratch = new ScratchBuffer<number>(createNumber, 8);
const identifierPathDelimiterScratch = new ScratchBuffer<number>(createNumber, 8);
const functionNamePathStartScratch = new ScratchBuffer<number>(createNumber, 8);
const functionNamePathEndScratch = new ScratchBuffer<number>(createNumber, 8);

function readIdentifierPath(line: string, start: number): void {
	identifierPathStartScratch.clear();
	identifierPathEndScratch.clear();
	identifierPathDelimiterScratch.clear();
	let index = start;
	while (index < line.length && isIdentifierStart(line.charAt(index))) {
		const segmentStart = index;
		index = readIdentifier(line, index);
		identifierPathStartScratch.push(segmentStart);
		identifierPathEndScratch.push(index);
		if (index >= line.length) {
			break;
		}
		const separator = line.charAt(index);
		if ((separator === '.' || separator === ':') && index + 1 < line.length && isIdentifierStart(line.charAt(index + 1))) {
			identifierPathDelimiterScratch.push(index);
			index += 1;
			continue;
		}
		break;
	}
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

function getBuiltinLookup(extra: Iterable<string>): BuiltinLookup {
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

function resolveIdentifierPathAt(line: string, column: number): string {
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
	readIdentifierPath(line, start);
	const segmentCount = identifierPathStartScratch.size;
	if (segmentCount === 0) {
		return null;
	}
	let inside = false;
	for (let index = 0; index < segmentCount; index += 1) {
		const segmentStart = identifierPathStartScratch.peek(index);
		const segmentEnd = identifierPathEndScratch.peek(index);
		if (column >= segmentStart && column < segmentEnd) {
			inside = true;
			break;
		}
	}
	if (!inside) {
		return null;
	}
	return line.slice(identifierPathStartScratch.peek(0), identifierPathEndScratch.peek(segmentCount - 1));
}

function resolveColorForSymbolKind(kind: SymbolKind): number {
	switch (kind) {
		case 'parameter':
			return constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_PARAMETER;
		case 'local':
			return constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_LOCAL_FUNCTION;
		case 'constant':
			return constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_LOCAL_TOP;
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
	functionNamePathStartScratch.clear();
	functionNamePathEndScratch.clear();
	let index = start;
	while (index < line.length && isIdentifierStart(line.charAt(index))) {
		const segmentStart = index;
		index = readIdentifier(line, index);
		functionNamePathStartScratch.push(segmentStart);
		functionNamePathEndScratch.push(index);
		if (index < line.length && (line.charAt(index) === '.' || line.charAt(index) === ':')) {
			columnColors[index] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_OPERATOR;
			index += 1;
			continue;
		}
		break;
	}
	for (let segmentIndex = 0; segmentIndex < functionNamePathStartScratch.size; segmentIndex += 1) {
		const segmentStart = functionNamePathStartScratch.peek(segmentIndex);
		const segmentEnd = functionNamePathEndScratch.peek(segmentIndex);
		for (let column = segmentStart; column < segmentEnd; column += 1) {
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

function highlightBuiltinIdentifierPath(line: string, builtinLookup: BuiltinLookup, columnColors: number[]): number {
	const segmentCount = identifierPathStartScratch.size;
	for (let length = segmentCount; length >= 1; length -= 1) {
		const candidate = line.slice(identifierPathStartScratch.peek(0), identifierPathEndScratch.peek(length - 1));
		if (!builtinLookup(candidate)) {
			continue;
		}
		for (let segmentIndex = 0; segmentIndex < length; segmentIndex += 1) {
			const segmentStart = identifierPathStartScratch.peek(segmentIndex);
			const segmentEnd = identifierPathEndScratch.peek(segmentIndex);
			for (let column = segmentStart; column < segmentEnd; column += 1) {
				columnColors[column] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_BUILTIN;
			}
			if (segmentIndex < length - 1) {
				const delimiterColumn = identifierPathDelimiterScratch.peek(segmentIndex);
				columnColors[delimiterColumn] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_OPERATOR;
			}
		}
		return identifierPathEndScratch.peek(length - 1);
	}
	const head = line.slice(identifierPathStartScratch.peek(0), identifierPathEndScratch.peek(0));
	if (segmentCount > 1 && builtinLookup(head)) {
		for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
			const segmentStart = identifierPathStartScratch.peek(segmentIndex);
			const segmentEnd = identifierPathEndScratch.peek(segmentIndex);
			for (let column = segmentStart; column < segmentEnd; column += 1) {
				columnColors[column] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_BUILTIN;
			}
			if (segmentIndex < identifierPathDelimiterScratch.size) {
				columnColors[identifierPathDelimiterScratch.peek(segmentIndex)] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_OPERATOR;
			}
		}
		return identifierPathEndScratch.peek(segmentCount - 1);
	}
	return null;
}

function applySemanticAnnotations(
	line: string,
	columnColors: number[],
	annotations: SemanticAnnotations[number],
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
		const start = clamp(annotation.start, 0, columnColors.length);
		const rawEnd = Math.max(annotation.end, start);
		if (start >= columnColors.length) {
			continue;
		}
		const end = Math.min(rawEnd, columnColors.length);
			const path = resolveIdentifierPathAt(line, start);
			const tokenText = line.slice(start, Math.min(rawEnd, line.length)).trim();
			const isBuiltin = (path && builtinLookup(path)) || (tokenText.length > 0 && builtinLookup(tokenText));
			const color = isBuiltin ? constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_BUILTIN : resolveColorForSymbolKind(annotation.kind);
		for (let column = start; column < end && column < columnColors.length; column += 1) {
			columnColors[column] = color;
		}
	}
}

export function highlightLine(
	source: readonly string[] | string,
	rowOrSemantics?: number | SemanticAnnotations,
	maybeSemantics?: SemanticAnnotations,
	builtinIdentifiers?: Iterable<string>,
): HighlightLine {
	let lines: readonly string[];
	let row = 0;
	let annotations: SemanticAnnotations = null;
	let builtinCollection: Iterable<string> = builtinIdentifiers ;
	if (typeof source === 'string') {
		lines = [source];
		row = 0;
	} else {
		lines = source;
		if (typeof rowOrSemantics === 'number') {
			row = rowOrSemantics;
			annotations = maybeSemantics ;
		} else {
			annotations = rowOrSemantics ;
			if (builtinIdentifiers === undefined && maybeSemantics !== undefined) {
				builtinCollection = maybeSemantics as Iterable<string>;
			}
		}
	}
	if (builtinIdentifiers !== undefined) {
		builtinCollection = builtinIdentifiers;
	}
	const line = row >= 0 && row < lines.length ? lines[row] ?? '' : '';
	const lineAnnotations = annotations ? (row >= 0 && row < annotations.length ? annotations[row] : undefined) : undefined;
	return highlightTextLine(line, lineAnnotations, builtinCollection);
}

export function highlightTextLine(
	line: string,
	lineAnnotations?: SemanticAnnotations[number],
	builtinIdentifiers?: Iterable<string>,
): HighlightLine {
	const length = line.length;
	const defaultColor = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT;
	const columnColors: number[] = new Array(length);
	const builtinLookup = getBuiltinLookup(builtinIdentifiers);
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
			readIdentifierPath(line, i);
			const firstStart = identifierPathStartScratch.peek(0);
			const firstEnd = identifierPathEndScratch.peek(0);
			const word = line.slice(firstStart, firstEnd);
			const lowerWord = word.toLowerCase();
			if (KEYWORDS.has(lowerWord)) {
				for (let column = firstStart; column < firstEnd; column += 1) {
					columnColors[column] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_KEYWORD;
				}
			}
			const builtinEnd = highlightBuiltinIdentifierPath(line, builtinLookup, columnColors);
			if (builtinEnd !== null) {
				i = builtinEnd;
				continue;
			}
			if (lowerWord === 'function') {
				i = highlightFunctionSignature(line, firstEnd, columnColors);
				continue;
			}
			if (lowerWord === 'goto') {
				i = highlightGotoLabel(line, firstEnd, columnColors);
				continue;
			}
			if (lowerWord === '::') {
				i = highlightScopedLabel(line, firstEnd, columnColors);
				continue;
			}
			i = firstEnd;
			continue;
		}
		if (isOperatorChar(ch)) {
			columnColors[i] = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_OPERATOR;
		}
		i += 1;
	}

	if (lineAnnotations) {
		applySemanticAnnotations(line, columnColors, lineAnnotations, builtinLookup);
	}

	const colors: number[] = [];
	const columnToDisplay: number[] = [];
	const textParts: string[] = [];
	let displayIndex = 0;
	for (let column = 0; column < length; column += 1) {
		columnToDisplay.push(displayIndex);
		const ch = line.charAt(column);
		const color = columnColors[column] ?? defaultColor;
		if (ch === '\t') {
			textParts.push(TAB_EXPANSION);
			for (let tab = 0; tab < constants.TAB_SPACES; tab += 1) colors.push(color);
			displayIndex += constants.TAB_SPACES;
		} else {
			textParts.push(ch);
			colors.push(color);
			displayIndex += 1;
		}
	}
	columnToDisplay.push(displayIndex);
	const text = textParts.join('');
	let mutated = false;
	for (let index = 0; index < text.length; index += 1) {
		const color = colors[index];
		if (color === constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_STRING) {
			continue;
		}
		const ch = text.charAt(index);
		const upper = ch.toUpperCase();
		if (upper !== ch) {
			mutated = true;
			break;
		}
	}
	const upperText = mutated
		? (() => {
			const buffer: string[] = new Array(text.length);
			for (let index = 0; index < text.length; index += 1) {
				const ch = text.charAt(index);
				buffer[index] = colors[index] === constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_STRING ? ch : ch.toUpperCase();
			}
			return buffer.join('');
		})()
		: text;
	return { text, upperText, colors, columnToDisplay };
}
