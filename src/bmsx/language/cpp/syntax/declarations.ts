import {
	CPP_CONTROL_CALL_KEYWORDS,
	CPP_POST_FUNCTION_QUALIFIERS,
	countCppParameters,
	cppCallTarget,
	cppCallTargetFromStatement,
	findTopLevelCppSemicolon,
} from './syntax';
import type { CppToken } from './tokens';

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
};

export type CppFunctionInfo = {
	name: string;
	qualifiedName: string;
	context: string | null;
	signature: string;
	nameToken: number;
	bodyStart: number;
	bodyEnd: number;
	wrapperTarget: string | null;
};

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
		const nameIndex = index + 1;
		if (nameIndex >= tokens.length || tokens[nameIndex].kind !== 'id') {
			continue;
		}
		let cursor = nameIndex + 1;
		while (cursor < tokens.length && tokens[cursor].text !== ';' && tokens[cursor].text !== '{') {
			cursor += 1;
		}
		if (cursor >= tokens.length || tokens[cursor].text !== '{' || pairs[cursor] < 0) {
			continue;
		}
		const name = tokens[nameIndex].text;
		ranges.push({ name, nameToken: nameIndex, start: cursor, end: pairs[cursor] });
	}
	return ranges;
}

export function collectCppTypeDeclarations(tokens: readonly CppToken[], classRanges: readonly CppClassRange[]): CppTypeDeclarationInfo[] {
	const declarations: CppTypeDeclarationInfo[] = [];
	for (let index = 0; index < classRanges.length; index += 1) {
		const range = classRanges[index];
		declarations.push({ kind: 'class', name: range.name, nameToken: range.nameToken });
	}
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.text === 'enum') {
			let nameIndex = index + 1;
			if (tokens[nameIndex]?.text === 'class' || tokens[nameIndex]?.text === 'struct') {
				nameIndex += 1;
			}
			if (nameIndex >= tokens.length || tokens[nameIndex].kind !== 'id') {
				continue;
			}
			let cursor = nameIndex + 1;
			while (cursor < tokens.length && tokens[cursor].text !== ';' && tokens[cursor].text !== '{') {
				cursor += 1;
			}
			if (cursor >= tokens.length || tokens[cursor].text !== '{') {
				continue;
			}
			const name = tokens[nameIndex].text;
			declarations.push({ kind: 'enum', name, nameToken: nameIndex });
			continue;
		}
		if (token.text === 'using' && tokens[index + 1]?.kind === 'id' && tokens[index + 2]?.text === '=') {
			declarations.push({ kind: 'type', name: tokens[index + 1].text, nameToken: index + 1 });
			continue;
		}
		if (token.text !== 'typedef') {
			continue;
		}
		let cursor = index + 1;
		let nameIndex = -1;
		while (cursor < tokens.length && tokens[cursor].text !== ';') {
			if (tokens[cursor].kind === 'id') {
				nameIndex = cursor;
			}
			cursor += 1;
		}
		if (nameIndex < 0) {
			continue;
		}
		declarations.push({ kind: 'type', name: tokens[nameIndex].text, nameToken: nameIndex });
	}
	return declarations;
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
		let cursor = index - 1;
		while (cursor >= 0 && CPP_POST_FUNCTION_QUALIFIERS.has(tokens[cursor].text)) {
			cursor -= 1;
		}
		if (cursor < 0 || tokens[cursor].text !== ')') {
			continue;
		}
		const openParen = pairs[cursor];
		if (openParen < 1) {
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
		const context = target.includes('::') ? target.slice(0, target.lastIndexOf('::')) : classContextAt(classRanges, index);
		const signature = `${countCppParameters(tokens, openParen, cursor)}:${tokens[nameIndex].text}`;
		functions.push({
			name: tokens[nameIndex].text,
			qualifiedName: target,
			context,
			signature,
			nameToken: nameIndex,
			bodyStart: index,
			bodyEnd: closeBrace,
			wrapperTarget: cppWrapperTarget(tokens, pairs, index, closeBrace),
		});
		index = closeBrace;
	}
	return functions;
}

function classContextAt(classRanges: readonly CppClassRange[], bodyStart: number): string | null {
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
	return best === null ? null : best.name;
}

function cppWrapperTarget(tokens: readonly CppToken[], pairs: readonly number[], bodyStart: number, bodyEnd: number): string | null {
	let statementStart = bodyStart + 1;
	let firstEnd = findTopLevelCppSemicolon(tokens, statementStart, bodyEnd);
	if (firstEnd < 0) {
		return null;
	}
	if (isEmptyReturnStatement(tokens, statementStart, firstEnd) && tokens[statementStart]?.text === 'if') {
		statementStart = firstEnd + 1;
		firstEnd = findTopLevelCppSemicolon(tokens, statementStart, bodyEnd);
		if (firstEnd < 0) {
			return null;
		}
	}
	if (firstEnd + 1 !== bodyEnd) {
		return null;
	}
	return cppCallTargetFromStatement(tokens, pairs, statementStart, firstEnd);
}

function isEmptyReturnStatement(tokens: readonly CppToken[], start: number, end: number): boolean {
	for (let index = start; index < end; index += 1) {
		if (tokens[index].text === 'return' && tokens[index + 1]?.text === ';') {
			return true;
		}
	}
	return false;
}
