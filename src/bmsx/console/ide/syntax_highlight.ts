import * as constants from './constants';
import { KEYWORDS } from './intellisense';
import { LuaLexer } from '../../lua/lexer.ts';
import { LuaSyntaxError } from '../../lua/errors.ts';
import { LuaTokenType } from '../../lua/token.ts';
import type { LuaToken } from '../../lua/token.ts';
import type { HighlightLine } from './types';

// Lightweight Lua syntax highlighter used by the console editor.
// Pure functions with no runtime/editor state dependencies beyond provided inputs.

type SemanticKind = 'parameter' | 'localTop' | 'localFunction';

type TokenAnnotation = {
	start: number;
	end: number;
	kind: SemanticKind;
};

export type LuaSemanticAnnotations = Array<TokenAnnotation[] | undefined>;

type FunctionContext = {
	parameters: Set<string>;
	locals: Set<string>;
	hasVararg: boolean;
};

type StructureKind = 'function' | 'block' | 'repeat';

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

const BUILTIN_IDENTIFIERS = new Set([
	'_g',
	'_env',
	'_version',
	'assert',
	'collectgarbage',
	'coroutine',
	'debug',
	'dofile',
	'error',
	'getmetatable',
	'io',
	'ipairs',
	'jit',
	'load',
	'loadfile',
	'math',
	'next',
	'os',
	'package',
	'pairs',
	'pcall',
	'print',
	'rawequal',
	'rawget',
	'rawlen',
	'rawset',
	'require',
	'select',
	'setmetatable',
	'string',
	'table',
	'tonumber',
	'tostring',
	'type',
	'utf8',
	'xpcall',
	'bit32'
]);

const COMMENT_ANNOTATIONS = ['TODO', 'FIXME', 'BUG', 'HACK', 'NOTE', 'WARNING'];

function annotateToken(target: LuaSemanticAnnotations, token: LuaToken, kind: SemanticKind): void {
	const row = token.line - 1;
	if (row < 0 || row >= target.length) {
		return;
	}
	const start = token.column - 1;
	const end = start + token.lexeme.length;
	if (end <= start) {
		return;
	}
	let rowAnnotations = target[row];
	if (!rowAnnotations) {
		rowAnnotations = [];
		target[row] = rowAnnotations;
	}
	rowAnnotations.push({ start, end, kind });
}

function resolveBinding(name: string, stack: readonly FunctionContext[], topLevel: Set<string>): SemanticKind | null {
	for (let index = stack.length - 1; index >= 0; index -= 1) {
		const context = stack[index];
		if (context.parameters.has(name)) {
			return 'parameter';
		}
		if (context.locals.has(name)) {
			return 'localFunction';
		}
	}
	if (topLevel.has(name)) {
		return 'localTop';
	}
	return null;
}

function currentLocalSet(stack: readonly FunctionContext[], topLevel: Set<string>): Set<string> {
	if (stack.length === 0) {
		return topLevel;
	}
	return stack[stack.length - 1].locals;
}

function createFunctionContext(parameterTokens: number[], tokens: LuaToken[], annotations: LuaSemanticAnnotations, hasVararg: boolean): FunctionContext {
	const context: FunctionContext = {
		parameters: new Set<string>(),
		locals: new Set<string>(),
		hasVararg,
	};
	for (let i = 0; i < parameterTokens.length; i += 1) {
		const tokenIndex = parameterTokens[i];
		const token = tokens[tokenIndex];
		context.parameters.add(token.lexeme);
		annotateToken(annotations, token, 'parameter');
	}
	return context;
}

export function analyzeLuaSemantics(lines: readonly string[]): LuaSemanticAnnotations | null {
	if (lines.length === 0) {
		return [];
	}
	const source = lines.join('\n');
	let tokens: LuaToken[];
	try {
		const lexer = new LuaLexer(source, '<console>');
		tokens = lexer.scanTokens();
	} catch (error) {
		if (error instanceof LuaSyntaxError) {
			return null;
		}
		throw error;
	}
	const annotations: LuaSemanticAnnotations = new Array(lines.length);
	const handledIndices: Set<number> = new Set();
	const topLevelLocals: Set<string> = new Set();
	const functionStack: FunctionContext[] = [];
	const structureStack: StructureKind[] = [];
	let nextFunctionIsLocal = false;
	let lastSignificant: LuaTokenType | null = null;

	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		const type = token.type;
		switch (type) {
			case LuaTokenType.Local: {
				const next = tokens[index + 1];
				if (next && next.type === LuaTokenType.Function) {
					nextFunctionIsLocal = true;
					lastSignificant = LuaTokenType.Local;
					continue;
				}
				const localKind: SemanticKind = functionStack.length > 0 ? 'localFunction' : 'localTop';
				const targetSet = currentLocalSet(functionStack, topLevelLocals);
				let scan = index + 1;
				while (scan < tokens.length) {
					const candidate = tokens[scan];
					if (candidate.type === LuaTokenType.Identifier) {
						targetSet.add(candidate.lexeme);
						annotateToken(annotations, candidate, localKind);
						handledIndices.add(scan);
						scan += 1;
						continue;
					}
					if (candidate.type === LuaTokenType.Comma) {
						scan += 1;
						continue;
					}
					break;
				}
				if (scan > index + 1) {
					index = scan - 1;
				}
				lastSignificant = LuaTokenType.Local;
				continue;
			}
			case LuaTokenType.Function: {
				const nameTokenIndices: number[] = [];
				let scan = index + 1;
				while (scan < tokens.length) {
					const part = tokens[scan];
					if (part.type === LuaTokenType.Identifier) {
						nameTokenIndices.push(scan);
						scan += 1;
						continue;
					}
					if (part.type === LuaTokenType.Dot || part.type === LuaTokenType.Colon) {
						scan += 1;
						continue;
					}
					break;
				}
				for (let i = 0; i < nameTokenIndices.length; i += 1) {
					handledIndices.add(nameTokenIndices[i]);
				}
				if (nextFunctionIsLocal && nameTokenIndices.length === 1) {
					const nameToken = tokens[nameTokenIndices[0]];
					const localKind: SemanticKind = functionStack.length > 0 ? 'localFunction' : 'localTop';
					const targetSet = currentLocalSet(functionStack, topLevelLocals);
					targetSet.add(nameToken.lexeme);
					annotateToken(annotations, nameToken, localKind);
				}
				nextFunctionIsLocal = false;
				let hasVararg = false;
				const parameterTokenIndices: number[] = [];
				if (scan < tokens.length && tokens[scan].type === LuaTokenType.LeftParen) {
					scan += 1;
					while (scan < tokens.length) {
						const part = tokens[scan];
						if (part.type === LuaTokenType.RightParen || part.type === LuaTokenType.Eof) {
							break;
						}
						if (part.type === LuaTokenType.Identifier) {
							parameterTokenIndices.push(scan);
							handledIndices.add(scan);
							scan += 1;
							continue;
						}
						if (part.type === LuaTokenType.Vararg) {
							hasVararg = true;
							annotateToken(annotations, part, 'parameter');
							handledIndices.add(scan);
						}
						scan += 1;
					}
				}
				const context = createFunctionContext(parameterTokenIndices, tokens, annotations, hasVararg);
				functionStack.push(context);
				structureStack.push('function');
				if (scan > index) {
					index = scan;
				}
				lastSignificant = LuaTokenType.Function;
				continue;
			}
			case LuaTokenType.For: {
				const localKind: SemanticKind = functionStack.length > 0 ? 'localFunction' : 'localTop';
				const targetSet = currentLocalSet(functionStack, topLevelLocals);
				let scan = index + 1;
				while (scan < tokens.length) {
					const part = tokens[scan];
					if (part.type === LuaTokenType.Identifier) {
						targetSet.add(part.lexeme);
						annotateToken(annotations, part, localKind);
						handledIndices.add(scan);
						scan += 1;
						continue;
					}
					if (part.type === LuaTokenType.Comma) {
						scan += 1;
						continue;
					}
					if (part.type === LuaTokenType.Equal || part.type === LuaTokenType.In) {
						break;
					}
					break;
				}
				structureStack.push('block');
				if (scan > index) {
					index = scan - 1;
				}
				lastSignificant = LuaTokenType.For;
				continue;
			}
			case LuaTokenType.While: {
				structureStack.push('block');
				lastSignificant = LuaTokenType.While;
				continue;
			}
			case LuaTokenType.If: {
				structureStack.push('block');
				lastSignificant = LuaTokenType.If;
				continue;
			}
			case LuaTokenType.Do: {
				if (lastSignificant !== LuaTokenType.For && lastSignificant !== LuaTokenType.While) {
					structureStack.push('block');
				}
				lastSignificant = LuaTokenType.Do;
				continue;
			}
			case LuaTokenType.Repeat: {
				structureStack.push('repeat');
				lastSignificant = LuaTokenType.Repeat;
				continue;
			}
			case LuaTokenType.Until: {
				if (structureStack.length > 0) {
					const popped = structureStack.pop();
					if (popped === 'repeat') {
						lastSignificant = LuaTokenType.Until;
						continue;
					}
				}
				lastSignificant = LuaTokenType.Until;
				continue;
			}
			case LuaTokenType.End: {
				if (structureStack.length > 0) {
					const popped = structureStack.pop();
					if (popped === 'function' && functionStack.length > 0) {
						functionStack.pop();
					}
				} else if (functionStack.length > 0) {
					functionStack.pop();
				}
				lastSignificant = LuaTokenType.End;
				continue;
			}
			case LuaTokenType.Vararg: {
				if (functionStack.length > 0) {
					const context = functionStack[functionStack.length - 1];
					if (context.hasVararg) {
						annotateToken(annotations, token, 'parameter');
					}
				}
				lastSignificant = LuaTokenType.Vararg;
				continue;
			}
			case LuaTokenType.Identifier: {
				if (handledIndices.has(index)) {
					lastSignificant = LuaTokenType.Identifier;
					continue;
				}
				const binding = resolveBinding(token.lexeme, functionStack, topLevelLocals);
				if (binding) {
					annotateToken(annotations, token, binding);
				}
				lastSignificant = LuaTokenType.Identifier;
				continue;
			}
			default: {
				if (type !== LuaTokenType.Eof) {
					lastSignificant = type;
				}
			}
		}
	}
	return annotations;
}

function highlightCommentAnnotations(line: string, start: number, end: number, columnColors: number[]): void {
	const upper = line.toUpperCase();
	for (let annotationIndex = 0; annotationIndex < COMMENT_ANNOTATIONS.length; annotationIndex += 1) {
		const annotation = COMMENT_ANNOTATIONS[annotationIndex];
		let matchIndex = upper.indexOf(annotation, start);
		while (matchIndex !== -1 && matchIndex < end) {
			const limit = Math.min(end, matchIndex + annotation.length);
			for (let column = matchIndex; column < limit; column += 1) columnColors[column] = constants.COLOR_KEYWORD;
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
			for (let index = start; index < end; index += 1) columnColors[index] = constants.COLOR_COMMENT;
			highlightCommentAnnotations(line, start, end, columnColors);
			return end;
		}
	}
	for (let index = start; index < length; index += 1) columnColors[index] = constants.COLOR_COMMENT;
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
	for (let column = start; column < end; column += 1) columnColors[column] = constants.COLOR_LABEL;
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
			columnColors[index] = constants.COLOR_OPERATOR;
			index += 1;
			continue;
		}
		break;
	}
	for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
		const segment = segments[segmentIndex];
		for (let column = segment.start; column < segment.end; column += 1) {
			columnColors[column] = constants.COLOR_FUNCTION_NAME;
		}
	}
	return index;
}

function highlightParameterList(line: string, openParenIndex: number, columnColors: number[]): number {
	const length = line.length;
	columnColors[openParenIndex] = constants.COLOR_OPERATOR;
	let index = openParenIndex + 1;
	while (index < length) {
		index = skipWhitespace(line, index);
		if (index >= length) break;
		const ch = line.charAt(index);
		if (ch === ')') {
			columnColors[index] = constants.COLOR_OPERATOR;
			return index + 1;
		}
		if (index + 3 <= length && line.slice(index, index + 3) === '...') {
			columnColors[index] = constants.COLOR_PARAMETER;
			columnColors[index + 1] = constants.COLOR_PARAMETER;
			columnColors[index + 2] = constants.COLOR_PARAMETER;
			index += 3;
			continue;
		}
		if (isIdentifierStart(ch)) {
			const end = readIdentifier(line, index);
			for (let column = index; column < end; column += 1) columnColors[column] = constants.COLOR_PARAMETER;
			index = end;
			continue;
		}
		columnColors[index] = constants.COLOR_OPERATOR;
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
	for (let column = index; column < labelEnd; column += 1) columnColors[column] = constants.COLOR_LABEL;
	return labelEnd;
}

function applySemanticAnnotations(columnColors: number[], annotations: readonly TokenAnnotation[] | undefined): void {
	if (!annotations) {
		return;
	}
	for (let index = 0; index < annotations.length; index += 1) {
		const annotation = annotations[index];
		let color: number;
		if (annotation.kind === 'parameter') {
			color = constants.COLOR_PARAMETER;
		} else if (annotation.kind === 'localTop') {
			color = constants.COLOR_LOCAL_TOP;
		} else {
			color = constants.COLOR_LOCAL_FUNCTION;
		}
		const start = Math.max(0, annotation.start);
		const end = Math.max(start, annotation.end);
		for (let column = start; column < end && column < columnColors.length; column += 1) {
			columnColors[column] = color;
		}
	}
}

export function highlightLine(lines: readonly string[], row: number, semantics: LuaSemanticAnnotations | null): HighlightLine {
	const line = row >= 0 && row < lines.length ? lines[row] ?? '' : '';
	const length = line.length;
	const columnColors: number[] = new Array(length).fill(constants.COLOR_CODE_TEXT);
	let i = 0;
	while (i < length) {
		if (i === 0 && line.startsWith('#!')) {
			for (let column = 0; column < length; column += 1) columnColors[column] = constants.COLOR_COMMENT;
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
			for (let column = i; column < end; column += 1) columnColors[column] = constants.COLOR_STRING;
			i = end;
			continue;
		}
		const ch = line.charAt(i);
		if (ch === '"' || ch === '\'') {
			const delimiter = ch;
			columnColors[i] = constants.COLOR_STRING;
			i += 1;
			while (i < length) {
				const current = line.charAt(i);
				columnColors[i] = constants.COLOR_STRING;
				if (current === '\\' && i + 1 < length) {
					columnColors[i + 1] = constants.COLOR_STRING;
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
			columnColors[i] = constants.COLOR_OPERATOR;
			columnColors[i + 1] = constants.COLOR_OPERATOR;
			columnColors[i + 2] = constants.COLOR_OPERATOR;
			i += 3;
			continue;
		}
		if (i + 2 <= length) {
			const pair = line.slice(i, i + 2);
			if (MULTI_CHAR_OPERATORS.has(pair)) {
				columnColors[i] = constants.COLOR_OPERATOR;
				columnColors[i + 1] = constants.COLOR_OPERATOR;
				i += 2;
				continue;
			}
		}
		if (isNumberStart(line, i)) {
			const end = readNumber(line, i);
			for (let column = i; column < end; column += 1) columnColors[column] = constants.COLOR_NUMBER;
			i = end;
			continue;
		}
		if (isIdentifierStart(ch)) {
			const end = readIdentifier(line, i);
			const word = line.slice(i, end);
			const lowerWord = word.toLowerCase();
			let color = constants.COLOR_CODE_TEXT;
			if (KEYWORDS.has(lowerWord)) {
				color = constants.COLOR_KEYWORD;
			} else if (BUILTIN_IDENTIFIERS.has(lowerWord)) {
				color = constants.COLOR_BUILTIN;
			}
			if (color !== constants.COLOR_CODE_TEXT) {
				for (let column = i; column < end; column += 1) columnColors[column] = color;
			}
			if (lowerWord === 'function') {
				i = highlightFunctionSignature(line, end, columnColors);
				continue;
			}
			if (lowerWord === 'goto') {
				i = highlightGotoLabel(line, end, columnColors);
				continue;
			}
			i = end;
			continue;
		}
		if (isOperatorChar(ch)) {
			columnColors[i] = constants.COLOR_OPERATOR;
		}
		i += 1;
	}

	if (semantics) {
		const lineAnnotations = row >= 0 && row < semantics.length ? semantics[row] : undefined;
		applySemanticAnnotations(columnColors, lineAnnotations);
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
