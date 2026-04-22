import type { CppToken } from './tokens';
import { cppTokenText, normalizedCppTokenText } from './tokens';

export const CPP_CONTROL_CALL_KEYWORDS = new Set([
	'catch',
	'for',
	'if',
	'return',
	'requires',
	'switch',
	'while',
]);

export const CPP_POST_FUNCTION_QUALIFIERS = new Set([
	'const',
	'final',
	'mutable',
	'noexcept',
	'override',
	'volatile',
]);

const CPP_BOOLEAN_LITERALS = new Set(['true', 'false']);
const CPP_NULL_LITERALS = new Set(['nullptr', 'NULL']);
const CPP_ASSIGNMENT_OPERATORS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^=']);
const CPP_DECLARATOR_SKIP_TOKENS = new Set(['*', '&', '&&', 'const']);
const CPP_ACCESS_CHAIN_SEPARATORS = new Set(['::', '.', '->']);
const CPP_MEMBER_ACCESS_SEPARATORS = new Set(['.', '->']);
const CPP_DELIMITERS = new Set([';', '{', '}']);
const CPP_DECLARATOR_FOLLOW_TOKENS = new Set(['{', ';']);

export type CppNestingDepth = {
	paren: number;
	bracket: number;
	brace: number;
};

export function applyCppNestingToken(text: string, depth: CppNestingDepth): boolean {
	switch (text) {
		case '(':
			depth.paren += 1;
			return true;
		case ')':
			depth.paren -= 1;
			return true;
		case '[':
			depth.bracket += 1;
			return true;
		case ']':
			depth.bracket -= 1;
			return true;
		case '{':
			depth.brace += 1;
			return true;
		case '}':
			depth.brace -= 1;
			return true;
		default:
			return false;
	}
}

export function isCppTopLevel(depth: CppNestingDepth): boolean {
	return depth.paren === 0 && depth.bracket === 0 && depth.brace === 0;
}

export function isCppEmptyStringToken(token: CppToken): boolean {
	return token.kind === 'string' && token.text === '""';
}

export function isCppBooleanToken(token: CppToken): boolean {
	return token.kind === 'id' && CPP_BOOLEAN_LITERALS.has(token.text);
}

export function isCppNullToken(token: CppToken): boolean {
	return token.kind === 'id' && CPP_NULL_LITERALS.has(token.text);
}

export function isCppAssignmentOperator(text: string): boolean {
	return CPP_ASSIGNMENT_OPERATORS.has(text);
}

export function isCppComparisonOperator(text: string): boolean {
	switch (text) {
		case '==':
		case '!=':
		case '<':
		case '<=':
		case '>':
		case '>=':
		case '<=>':
			return true;
		default:
			return false;
	}
}

export function isCppOrderingComparisonOperator(text: string): boolean {
	switch (text) {
		case '<':
		case '<=':
		case '>':
		case '>=':
			return true;
		default:
			return false;
	}
}

export function isCppAccessSeparator(text: string | undefined): boolean {
	return text !== undefined && CPP_ACCESS_CHAIN_SEPARATORS.has(text);
}

export function isCppAccessSpecifier(text: string): boolean {
	switch (text) {
		case 'public':
		case 'private':
		case 'protected':
			return true;
		default:
			return false;
	}
}

export function isCppExpressionScanBoundary(text: string): boolean {
	switch (text) {
		case ';':
		case '{':
		case '}':
		case '(':
		case ',':
		case '=':
			return true;
		default:
			return false;
	}
}

export function cppAccessChainLeafName(name: string): string {
	const arrowIndex = name.lastIndexOf('->');
	const dotIndex = name.lastIndexOf('.');
	const colonIndex = name.lastIndexOf('::');
	const separatorIndex = Math.max(arrowIndex, dotIndex, colonIndex);
	if (separatorIndex === -1) {
		return name;
	}
	if (separatorIndex === arrowIndex || separatorIndex === colonIndex) {
		return name.slice(separatorIndex + 2);
	}
	return name.slice(separatorIndex + 1);
}

export function cppQualifiedNameHasLeaf(name: string, leaf: string): boolean {
	return cppAccessChainLeafName(name) === leaf;
}

export function isCppClockNowCallTarget(text: string): boolean {
	const target = text.endsWith('()') ? text.slice(0, -2) : text;
	switch (target) {
		case 'std::chrono::steady_clock::now':
		case 'std::chrono::system_clock::now':
		case 'std::chrono::high_resolution_clock::now':
		case 'Clock::now':
		case 'FrameClock::now':
			return true;
		default:
			return false;
	}
}

export function previousCppIdentifier(tokens: readonly CppToken[], index: number): number {
	for (let current = index - 1; current >= 0; current -= 1) {
		if (tokens[current].kind === 'id') {
			return current;
		}
		if (!CPP_DECLARATOR_SKIP_TOKENS.has(tokens[current].text)) {
			break;
		}
	}
	return -1;
}

export function findCppAccessChainStart(tokens: readonly CppToken[], nameIndex: number): number {
	let start = nameIndex;
	while (start >= 2) {
		if (!isCppAccessSeparator(tokens[start - 1].text)) {
			break;
		}
		if (tokens[start - 2].kind !== 'id' && tokens[start - 2].text !== 'this') {
			break;
		}
		start -= 2;
	}
	if (start >= 1 && tokens[start - 1].text === '~') {
		start -= 1;
	}
	return start;
}

export function cppCallTarget(tokens: readonly CppToken[], openParen: number): string | null {
	const nameIndex = openParen - 1;
	if (nameIndex < 0 || tokens[nameIndex].kind !== 'id') {
		return null;
	}
	if (CPP_CONTROL_CALL_KEYWORDS.has(tokens[nameIndex].text)) {
		return null;
	}
	const start = findCppAccessChainStart(tokens, nameIndex);
	return cppTokenText(tokens, start, openParen);
}

export function countCppParameters(tokens: readonly CppToken[], openParen: number, closeParen: number): number {
	if (closeParen <= openParen + 1) {
		return 0;
	}
	if (closeParen === openParen + 2 && tokens[openParen + 1].text === 'void') {
		return 0;
	}
	let count = 1;
	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;
	for (let index = openParen + 1; index < closeParen; index += 1) {
		const text = tokens[index].text;
		if (text === '(') parenDepth += 1;
		else if (text === ')') parenDepth -= 1;
		else if (text === '[') bracketDepth += 1;
		else if (text === ']') bracketDepth -= 1;
		else if (text === '{') braceDepth += 1;
		else if (text === '}') braceDepth -= 1;
		else if (text === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) count += 1;
	}
	return count;
}

export function callAnyArgumentHasToken(
	tokens: readonly CppToken[],
	openParen: number,
	closeParen: number,
	predicate: (token: CppToken) => boolean,
): boolean {
	for (let index = openParen + 1; index < closeParen; index += 1) {
		if (predicate(tokens[index])) {
			return true;
		}
	}
	return false;
}

export function callFirstArgumentHasToken(
	tokens: readonly CppToken[],
	openParen: number,
	closeParen: number,
	predicate: (token: CppToken) => boolean,
): boolean {
	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;
	for (let index = openParen + 1; index < closeParen; index += 1) {
		const token = tokens[index];
		const text = token.text;
		if (text === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
			return false;
		}
		if (predicate(token)) {
			return true;
		}
		switch (text) {
			case '(':
				parenDepth += 1;
				break;
			case ')':
				parenDepth -= 1;
				break;
			case '[':
				bracketDepth += 1;
				break;
			case ']':
				bracketDepth -= 1;
				break;
			case '{':
				braceDepth += 1;
				break;
			case '}':
				braceDepth -= 1;
				break;
			default:
				break;
		}
	}
	return false;
}

export function findTopLevelCppSemicolon(tokens: readonly CppToken[], start: number, end: number): number {
	return findTopLevelCppToken(tokens, start, end, token => token.text === ';');
}

export function findTopLevelCppOperator(tokens: readonly CppToken[], start: number, end: number, operator: string): number {
	return findTopLevelCppToken(tokens, start, end, token => token.text === operator);
}

export function findTopLevelCppToken(tokens: readonly CppToken[], start: number, end: number, predicate: (token: CppToken, index: number) => boolean): number {
	const depth: CppNestingDepth = { paren: 0, bracket: 0, brace: 0 };
	for (let index = start; index < end; index += 1) {
		const text = tokens[index].text;
		if (applyCppNestingToken(text, depth)) {
			continue;
		}
		if (isCppTopLevel(depth) && predicate(tokens[index], index)) {
			return index;
		}
	}
	return -1;
}

export function cppRangeIsNull(tokens: readonly CppToken[], start: number, end: number): boolean {
	while (start < end && tokens[start].text === '(' && tokens[end - 1]?.text === ')') {
		start += 1;
		end -= 1;
	}
	return end === start + 1 && isCppNullToken(tokens[start]);
}

export function cppStatementReturnsNull(tokens: readonly CppToken[], start: number, end: number): boolean {
	return tokens[start]?.text === 'return' && end === start + 2 && cppRangeIsNull(tokens, start + 1, end);
}

export function cppNullishGuardExpression(tokens: readonly CppToken[], start: number, end: number): string | null {
	const orIndex = findTopLevelCppOperator(tokens, start, end, '||');
	if (orIndex >= 0) {
		const left = cppNullishGuardExpression(tokens, start, orIndex);
		const right = cppNullishGuardExpression(tokens, orIndex + 1, end);
		return left !== null && left === right ? left : null;
	}
	const equalsIndex = findTopLevelCppOperator(tokens, start, end, '==');
	if (equalsIndex < 0) {
		return null;
	}
	if (cppRangeIsNull(tokens, start, equalsIndex)) {
		return trimmedCppExpressionText(tokens, equalsIndex + 1, end);
	}
	if (cppRangeIsNull(tokens, equalsIndex + 1, end)) {
		return trimmedCppExpressionText(tokens, start, equalsIndex);
	}
	return null;
}

export function cppExpressionUsesAccessedValue(expression: string, guardedExpression: string): boolean {
	return expression === guardedExpression
		|| expression.startsWith(`${guardedExpression}.`)
		|| expression.startsWith(`${guardedExpression}->`)
		|| expression.startsWith(`${guardedExpression}[`);
}

export function cppCallTargetFromStatement(tokens: readonly CppToken[], pairs: readonly number[], start: number, end: number): string | null {
	let expressionStart = start;
	if (tokens[expressionStart]?.text === 'return') {
		expressionStart += 1;
	}
	for (let index = expressionStart; index < end; index += 1) {
		if (tokens[index].text !== '(' || pairs[index] < 0 || pairs[index] > end) {
			continue;
		}
		const target = cppCallTarget(tokens, index);
		if (target !== null) {
			return target;
		}
	}
	return null;
}

export function collectCppStatementRanges(tokens: readonly CppToken[], start: number, end: number): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	let statementStart = start;
	let parenDepth = 0;
	let bracketDepth = 0;
	for (let index = start; index < end; index += 1) {
		const text = tokens[index].text;
		if (text === '(') parenDepth += 1;
		else if (text === ')') parenDepth -= 1;
		else if (text === '[') bracketDepth += 1;
		else if (text === ']') bracketDepth -= 1;
		else if (text === '{' || text === '}') statementStart = index + 1;
		else if (text === ';' && parenDepth === 0 && bracketDepth === 0) {
			if (statementStart < index) {
				ranges.push([statementStart, index]);
			}
			statementStart = index + 1;
		}
	}
	return ranges;
}

export function hasCppDeclarationPrefix(tokens: readonly CppToken[], start: number, nameIndex: number): boolean {
	if (nameIndex <= start) {
		return false;
	}
	if (tokens[nameIndex - 1].text === '::') {
		return false;
	}
	for (let index = start; index < nameIndex; index += 1) {
		const text = tokens[index].text;
		if (CPP_MEMBER_ACCESS_SEPARATORS.has(text) || text === ';') {
			return false;
		}
	}
	return !CPP_MEMBER_ACCESS_SEPARATORS.has(tokens[nameIndex - 1].text);
}

export function findPreviousCppDelimiter(tokens: readonly CppToken[], index: number): number {
	for (let current = index - 1; current >= 0; current -= 1) {
		const text = tokens[current].text;
		if (CPP_DELIMITERS.has(text)) {
			return current;
		}
	}
	return -1;
}

export function findNextCppDelimiter(tokens: readonly CppToken[], index: number): number {
	for (let current = index + 1; current < tokens.length; current += 1) {
		const text = tokens[current].text;
		if (CPP_DELIMITERS.has(text)) {
			return current;
		}
	}
	return tokens.length;
}

export function findCppTernaryColon(tokens: readonly CppToken[], questionIndex: number, end: number): number {
	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;
	let nestedTernary = 0;
	for (let index = questionIndex + 1; index < end; index += 1) {
		const text = tokens[index].text;
		if (text === '(') parenDepth += 1;
		else if (text === ')') parenDepth -= 1;
		else if (text === '[') bracketDepth += 1;
		else if (text === ']') bracketDepth -= 1;
		else if (text === '{') braceDepth += 1;
		else if (text === '}') braceDepth -= 1;
		else if (text === '?' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) nestedTernary += 1;
		else if (text === ':' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
			if (nestedTernary === 0) {
				return index;
			}
			nestedTernary -= 1;
		}
	}
	return -1;
}

export function cppRangeHas(tokens: readonly CppToken[], start: number, end: number, predicate: (token: CppToken) => boolean): boolean {
	for (let index = start; index < end; index += 1) {
		if (predicate(tokens[index])) {
			return true;
		}
	}
	return false;
}

export function trimmedCppExpressionText(tokens: readonly CppToken[], start: number, end: number): string {
	while (start < end && (tokens[start].text === 'return' || tokens[start].text === '(')) {
		start += 1;
	}
	while (end > start && tokens[end - 1].text === ')') {
		end -= 1;
	}
	return normalizedCppTokenText(tokens, start, end);
}

export function stripCppWrappingParens(tokens: readonly CppToken[], pairs: readonly number[], start: number, end: number): [number, number] {
	while (start < end && tokens[start]?.text === '(' && pairs[start] === end - 1) {
		start += 1;
		end -= 1;
	}
	return [start, end];
}

export function cppRangeIsIdentifier(tokens: readonly CppToken[], pairs: readonly number[], start: number, end: number, name: string): boolean {
	[start, end] = stripCppWrappingParens(tokens, pairs, start, end);
	return end === start + 1 && tokens[start].text === name;
}

export function cppRangeIsNumericLiteral(tokens: readonly CppToken[], pairs: readonly number[], start: number, end: number): boolean {
	[start, end] = stripCppWrappingParens(tokens, pairs, start, end);
	if (tokens[start]?.text === '-' || tokens[start]?.text === '+') {
		start += 1;
	}
	return end === start + 1 && tokens[start]?.kind === 'number';
}

export function cppRangeIsOrderingComparisonWithIdentifierAndNumericLiteral(tokens: readonly CppToken[], pairs: readonly number[], start: number, end: number, name: string): boolean {
	[start, end] = stripCppWrappingParens(tokens, pairs, start, end);
	const operatorIndex = findTopLevelCppToken(tokens, start, end, token => isCppOrderingComparisonOperator(token.text));
	return operatorIndex >= 0 && (
		cppRangeIsIdentifier(tokens, pairs, start, operatorIndex, name) && cppRangeIsNumericLiteral(tokens, pairs, operatorIndex + 1, end)
		|| cppRangeIsIdentifier(tokens, pairs, operatorIndex + 1, end, name) && cppRangeIsNumericLiteral(tokens, pairs, start, operatorIndex)
	);
}

export function cppStatementOrBlockEnd(tokens: readonly CppToken[], pairs: readonly number[], start: number, end: number): number {
	if (start >= end) {
		return -1;
	}
	if (tokens[start].text === '{') {
		const close = pairs[start];
		return close >= 0 && close < end ? close : -1;
	}
	return findTopLevelCppSemicolon(tokens, start, end);
}

export function cppStatementOrBlockAssignsIdentifier(tokens: readonly CppToken[], start: number, end: number, name: string): boolean {
	if (end < start) {
		return false;
	}
	if (tokens[start]?.text === '{') {
		start += 1;
	}
	const ranges = collectCppStatementRanges(tokens, start, end);
	for (let index = 0; index < ranges.length; index += 1) {
		const statementStart = ranges[index][0];
		const statementEnd = ranges[index][1];
		const assignmentIndex = findTopLevelCppOperator(tokens, statementStart, statementEnd, '=');
		if (assignmentIndex >= 0 && trimmedCppExpressionText(tokens, statementStart, assignmentIndex) === name) {
			return true;
		}
	}
	return false;
}

export function splitCppArgumentRanges(tokens: readonly CppToken[], start: number, end: number): Array<[number, number]> {
	const result: Array<[number, number]> = [];
	let argumentStart = start;
	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;
	for (let index = start; index <= end; index += 1) {
		if (index === end || tokens[index].text === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
			if (argumentStart < index) {
				result.push([argumentStart, index]);
			}
			argumentStart = index + 1;
			continue;
		}
		const text = tokens[index].text;
		switch (text) {
			case '(':
				parenDepth += 1;
				break;
			case ')':
				parenDepth -= 1;
				break;
			case '[':
				bracketDepth += 1;
				break;
			case ']':
				bracketDepth -= 1;
				break;
			case '{':
				braceDepth += 1;
				break;
			case '}':
				braceDepth -= 1;
				break;
		}
	}
	return result;
}

export function findNextCppTokenText(tokens: readonly CppToken[], start: number, end: number, text: string): number {
	for (let index = start; index < end; index += 1) {
		if (tokens[index].text === text) {
			return index;
		}
	}
	return -1;
}

export function isCppFunctionDeclaratorParen(tokens: readonly CppToken[], pairs: readonly number[], openParen: number): boolean {
	const closeParen = pairs[openParen];
	let cursor = closeParen + 1;
	while (cursor < tokens.length && CPP_POST_FUNCTION_QUALIFIERS.has(tokens[cursor].text)) {
		cursor += 1;
	}
	if (!CPP_DECLARATOR_FOLLOW_TOKENS.has(tokens[cursor]?.text)) {
		return false;
	}
	const nameIndex = openParen - 1;
	if (nameIndex < 0 || tokens[nameIndex].kind !== 'id') {
		return false;
	}
	const declarationStart = findPreviousCppDelimiter(tokens, nameIndex) + 1;
	return hasCppDeclarationPrefix(tokens, declarationStart, nameIndex);
}

export const isEmptyStringToken = isCppEmptyStringToken;
export const isBooleanToken = isCppBooleanToken;
export const isNullToken = isCppNullToken;
export const isAssignmentOperator = isCppAssignmentOperator;
export const isComparisonOperator = isCppComparisonOperator;
export const isAccessSeparator = isCppAccessSeparator;
export const isAccessSpecifier = isCppAccessSpecifier;
export const isExpressionScanBoundary = isCppExpressionScanBoundary;
export const isClockNowCallTarget = isCppClockNowCallTarget;
export const previousIdentifier = previousCppIdentifier;
export const findAccessChainStart = findCppAccessChainStart;
export const countParameters = countCppParameters;
export const findTopLevelSemicolon = findTopLevelCppSemicolon;
export const findTopLevelOperator = findTopLevelCppOperator;
export const findTopLevelToken = findTopLevelCppToken;
export const callTargetFromStatement = cppCallTargetFromStatement;
export const collectStatementRanges = collectCppStatementRanges;
export const hasDeclarationPrefix = hasCppDeclarationPrefix;
export const findPreviousDelimiter = findPreviousCppDelimiter;
export const findNextDelimiter = findNextCppDelimiter;
export const findTernaryColon = findCppTernaryColon;
export const trimmedExpressionText = trimmedCppExpressionText;
export const stripWrappingParens = stripCppWrappingParens;
export const splitArgumentRanges = splitCppArgumentRanges;
export const findNextTokenText = findNextCppTokenText;
export const isFunctionDeclaratorParen = isCppFunctionDeclaratorParen;
