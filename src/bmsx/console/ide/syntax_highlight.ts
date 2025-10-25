import * as constants from './constants';
import { KEYWORDS } from './intellisense';
import type { HighlightLine } from './types';

// Lightweight Lua syntax highlighter used by the console editor.
// Pure functions with no runtime/editor state dependencies.

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
	return '+-*/%<>=#(){}[]:,.;'.includes(ch);
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

export function highlightLine(line: string): HighlightLine {
	const length = line.length;
	const columnColors: number[] = new Array(length).fill(constants.COLOR_CODE_TEXT);
	let i = 0;
	while (i < length) {
		const ch = line.charAt(i);
		if (line.startsWith('--[[', i)) {
			const closeIndex = line.indexOf(']]', i + 4);
			const end = closeIndex !== -1 ? closeIndex + 2 : length;
			for (let j = i; j < end; j++) columnColors[j] = constants.COLOR_COMMENT;
			i = end;
			continue;
		}
		const longStringMatch = line.slice(i).match(/^\[=*\[/);
		if (longStringMatch) {
			const equalsCount = longStringMatch[0].length - 2;
			const terminator = ']' + '='.repeat(equalsCount) + ']';
			const closeIndex = line.indexOf(terminator, i + longStringMatch[0].length);
			const end = closeIndex !== -1 ? closeIndex + terminator.length : length;
			for (let j = i; j < end; j++) columnColors[j] = constants.COLOR_STRING;
			i = end;
			continue;
		}
		if (ch === '"' || ch === '\'') {
			const delimiter = ch;
			columnColors[i] = constants.COLOR_STRING;
			i += 1;
			while (i < length) {
				columnColors[i] = constants.COLOR_STRING;
				const current = line.charAt(i);
				if (current === '\\' && i + 1 < length) {
					columnColors[i + 1] = constants.COLOR_STRING;
					i += 2;
					continue;
				}
				if (current === delimiter) { i += 1; break; }
				i += 1;
			}
			continue;
		}
		if (line.startsWith('--', i)) {
			for (let j = i; j < length; j++) columnColors[j] = constants.COLOR_COMMENT;
			break;
		}
		if (i + 2 <= length && line.slice(i, i + 3) === '...') {
			columnColors[i] = constants.COLOR_OPERATOR;
			columnColors[i + 1] = constants.COLOR_OPERATOR;
			columnColors[i + 2] = constants.COLOR_OPERATOR;
			i += 3;
			continue;
		}
		if (i + 1 < length) {
			const pair = line.slice(i, i + 2);
			if (pair === '==' || pair === '~=' || pair === '<=' || pair === '>=' || pair === '..') {
				columnColors[i] = constants.COLOR_OPERATOR;
				columnColors[i + 1] = constants.COLOR_OPERATOR;
				i += 2;
				continue;
			}
		}
		if (isNumberStart(line, i)) {
			const end = readNumber(line, i);
			for (let j = i; j < end; j++) columnColors[j] = constants.COLOR_NUMBER;
			i = end;
			continue;
		}
		if (isIdentifierStart(ch)) {
			const end = readIdentifier(line, i);
			const word = line.slice(i, end);
			const color = KEYWORDS.has(word.toLowerCase()) ? constants.COLOR_KEYWORD : constants.COLOR_CODE_TEXT;
			if (color !== constants.COLOR_CODE_TEXT) {
				for (let j = i; j < end; j++) columnColors[j] = color;
			}
			i = end;
			continue;
		}
		if (isOperatorChar(ch)) {
			columnColors[i] = constants.COLOR_OPERATOR;
		}
		i += 1;
	}

	const chars: string[] = [];
	const colors: number[] = [];
	const columnToDisplay: number[] = [];
	for (let column = 0; column < length; column++) {
		columnToDisplay.push(chars.length);
		const ch = line.charAt(column);
		const color = columnColors[column];
		if (ch === '\t') {
			for (let j = 0; j < constants.TAB_SPACES; j++) {
				chars.push(' ');
				colors.push(color);
			}
		}
		else {
			chars.push(ch);
			colors.push(color);
		}
	}
	columnToDisplay.push(chars.length);
	return { chars, colors, columnToDisplay };
}
