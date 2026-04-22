import { LuaLexer } from '../../../../lua/syntax/lexer';

export type WordBounds = {
	start: number;
	end: number;
};

const wordBoundsScratch: WordBounds = {
	start: 0,
	end: 0,
};

function isWordWhitespaceCode(code: number): boolean {
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

function isWordIdentifierCode(code: number): boolean {
	return (code >= 97 && code <= 122)
		|| (code >= 65 && code <= 90)
		|| code === 95
		|| code === 36
		|| (code >= 48 && code <= 57);
}

export function findWordBoundsInLine(line: string, column: number, out: WordBounds = wordBoundsScratch): WordBounds {
	if (line.length === 0) {
		out.start = 0;
		out.end = 0;
		return out;
	}
	let index = column;
	if (index >= line.length) {
		index = line.length - 1;
	}
	if (index < 0) {
		index = 0;
	}
	let start = index;
	let end = index + 1;
	const current = line.charAt(index);
	if (LuaLexer.isIdentifierPart(current)) {
		while (start > 0 && LuaLexer.isIdentifierPart(line.charAt(start - 1))) {
			start -= 1;
		}
		while (end < line.length && LuaLexer.isIdentifierPart(line.charAt(end))) {
			end += 1;
		}
		out.start = start;
		out.end = end;
		return out;
	}
	if (LuaLexer.isWhitespace(current)) {
		while (start > 0 && LuaLexer.isWhitespace(line.charAt(start - 1))) {
			start -= 1;
		}
		while (end < line.length && LuaLexer.isWhitespace(line.charAt(end))) {
			end += 1;
		}
		out.start = start;
		out.end = end;
		return out;
	}
	while (start > 0) {
		const previous = line.charAt(start - 1);
		if (LuaLexer.isIdentifierPart(previous) || LuaLexer.isWhitespace(previous)) {
			break;
		}
		start -= 1;
	}
	while (end < line.length) {
		const next = line.charAt(end);
		if (LuaLexer.isIdentifierPart(next) || LuaLexer.isWhitespace(next)) {
			break;
		}
		end += 1;
	}
	out.start = start;
	out.end = end;
	return out;
}

export function findWordLeftOffset(offset: number, charCodeAt: (offset: number) => number): number {
	if (offset <= 0) {
		return 0;
	}
	let index = offset;
	while (index > 0) {
		const code = charCodeAt(index - 1);
		if (!isWordWhitespaceCode(code)) {
			break;
		}
		index -= 1;
	}
	while (index > 0) {
		const code = charCodeAt(index - 1);
		if (isWordWhitespaceCode(code)) {
			break;
		}
		if (isWordIdentifierCode(code)) {
			break;
		}
		index -= 1;
	}
	while (index > 0) {
		const code = charCodeAt(index - 1);
		if (!isWordIdentifierCode(code)) {
			break;
		}
		index -= 1;
	}
	return index;
}

export function findWordRightOffset(length: number, offset: number, charCodeAt: (offset: number) => number): number {
	if (offset >= length) {
		return length;
	}
	let index = offset;
	while (index < length) {
		const code = charCodeAt(index);
		if (!isWordWhitespaceCode(code)) {
			break;
		}
		index += 1;
	}
	if (index >= length) {
		return length;
	}
	const firstCode = charCodeAt(index);
	const word = isWordIdentifierCode(firstCode);
	while (index < length) {
		const code = charCodeAt(index);
		const isWhitespace = isWordWhitespaceCode(code);
		const isIdentifier = isWordIdentifierCode(code);
		if (isWhitespace || isIdentifier !== word) {
			break;
		}
		index += 1;
	}
	while (index < length) {
		const code = charCodeAt(index);
		if (!isWordWhitespaceCode(code)) {
			break;
		}
		index += 1;
	}
	return index;
}
