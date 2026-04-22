import {
	CPP_CONTROL_CALL_KEYWORDS,
	CPP_POST_FUNCTION_QUALIFIERS,
	applyCppNestingToken as applyCppNestingDelta,
	cppCallTarget,
	cppCallTargetFromStatement,
	cppRangeHas,
	isCppAccessSpecifier,
	isCppTopLevel,
} from './syntax';
import { cppTokenText, type CppToken } from './tokens';

const CPP_BOUNDARY_STYLE_FUNCTION_NAME_WORDS: ReadonlySet<string> = new Set([
	'acquire',
	'add',
	'append',
	'apply',
	'attach',
	'begin',
	'bind',
	'build',
	'call',
	'capture',
	'change',
	'clear',
	'copy',
	'configure',
	'create',
	'count',
	'decode',
	'destroy',
	'disable',
	'dispose',
	'detach',
	'encode',
	'enable',
	'end',
	'ensure',
	'fault',
	'focus',
	'format',
	'get',
	'has',
	'ident',
	'init',
	'install',
	'emplace',
	'load',
	'make',
	'on',
	'pending',
	'open',
	'pixels',
	'push',
	'read',
	'release',
	'refresh',
	'register',
	'remove',
	'replace',
	'render',
	'reset',
	'resolve',
	'resume',
	'resize',
	'save',
	'set',
	'setup',
	'size',
	'state',
	'snapshot',
	'submit',
	'suspend',
	'switch',
	'reserve',
	'shutdown',
	'start',
	'to',
	'try',
	'update',
	'use',
	'value',
	'with',
	'write',
	'thunk',
]);

const CPP_TOP_LEVEL_DECLARATOR_BREAK_TOKENS = new Set([';', '{', '}']);
const CPP_BRACE_TOKENS = new Set(['{', '}']);
const CPP_WRAPPER_BLOCK_KEYWORDS = new Set([
	'break',
	'catch',
	'co_return',
	'continue',
	'do',
	'for',
	'goto',
	'if',
	'return',
	'switch',
	'throw',
	'try',
	'while',
]);

export type CppClassRange = {
	name: string;
	nameToken: number;
	start: number;
	end: number;
};

export type CppTypeDeclarationKind = 'class' | 'enum' | 'type';

export type CppTypeDeclarationInfo = {
	kind: CppTypeDeclarationKind;
	name: string;
	nameToken: number;
	context: string | undefined;
};

export type CppFunctionInfo = {
	name: string;
	qualifiedName: string;
	context: string | undefined;
	signature: string;
	nameToken: number;
	bodyStart: number;
	bodyEnd: number;
	wrapperTarget: string | null;
};

export type ClassRange = CppClassRange;
export type TypeDeclarationKind = CppTypeDeclarationKind;
export type TypeDeclarationInfo = CppTypeDeclarationInfo;
export type FunctionInfo = CppFunctionInfo;

export function collectCppClassRanges(
	tokens: readonly CppToken[],
	pairs: readonly number[],
): CppClassRange[] {
	const ranges: CppClassRange[] = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.text !== 'class' && token.text !== 'struct') {
			continue;
		}
			if (index > 0 && tokens[index - 1].text === 'enum') {
				continue;
			}
			const nameIndex = index + 1;
			const bodyOpen = findCppNamedTypeBodyOpen(tokens, nameIndex);
			if (bodyOpen < 0 || pairs[bodyOpen] < 0) {
				continue;
			}
			const name = tokens[nameIndex].text;
			ranges.push({ name, nameToken: nameIndex, start: bodyOpen, end: pairs[bodyOpen] });
	}
	return ranges;
}

export function collectCppTypeDeclarations(tokens: readonly CppToken[], classRanges: readonly CppClassRange[]): CppTypeDeclarationInfo[] {
	const declarations: CppTypeDeclarationInfo[] = [];
	for (let index = 0; index < classRanges.length; index += 1) {
		const range = classRanges[index];
		declarations.push({ kind: 'class', name: range.name, nameToken: range.nameToken, context: classContextAt(classRanges, range.nameToken) });
	}
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.text === 'enum') {
			let nameIndex = index + 1;
			if (tokens[nameIndex]?.text === 'class' || tokens[nameIndex]?.text === 'struct') {
				nameIndex += 1;
			}
			if (findCppNamedTypeBodyOpen(tokens, nameIndex) < 0) {
				continue;
			}
			const name = tokens[nameIndex].text;
			declarations.push({ kind: 'enum', name, nameToken: nameIndex, context: classContextAt(classRanges, index) });
			continue;
		}
		if (token.text === 'using' && tokens[index + 1]?.kind === 'id' && tokens[index + 2]?.text === '=') {
			declarations.push({ kind: 'type', name: tokens[index + 1].text, nameToken: index + 1, context: classContextAt(classRanges, index) });
			continue;
		}
		if (token.text !== 'typedef') {
			continue;
		}
		const statementEnd = findCppTypedefStatementEnd(tokens, index + 1);
		const nameIndex = findCppTypedefNameToken(tokens, index + 1, statementEnd);
		if (nameIndex < 0) {
			continue;
		}
		if (isCppNamedTagTypedefAlias(tokens, index + 1, statementEnd, nameIndex)) {
			continue;
		}
		declarations.push({ kind: 'type', name: tokens[nameIndex].text, nameToken: nameIndex, context: classContextAt(classRanges, index) });
	}
	return declarations;
}

function findCppNamedTypeBodyOpen(tokens: readonly CppToken[], nameIndex: number): number {
	if (nameIndex >= tokens.length || tokens[nameIndex].kind !== 'id') {
		return -1;
	}
	let cursor = nameIndex + 1;
	while (cursor < tokens.length && tokens[cursor].text !== ';' && tokens[cursor].text !== '{') {
		if (isCppTypeUseToken(tokens[cursor].text)) {
			return -1;
		}
		cursor += 1;
	}
	return cursor < tokens.length && tokens[cursor].text === '{' ? cursor : -1;
}

function isCppTypeUseToken(text: string): boolean {
	switch (text) {
		case '(':
		case ')':
		case '[':
		case '=':
		case '*':
		case '&':
		case '&&':
			return true;
		default:
			return false;
	}
}

function findCppTypedefStatementEnd(tokens: readonly CppToken[], start: number): number {
	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;
	for (let index = start; index < tokens.length; index += 1) {
		const text = tokens[index].text;
		if (text === '(') parenDepth += 1;
		else if (text === ')') parenDepth -= 1;
		else if (text === '[') bracketDepth += 1;
		else if (text === ']') bracketDepth -= 1;
		else if (text === '{') braceDepth += 1;
		else if (text === '}') braceDepth -= 1;
		else if (text === ';' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
			return index;
		}
	}
	return tokens.length;
}

export function countCppTopLevelDataMembers(tokens: readonly CppToken[], start: number, end: number): number {
	const ranges = collectCppClassMemberStatementRanges(tokens, start, end);
	let count = 0;
	for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
		const statementStart = ranges[rangeIndex][0];
		const statementEnd = ranges[rangeIndex][1];
		if (statementStart >= statementEnd || isCppAccessSpecifier(tokens[statementStart].text)) {
			continue;
		}
		if (cppRangeHas(tokens, statementStart, statementEnd, token => isCppClassMemberDeclarationControlToken(token.text))) {
			continue;
		}
		if (cppRangeHas(tokens, statementStart, statementEnd, token => token.text === '(')) {
			continue;
		}
		if (cppRangeHas(tokens, statementStart, statementEnd, token => token.kind === 'id')) {
			count += countCppDataMemberDeclarators(tokens, statementStart, statementEnd);
		}
	}
	return count;
}

function isCppClassMemberDeclarationControlToken(text: string): boolean {
	switch (text) {
		case 'class':
		case 'struct':
		case 'union':
		case 'namespace':
		case 'template':
		case 'using':
		case 'typedef':
		case 'enum':
		case 'friend':
		case 'static':
			return true;
		default:
			return false;
	}
}

function collectCppClassMemberStatementRanges(tokens: readonly CppToken[], start: number, end: number): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	let statementStart = start;
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
		else if (
			text === ':'
			&& parenDepth === 0
			&& bracketDepth === 0
			&& braceDepth === 0
			&& index === statementStart + 1
			&& isCppAccessSpecifier(tokens[statementStart].text)
		) {
			statementStart = index + 1;
		} else if (text === ';' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
			if (statementStart < index) {
				ranges.push([statementStart, index]);
			}
			statementStart = index + 1;
		}
	}
	return ranges;
}

function countCppDataMemberDeclarators(tokens: readonly CppToken[], start: number, end: number): number {
	let count = 1;
	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;
	let angleDepth = 0;
	for (let index = start; index < end; index += 1) {
		const text = tokens[index].text;
		if (text === '(') parenDepth += 1;
		else if (text === ')') parenDepth -= 1;
		else if (text === '[') bracketDepth += 1;
		else if (text === ']') bracketDepth -= 1;
		else if (text === '{') braceDepth += 1;
		else if (text === '}') braceDepth -= 1;
		else if (text === '<' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) angleDepth += 1;
		else if (text === '>' && angleDepth > 0 && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) angleDepth -= 1;
		else if (text === '>>' && angleDepth > 0 && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) angleDepth = angleDepth > 1 ? angleDepth - 2 : 0;
		else if (text === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && angleDepth === 0) count += 1;
	}
	return count;
}

function findCppTypedefNameToken(tokens: readonly CppToken[], start: number, end: number): number {
	const functionPointerName = findCppFunctionPointerTypedefName(tokens, start, end);
	if (functionPointerName >= 0) {
		return functionPointerName;
	}
	let nameIndex = -1;
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
		else if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && tokens[index].kind === 'id') {
			nameIndex = index;
		}
	}
	return nameIndex;
}

function findCppFunctionPointerTypedefName(tokens: readonly CppToken[], start: number, end: number): number {
	for (let closeIndex = start + 1; closeIndex < end - 1; closeIndex += 1) {
		if (tokens[closeIndex].text !== ')' || tokens[closeIndex + 1].text !== '(') {
			continue;
		}
		let depth = 0;
		let openIndex = -1;
		for (let index = closeIndex; index >= start; index -= 1) {
			const text = tokens[index].text;
			if (text === ')') depth += 1;
			else if (text === '(') {
				depth -= 1;
				if (depth === 0) {
					openIndex = index;
					break;
				}
			}
		}
		if (openIndex < 0) {
			continue;
		}
		let nameIndex = -1;
		for (let index = openIndex + 1; index < closeIndex; index += 1) {
			if (tokens[index].kind === 'id') {
				nameIndex = index;
			}
		}
		if (nameIndex >= 0) {
			return nameIndex;
		}
	}
	return -1;
}

function isCppNamedTagTypedefAlias(tokens: readonly CppToken[], start: number, end: number, nameIndex: number): boolean {
	if (start >= end || tokens[start + 1]?.kind !== 'id') {
		return false;
	}
	const tagKind = tokens[start].text;
	if (tagKind !== 'struct' && tagKind !== 'class' && tagKind !== 'enum') {
		return false;
	}
	return tokens[start + 1].text === tokens[nameIndex].text;
}

function cppFunctionSignature(tokens: readonly CppToken[], openParen: number, closeParen: number, bodyStart: number, name: string): string {
	const parameters = cppTokenText(tokens, openParen + 1, closeParen).replace(/\s+/g, ' ');
	const qualifiers: string[] = [];
	for (let cursor = closeParen + 1; cursor < bodyStart; cursor += 1) {
		const text = tokens[cursor].text;
		if (CPP_POST_FUNCTION_QUALIFIERS.has(text) || text === '&' || text === '&&') {
			qualifiers.push(text);
		}
	}
	return `${name}(${parameters})${qualifiers.length > 0 ? `:${qualifiers.join(':')}` : ''}`;
}

export function collectCppFunctionDefinitions(
	tokens: readonly CppToken[],
	pairs: readonly number[],
	classRanges: readonly CppClassRange[],
): CppFunctionInfo[] {
	const functions: CppFunctionInfo[] = [];
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index].text !== '{') {
			continue;
		}
		const openParen = findCppFunctionDeclaratorOpenParen(tokens, pairs, index);
		if (openParen < 1 || !isCppFunctionBodyAfterDeclarator(tokens, pairs, openParen, index)) {
			continue;
		}
		if (isCppPreprocessorLine(tokens, openParen)) {
			continue;
		}
		const nameIndex = openParen - 1;
		if (tokens[nameIndex].kind !== 'id' || CPP_CONTROL_CALL_KEYWORDS.has(tokens[nameIndex].text)) {
			continue;
		}
		if (index > 0 && tokens[index - 1].text === '=') {
			continue;
		}
		const target = cppCallTarget(tokens, openParen);
		if (target === null) {
			continue;
		}
		const closeBrace = pairs[index];
		if (closeBrace < 0) {
			continue;
		}
		const name = tokens[nameIndex].text;
		const context = target.includes('::') ? target.slice(0, target.lastIndexOf('::')) : classContextAt(classRanges, index);
		const closeParen = pairs[openParen];
		const signature = cppFunctionSignature(tokens, openParen, closeParen, index, name);
		const isConstructorLike = context !== undefined && (name === context || name === `~${context}`);
		functions.push({
			name,
			qualifiedName: target,
			context,
			signature,
			nameToken: nameIndex,
			bodyStart: index,
			bodyEnd: closeBrace,
			wrapperTarget: isConstructorLike || isBoundaryStyleFunctionName(name) ? null : cppWrapperTarget(tokens, pairs, index, closeBrace),
		});
		index = closeBrace;
	}
	return functions;
}

export const collectClassRanges = collectCppClassRanges;
export const collectTypeDeclarations = collectCppTypeDeclarations;
export const collectFunctionDefinitions = collectCppFunctionDefinitions;
export const countTopLevelDataMembers = countCppTopLevelDataMembers;

function isCppPreprocessorLine(tokens: readonly CppToken[], index: number): boolean {
	const line = tokens[index].line;
	for (let cursor = index; cursor >= 0 && tokens[cursor].line === line; cursor -= 1) {
		if (tokens[cursor].text === '#') {
			return true;
		}
	}
	return false;
}

function classContextAt(classRanges: readonly CppClassRange[], bodyStart: number): string | undefined {
	let best: CppClassRange | null = null;
	for (let index = 0; index < classRanges.length; index += 1) {
		const range = classRanges[index];
		if (bodyStart <= range.start || bodyStart >= range.end) {
			continue;
		}
		if (best === null || range.start > best.start) {
			best = range;
		}
	}
	return best?.name;
}

function findCppFunctionDeclaratorOpenParen(tokens: readonly CppToken[], pairs: readonly number[], bodyStart: number): number {
	let cursor = bodyStart - 1;
	while (cursor >= 0 && CPP_POST_FUNCTION_QUALIFIERS.has(tokens[cursor].text)) {
		cursor -= 1;
	}
	const directDeclaratorCursor = cursor;
	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;
	for (let index = directDeclaratorCursor; index >= 0; index -= 1) {
		const text = tokens[index].text;
		if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && text === '}') {
			const openBrace = pairs[index];
			if (openBrace > 0 && tokens[openBrace - 1].kind === 'id') {
				braceDepth += 1;
				continue;
			}
			break;
		}
		if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && text === ';') {
			break;
		}
		if (text === ')') {
			parenDepth += 1;
			continue;
		}
		if (text === '(') {
			parenDepth -= 1;
			continue;
		}
		if (text === ']') {
			bracketDepth += 1;
			continue;
		}
		if (text === '[') {
			bracketDepth -= 1;
			continue;
		}
		if (text === '}') {
			braceDepth += 1;
			continue;
		}
		if (text === '{') {
			braceDepth -= 1;
			continue;
		}
		if (text === ':' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
			cursor = index - 1;
			break;
		}
	}
	while (cursor >= 0 && CPP_POST_FUNCTION_QUALIFIERS.has(tokens[cursor].text)) {
		cursor -= 1;
	}
	if (cursor < 0 || tokens[cursor].text !== ')') {
		return -1;
	}
	const openParen = pairs[cursor];
	if (openParen < 1) {
		return -1;
	}
	return openParen;
}

function isCppFunctionBodyAfterDeclarator(tokens: readonly CppToken[], pairs: readonly number[], openParen: number, bodyStart: number): boolean {
	const closeParen = pairs[openParen];
	if (closeParen < 0 || bodyStart <= closeParen) {
		return false;
	}
	if (bodyStart > 0 && tokens[bodyStart - 1].kind === 'id' && !CPP_POST_FUNCTION_QUALIFIERS.has(tokens[bodyStart - 1].text)) {
		return false;
	}
	const depth = { paren: 0, bracket: 0, brace: 0 };
	for (let index = closeParen + 1; index < bodyStart; index += 1) {
		const text = tokens[index].text;
		if (applyCppNestingDelta(text, depth)) {
			continue;
		}
		if (isCppTopLevel(depth)) {
			if (CPP_TOP_LEVEL_DECLARATOR_BREAK_TOKENS.has(text)) {
				return false;
			}
		}
	}
	return true;
}

function cppWrapperTarget(tokens: readonly CppToken[], pairs: readonly number[], bodyStart: number, bodyEnd: number): string | null {
	let statementStart = bodyStart + 1;
	if (statementStart >= bodyEnd) {
		return null;
	}
	if (tokens[statementStart]?.text === 'if') {
		let guardEnd = -1;
		const depth = { paren: 0, bracket: 0, brace: 0 };
		for (let index = statementStart; index < bodyEnd; index += 1) {
			const text = tokens[index].text;
			if (CPP_BRACE_TOKENS.has(text)) {
				return null;
			}
			if (applyCppNestingDelta(text, depth)) {
				continue;
			}
			if (text === ';' && isCppTopLevel(depth)) {
				guardEnd = index;
				break;
			}
		}
		if (guardEnd < 0 || !isEmptyReturnStatement(tokens, statementStart, guardEnd)) {
			return null;
		}
		statementStart = guardEnd + 1;
		if (statementStart >= bodyEnd) {
			return null;
		}
	}
	let semicolonIndex = -1;
	const depth = { paren: 0, bracket: 0, brace: 0 };
	for (let index = statementStart; index < bodyEnd; index += 1) {
		const text = tokens[index].text;
		if (CPP_BRACE_TOKENS.has(text)) {
			return null;
		}
		if (applyCppNestingDelta(text, depth)) {
			continue;
		}
		if (depth.paren === 0 && depth.bracket === 0) {
			if (text === ';') {
				if (semicolonIndex >= 0) {
					return null;
				}
				semicolonIndex = index;
				continue;
			}
			if (CPP_WRAPPER_BLOCK_KEYWORDS.has(text)) {
				return null;
			}
		}
	}
	if (semicolonIndex < 0 || semicolonIndex + 1 !== bodyEnd) {
		return null;
	}
	return cppCallTargetFromStatement(tokens, pairs, statementStart, semicolonIndex);
}

function isEmptyReturnStatement(tokens: readonly CppToken[], start: number, end: number): boolean {
	for (let index = start; index < end; index += 1) {
		if (tokens[index].text === 'return' && tokens[index + 1]?.text === ';') {
			return true;
		}
	}
	return false;
}

function isBoundaryStyleFunctionName(name: string): boolean {
	const words = name.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z0-9])/g);
	if (words === null) {
		return CPP_BOUNDARY_STYLE_FUNCTION_NAME_WORDS.has(name.toLowerCase());
	}
	for (let index = 0; index < words.length; index += 1) {
		if (CPP_BOUNDARY_STYLE_FUNCTION_NAME_WORDS.has(words[index].toLowerCase())) {
			return true;
		}
	}
	return false;
}
