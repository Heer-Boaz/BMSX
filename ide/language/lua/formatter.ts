import { LuaLexer } from '../../../toolchain/ts/lua/syntax/lexer';
import type { LuaTokenSequence } from '../../../toolchain/ts/lua/syntax/token_sequence';
import { LuaSourceLocations } from '../../../toolchain/ts/lua/syntax/source_locations';
import { isLuaTrivia, LuaTokenType } from '../../../toolchain/ts/lua/syntax/token';

type LineMetadata = {
	decreaseBefore: number;
	increaseAfter: number;
	preserveLeadingWhitespace: boolean;
	preserveTrailingWhitespace: boolean;
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
	const lexer = new LuaLexer(source, 'lua-editor');
	const tokens = lexer.scanTokens();
	const metadata = computeLineMetadata(lines.length, tokens, LuaSourceLocations.fromLexical('lua-editor', source, tokens));
	const formatted: string[] = [];
	let indentLevel = 0;
	for (let index = 0; index < lines.length; index += 1) {
		const info = metadata[index];
		const decrease = info.decreaseBefore;
		if (decrease > 0) {
			indentLevel -= decrease;
			if (indentLevel < 0) {
				indentLevel = 0;
			}
		}
		let content = lines[index];
		if (!info.preserveLeadingWhitespace) content = content.replace(/^\s+/u, '');
		if (!info.preserveTrailingWhitespace) content = content.replace(/\s+$/u, '');
		if (content.length === 0 || info.preserveLeadingWhitespace) {
			formatted.push(content);
		} else {
			formatted.push('\t'.repeat(indentLevel) + content);
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

function computeLineMetadata(lineCount: number, tokens: LuaTokenSequence, locations: LuaSourceLocations): LineMetadata[] {
	const metadata: LineMetadata[] = new Array(lineCount);
	for (let index = 0; index < lineCount; index += 1) {
		metadata[index] = {
			decreaseBefore: 0,
			increaseAfter: 0,
			preserveLeadingWhitespace: false,
			preserveTrailingWhitespace: false,
		};
	}
	let tokenLine = 0;
	let atLineStart = true;
	for (const cursor = tokens.cursor(); cursor.token !== undefined; cursor.advance()) {
		const token = cursor.token;
		if (token.type === LuaTokenType.Eof) break;
		if (token.type === LuaTokenType.WhitespaceTrivia || token.type === LuaTokenType.NewLineTrivia) continue;
		const range = locations.range(token);
		const info = metadata[range.start.line - 1];
		if (token.type === LuaTokenType.String || token.type === LuaTokenType.MultiLineCommentTrivia) {
			// Prefixes/suffixes crossing a token are content, not indentation.
			for (let line = range.start.line; line < range.end.line; line += 1) {
				metadata[line - 1].preserveTrailingWhitespace = true;
				metadata[line].preserveLeadingWhitespace = true;
			}
		} else if (token.type === LuaTokenType.SingleLineCommentTrivia) {
			info.preserveTrailingWhitespace = true;
		}
		if (isLuaTrivia(token.type)) continue;
		if (range.start.line !== tokenLine) {
			tokenLine = range.start.line;
			atLineStart = true;
		}
		if (CLOSING_TOKENS.has(token.type)) {
			if (atLineStart) info.decreaseBefore += 1;
			else info.increaseAfter -= 1;
		} else {
			atLineStart = false;
		}
		if (OPENING_TOKENS.has(token.type)) info.increaseAfter += 1;
	}
	return metadata;
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
