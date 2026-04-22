import { LuaLexer } from '../../../lua/syntax/lexer';
import type { LuaToken } from '../../../lua/syntax/token';
import { LuaTokenType } from '../../../lua/syntax/token';

type LineMetadata = {
	decreaseBefore: number;
	increaseAfter: number;
};

const OPENING_TOKENS = new Set<LuaTokenType>([
	LuaTokenType.Function,
	LuaTokenType.Do,
	LuaTokenType.Then,
	LuaTokenType.Repeat,
	LuaTokenType.Else,
	LuaTokenType.LeftBrace,
]);

const CLOSING_TOKENS = new Set<LuaTokenType>([
	LuaTokenType.End,
	LuaTokenType.Until,
	LuaTokenType.Else,
	LuaTokenType.ElseIf,
	LuaTokenType.RightBrace,
]);

export function formatLuaDocument(source: string, lines: readonly string[]): string {
	if (source.length === 0) {
		return '';
	}
	const lexer = new LuaLexer(source, 'console-editor');
	const tokens = lexer.scanTokens();
	const tokensByLine = buildTokensByLine(tokens);
	const preservedLines = determinePreservedLines(source, tokens, lines);
	const metadata = computeLineMetadata(lines.length, tokensByLine);
	const formatted: string[] = [];
	let indentLevel = 0;
	for (let index = 0; index < lines.length; index += 1) {
		const lineNumber = index + 1;
		const info = metadata[index];
		const decrease = info.decreaseBefore;
		if (decrease > 0) {
			indentLevel -= decrease;
			if (indentLevel < 0) {
				indentLevel = 0;
			}
		}
		const originalLine = lines[index];
		if (preservedLines.has(lineNumber)) {
			formatted.push(originalLine);
		} else {
			const trimmedLeading = trimLeadingWhitespace(originalLine);
			const content = trimmedLeading.replace(/\s+$/u, '');
			if (content.length === 0) {
				formatted.push('');
			} else {
				formatted.push(repeatIndent(indentLevel) + content);
			}
		}
		const increase = info.increaseAfter;
		if (increase !== 0) {
			indentLevel += increase;
			if (indentLevel < 0) {
				indentLevel = 0;
			}
		}
	}
	return formatted.join('\n');
}

function buildTokensByLine(tokens: readonly LuaToken[]): Map<number, LuaToken[]> {
	const map = new Map<number, LuaToken[]>();
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.type === LuaTokenType.Eof) {
			continue;
		}
		let bucket = map.get(token.line);
		if (!bucket) {
			bucket = [];
			map.set(token.line, bucket);
		}
		bucket.push(token);
	}
	return map;
}

function determinePreservedLines(source: string, tokens: readonly LuaToken[], lines: readonly string[]): Set<number> {
	const preserved = new Set<number>();
	const lineCount = lines.length;
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.type !== LuaTokenType.String) {
			continue;
		}
		if (!token.lexeme.startsWith('[')) {
			continue;
		}
		if (token.endLine - token.line < 2) {
			continue;
		}
		for (let line = token.line + 1; line < token.endLine; line += 1) {
			preserved.add(line);
		}
	}
	const pattern = /--\[(=*)\[(?:[\s\S]*?)\]\1\]/g;
	const lineStarts = buildLineStartIndices(lines);
	let match: RegExpExecArray;
	while ((match = pattern.exec(source)) !== null) {
		const startIndex = match.index;
		const block = match[0];
		const startLine = lineNumberForIndex(lineStarts, startIndex);
		const endLine = lineNumberForIndex(lineStarts, startIndex + block.length - 1);
		if (endLine - startLine < 2) {
			continue;
		}
		for (let lineNumber = startLine + 1; lineNumber < endLine; lineNumber += 1) {
			if (lineNumber > lineCount) {
				break;
			}
			preserved.add(lineNumber);
		}
	}
	return preserved;
}

function buildLineStartIndices(lines: readonly string[]): number[] {
	const starts: number[] = [0];
	let offset = 0;
	for (let index = 0; index < lines.length - 1; index += 1) {
		offset += lines[index].length + 1;
		starts.push(offset);
	}
	return starts;
}

function lineNumberForIndex(starts: readonly number[], index: number): number {
	let low = 0;
	let high = starts.length - 1;
	while (low <= high) {
		const mid = (low + high) >>> 1;
		if (starts[mid] <= index) {
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return high + 1;
}

function computeLineMetadata(lineCount: number, tokensByLine: ReadonlyMap<number, LuaToken[]>): LineMetadata[] {
	const metadata: LineMetadata[] = new Array(lineCount);
	for (let index = 0; index < lineCount; index += 1) {
		const tokens = tokensByLine.get(index + 1);
		if (!tokens || tokens.length === 0) {
			metadata[index] = { decreaseBefore: 0, increaseAfter: 0 };
			continue;
		}
		let leadingClosers = 0;
		for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
			const type = tokens[tokenIndex].type;
			if (!CLOSING_TOKENS.has(type)) {
				break;
			}
			leadingClosers += 1;
		}
		let totalClosers = 0;
		let openers = 0;
		for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
			const type = tokens[tokenIndex].type;
			if (CLOSING_TOKENS.has(type)) {
				totalClosers += 1;
			}
			if (OPENING_TOKENS.has(type)) {
				openers += 1;
			}
		}
		const closersAfter = totalClosers - leadingClosers;
		metadata[index] = {
			decreaseBefore: leadingClosers,
			increaseAfter: openers - closersAfter,
		};
	}
	return metadata;
}

function trimLeadingWhitespace(line: string): string {
	return line.replace(/^\s+/u, '');
}

function repeatIndent(count: number): string {
	if (count <= 0) {
		return '';
	}
	return '\t'.repeat(count);
}
export function resolveOffsetPosition(lines: readonly string[], offset: number): { row: number; column: number; } {
	let remaining = offset;
	for (let row = 0; row < lines.length; row += 1) {
		const lineLength = lines[row].length;
		if (remaining <= lineLength) {
			return { row, column: remaining };
		}
		remaining -= lineLength + 1;
	}
	if (lines.length === 0) {
		return { row: 0, column: 0 };
	}
	const lastRow = lines.length - 1;
	return { row: lastRow, column: lines[lastRow].length };
}
