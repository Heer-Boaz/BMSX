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

export function isCppEmptyStringToken(token: CppToken): boolean {
	return token.kind === 'string' && token.text === '""';
}

export function isCppBooleanToken(token: CppToken): boolean {
	return token.kind === 'id' && (token.text === 'true' || token.text === 'false');
}

export function isCppNullToken(token: CppToken): boolean {
	return token.kind === 'id' && (token.text === 'nullptr' || token.text === 'NULL');
}

export function isCppAssignmentOperator(text: string): boolean {
	return text === '=' || text === '+=' || text === '-=' || text === '*=' || text === '/=' || text === '%=' ||
		text === '<<=' || text === '>>=' || text === '&=' || text === '|=' || text === '^=';
}

export function previousCppIdentifier(tokens: readonly CppToken[], index: number): number {
	for (let current = index - 1; current >= 0; current -= 1) {
		if (tokens[current].kind === 'id') {
			return current;
		}
		if (tokens[current].text !== '*' && tokens[current].text !== '&' && tokens[current].text !== '&&' && tokens[current].text !== 'const') {
			break;
		}
	}
	return -1;
}

export function findCppAccessChainStart(tokens: readonly CppToken[], nameIndex: number): number {
	let start = nameIndex;
	while (start >= 2) {
		const separator = tokens[start - 1].text;
		if (separator !== '::' && separator !== '.' && separator !== '->') {
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

export function findTopLevelCppSemicolon(tokens: readonly CppToken[], start: number, end: number): number {
	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;
	for (let index = start; index < end; index += 1) {
		const text = tokens[index].text;
		if (text === '(') parenDepth += 1;
		else if (text === ')') parenDepth -= 1;
		else if (text === '[') bracketDepth += 1;
		else if (text === ']') bracketDepth -= 1;
		else if (text === '{') braceDepth += 1;
		else if (text === '}') braceDepth -= 1;
		else if (text === ';' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) return index;
	}
	return -1;
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
		if (text === '.' || text === '->' || text === ';') {
			return false;
		}
	}
	return tokens[nameIndex - 1].text !== '.' && tokens[nameIndex - 1].text !== '->';
}

export function findPreviousCppDelimiter(tokens: readonly CppToken[], index: number): number {
	for (let current = index - 1; current >= 0; current -= 1) {
		const text = tokens[current].text;
		if (text === ';' || text === '{' || text === '}') {
			return current;
		}
	}
	return -1;
}

export function findNextCppDelimiter(tokens: readonly CppToken[], index: number): number {
	for (let current = index + 1; current < tokens.length; current += 1) {
		const text = tokens[current].text;
		if (text === ';' || text === '{' || text === '}') {
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
		if (text === '(') parenDepth += 1;
		else if (text === ')') parenDepth -= 1;
		else if (text === '[') bracketDepth += 1;
		else if (text === ']') bracketDepth -= 1;
		else if (text === '{') braceDepth += 1;
		else if (text === '}') braceDepth -= 1;
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
	if (tokens[cursor]?.text !== '{' && tokens[cursor]?.text !== ';') {
		return false;
	}
	const nameIndex = openParen - 1;
	if (nameIndex < 0 || tokens[nameIndex].kind !== 'id') {
		return false;
	}
	const declarationStart = findPreviousCppDelimiter(tokens, nameIndex) + 1;
	return hasCppDeclarationPrefix(tokens, declarationStart, nameIndex);
}
