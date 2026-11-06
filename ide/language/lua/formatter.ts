import { LuaLexer } from '../../../toolchain/ts/lua/syntax/lexer';
import type { LuaTokenSequence } from '../../../toolchain/ts/lua/syntax/token_sequence';
import { LuaSourceLocations } from '../../../toolchain/ts/lua/syntax/source_locations';
import { isLuaTrivia, LuaTokenType } from '../../../toolchain/ts/lua/syntax/token';
import type { EditorTextEdit } from '../../editor/model/text_model';
import { changedTextRange } from '../../common/text';

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
	const edits = createLuaDocumentFormattingEdits(source, lines);
	if (edits.length === 0) return source;
	const parts: string[] = [];
	let offset = 0;
	for (const edit of edits) {
		parts.push(source.slice(offset, edit.offset), edit.text);
		offset = edit.offset + edit.deleteLength;
	}
	parts.push(source.slice(offset));
	return parts.join('');
}

/** Disjoint trivia edits keep tokens, line endings and source markers intact. */
export function createLuaDocumentFormattingEdits(source: string, lines: readonly string[]): EditorTextEdit[] {
	if (source.length === 0) return [];
	const lexer = new LuaLexer(source, 'lua-editor');
	const tokens = lexer.scanTokens();
	const metadata = computeLineMetadata(lines.length, tokens, LuaSourceLocations.fromLexical('lua-editor', source, tokens));
	const edits: EditorTextEdit[] = [];
	let indentLevel = 0;
	let offset = 0;
	for (let index = 0; index < lines.length; index += 1) {
		const info = metadata[index];
		const decrease = info.decreaseBefore;
		if (decrease > 0) {
			indentLevel -= decrease;
			if (indentLevel < 0) {
				indentLevel = 0;
			}
		}
		const line = lines[index];
		// The buffer's LF-delimited lines include the CR of a CRLF ending.
		const content = index < lines.length - 1 && line.endsWith('\r') ? line.slice(0, -1) : line;
		const withoutLeading = info.preserveLeadingWhitespace ? content : content.trimStart();
		const leadingLength = content.length - withoutLeading.length;
		const trimmed = info.preserveTrailingWhitespace ? withoutLeading : withoutLeading.trimEnd();
		if (!info.preserveLeadingWhitespace) {
			const indentation = trimmed.length === 0 ? '' : '\t'.repeat(indentLevel);
			const change = changedTextRange(content.slice(0, leadingLength), indentation);
			if (change !== undefined) edits.push({ offset: offset + change.start,
				deleteLength: change.previousEnd - change.start, text: indentation.slice(change.start, change.nextEnd) });
		}
		if (trimmed.length < withoutLeading.length) edits.push({ offset: offset + leadingLength + trimmed.length,
			deleteLength: withoutLeading.length - trimmed.length, text: '' });
		offset += line.length + 1;
		const increase = info.increaseAfter;
		if (increase !== 0) {
			indentLevel += increase;
			if (indentLevel < 0) {
				indentLevel = 0;
			}
		}
	}
	return edits;
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
	let significantIndex = 0;
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
		// BLua declarations are contextual identifiers, not reserved keywords.
		if (OPENING_TOKENS.has(token.type) || (token.type === LuaTokenType.Identifier && token.lexeme === 'struct'
			&& tokens.getSignificant(significantIndex + 1).type === LuaTokenType.Identifier)) info.increaseAfter += 1;
		significantIndex += 1;
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
