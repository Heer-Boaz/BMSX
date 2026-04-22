import { CPP_CONTROL_CALL_KEYWORDS, findAccessChainStart, findNextTokenText, hasDeclarationPrefix, isAccessSeparator, isComparisonOperator, previousIdentifier, trimmedExpressionText } from '../../../../../src/bmsx/language/cpp/syntax/syntax';
import { type Token, cppTokenText } from '../../../../../src/bmsx/language/cpp/syntax/tokens';
import { hasDeclarationPrefixNoise, isIgnoredName } from './bindings';
import { HOT_PATH_TEMPORARY_TYPES } from './numeric';
import { LocalBinding } from './types';

export const DECLARATION_START_BLOCKLIST = new Set([
	'break',
	'case',
	'catch',
	'co_return',
	'continue',
	'delete',
	'do',
	'else',
	'for',
	'goto',
	'if',
	'return',
	'switch',
	'throw',
	'while',
]);

export const DECLARATION_NAME_PREFIX_BLOCKLIST = new Set([
	',',
	'.',
	'->',
	'::',
	':',
	'?',
	'(',
	'return',
	'throw',
	'<<',
	'>>',
]);

export const DECLARATION_NAME_BLOCKLIST = new Set([
	'auto',
	'bool',
	'char',
	'const',
	'double',
	'float',
	'int',
	'long',
	'return',
	'short',
	'signed',
	'static',
	'struct',
	'unsigned',
	'void',
]);

export const DECLARATION_PREFIX_ALLOWED_OPERATORS = new Set([
	'::',
	'*',
	'&',
	'&&',
	'<',
	'>',
	'>>',
]);

export const DECLARATION_PREFIX_ALLOWED_PUNCTUATION = new Set([
	',',
]);

export const NUMERIC_DEFENSIVE_CALLS = new Set([
	'clamp',
	'ceil',
	'floor',
	'isfinite',
	'max',
	'min',
	'round',
	'std::clamp',
	'std::ceil',
	'std::floor',
	'std::isfinite',
	'std::max',
	'std::min',
	'std::round',
	'std::trunc',
	'tolower',
	'std::tolower',
	'trunc',
]);

export const CPP_NORMALIZED_BODY_MIN_LENGTH = 120;

export const CPP_LOCAL_CONST_PATTERN_ENABLED = false;

export function cppWordSegments(text: string): string[] {
	const words = text.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z0-9])/g);
	return words === null ? [text.toLowerCase()] : words.map(word => word.toLowerCase());
}

export function declarationFromStatement(tokens: readonly Token[], start: number, end: number): LocalBinding | null {
	const declarationStart = start;
	let isLeadingConst = false;
	while (start < end && (tokens[start].text === 'const' || tokens[start].text === 'constexpr')) {
		isLeadingConst = true;
		start += 1;
	}
	if (start >= end || DECLARATION_START_BLOCKLIST.has(tokens[start].text)) {
		return null;
	}
	if (tokens[start].text === '*' || tokens[start].text === '&' || tokens[start].text === '&&') {
		return null;
	}
	let initializerIndex = -1;
	for (let index = start; index < end; index += 1) {
		const text = tokens[index].text;
		if (text === '=' || text === '{') {
			initializerIndex = index;
			break;
		}
		if (text === '(') {
			const nameIndex = previousIdentifier(tokens, index);
			if (nameIndex > start && hasDeclarationPrefix(tokens, start, nameIndex)) {
				initializerIndex = index;
			}
			break;
		}
	}
	if (initializerIndex < 0) {
		return null;
	}
	const nameIndex = previousIdentifier(tokens, initializerIndex);
	if (nameIndex < 0 || nameIndex <= start || !hasDeclarationPrefix(tokens, start, nameIndex)) {
		return null;
	}
	if (hasDeclarationPrefixNoise(tokens, declarationStart, nameIndex)) {
		return null;
	}
	if (DECLARATION_NAME_PREFIX_BLOCKLIST.has(tokens[nameIndex - 1].text)) {
		return null;
	}
	const nameToken = tokens[nameIndex];
	if (DECLARATION_NAME_BLOCKLIST.has(nameToken.text) || isIgnoredName(nameToken.text)) {
		return null;
	}
	const typeText = cppTokenText(tokens, declarationStart, nameIndex).replace(/\s+/g, ' ').trim();
	const initializerText = trimmedExpressionText(tokens, initializerIndex + 1, end);
	let isConst = isLeadingConst;
	let isReference = false;
	let isPointer = false;
	for (let index = declarationStart; index < nameIndex; index += 1) {
		if (tokens[index].text === 'const' || tokens[index].text === 'constexpr') {
			isConst = true;
			break;
		}
		if (tokens[index].text === '&' || tokens[index].text === '&&') {
			isReference = true;
		}
		if (tokens[index].text === '*') {
			isPointer = true;
		}
	}
	return {
		name: nameToken.text,
		nameToken: nameIndex,
		typeText,
		line: nameToken.line,
		column: nameToken.column,
		isConst,
		isReference,
		isPointer,
		hasInitializer: true,
		readCount: 0,
		writeCount: 0,
		memberAccessCount: 0,
		initializerTextLength: initializerText.length,
		isSimpleAliasInitializer: isSimpleAliasInitializer(tokens, initializerIndex + 1, end),
		firstReadLeftText: null,
		firstReadRightText: null,
	};
}

export function isSimpleAliasInitializer(tokens: readonly Token[], start: number, end: number): boolean {
	let seenToken = false;
	for (let index = start; index < end; index += 1) {
		const token = tokens[index];
		if (token.kind === 'id') {
			seenToken = true;
			continue;
		}
		if (isAccessSeparator(token.text)) {
			continue;
		}
		return false;
	}
	return seenToken;
}

export function isSingleUseSuppressingToken(text: string | null): boolean {
	if (text === null) {
		return false;
	}
	if (isAccessSeparator(text) || isComparisonOperator(text)) {
		return true;
	}
	switch (text) {
		case '&':
		case '[':
		case ']':
		case '===':
		case '!==':
		case '&&':
		case '||':
		case '??':
			return true;
		default:
			return false;
	}
}

export function isTokenTemporalSnapshotName(name: string): boolean {
	return /^(previous|prev|next|before|after|initial|was|had)[A-Z_]?/.test(name);
}

export function rangeContainsCapturingLambda(tokens: readonly Token[], start: number, end: number): boolean {
	for (let index = start; index < end; index += 1) {
		if (tokens[index].text === '[') {
			const close = findNextTokenText(tokens, index + 1, end, ']');
			if (close > index + 1 && findNextTokenText(tokens, close + 1, end, '{') >= 0) {
				return true;
			}
		}
	}
	return false;
}

export function rangeContainsTemporaryAllocation(tokens: readonly Token[], start: number, end: number): boolean {
	for (let index = start; index < end; index += 1) {
		if (tokens[index].text === 'new') {
			return true;
		}
		if (tokens[index].text === '{' && index === start) {
			return true;
		}
		if (tokens[index].kind !== 'id') {
			continue;
		}
		const chainStart = findAccessChainStart(tokens, index);
		const text = cppTokenText(tokens, chainStart, index + 1);
		if (text === 'std::make_unique' || text === 'std::make_shared' || HOT_PATH_TEMPORARY_TYPES.has(text)) {
			return true;
		}
	}
	return false;
}

export function isCallIdentifier(tokens: readonly Token[], index: number): boolean {
	const text = tokens[index].text;
	if (CPP_CONTROL_CALL_KEYWORDS.has(text)) {
		return false;
	}
	return tokens[index + 1]?.text === '(';
}
