import { LuaSourceLocations } from '../../../toolchain/ts/lua/syntax/source_locations';
import { LuaSyntaxError } from '../../../toolchain/ts/lua/errors';
import type { LuaSourcePosition, LuaSourceRange, LuaTableField } from '../../../toolchain/ts/lua/syntax/ast';
import { LuaLexer } from '../../../toolchain/ts/lua/syntax/lexer';
import { LuaParser } from '../../../toolchain/ts/lua/syntax/parser';
import { isLuaTrivia, LuaTokenType } from '../../../toolchain/ts/lua/syntax/token';
import type { EditorTextEdit } from '../../editor/model/text_model';
import type { TextBuffer } from '../../editor/text/text_buffer';
import { luaSourceRangeToTextRange } from './source_edits';

export type LuaFieldValueEdit = {
	readonly edit: EditorTextEdit;
	readonly fieldRange: LuaSourceRange;
	readonly expressionRange: LuaSourceRange;
};
export type LuaFieldValueEditResult = { readonly value: LuaFieldValueEdit } | { readonly error: string };

/** Validate human expression text, preserving the enclosing field's lexical boundary. */
export function parseLuaFieldValueEdit(buffer: TextBuffer, locations: LuaSourceLocations, field: LuaTableField, text: string): LuaFieldValueEditResult {
	const path = locations.path;
	try {
		const tokens = new LuaLexer(text, path).scanTokens();
		const lexicalLocations = LuaSourceLocations.fromLexical(path, text, tokens);
		const eofToken = tokens.get(tokens.length - 1);
		const eofPosition = lexicalLocations.range(eofToken).start;
		let first = eofToken, last = eofToken;
		// A line comment at EOF could consume the source's untouched comma/brace.
		// Block comments and short comments followed by a newline remain legal.
		for (const cursor = tokens.cursor(); cursor.token !== undefined; cursor.advance()) {
			const token = cursor.token;
			if (token.type === LuaTokenType.Eof) break;
			if (token.type === LuaTokenType.SingleLineCommentTrivia
				&& lexicalLocations.range(token).end.line === eofPosition.line) {
				return { error: 'End a line comment with a newline before the field separator.' };
			}
			if (!isLuaTrivia(token.type)) {
				if (first === eofToken) first = token;
				last = token;
			}
		}
		const fragment = new LuaParser(tokens, path, text).parseExpressionOnly();
		const expressionRange = fragment.locations.range(fragment.expression.span);
		const fieldRange = locations.range(field.span);
		const valueRange = locations.range(field.value.span);
		const origin = valueRange.start;
		// Translate fragment coordinates at the owning language-edit boundary.
		const at = (position: LuaSourcePosition): LuaSourcePosition => ({
			line: origin.line + position.line - 1,
			column: position.column + (position.line === 1 ? origin.column - 1 : 0),
		});
		const eof = at(eofPosition);
		const oldEnd = fieldRange.end, valueEnd = valueRange.end;
		const end = oldEnd.line === valueEnd.line && oldEnd.column === valueEnd.column
			? at(lexicalLocations.range(last).end)
			: { line: eof.line + oldEnd.line - valueEnd.line,
				column: oldEnd.line === valueEnd.line ? eof.column - 1 + oldEnd.column - valueEnd.column : oldEnd.column };
		const start = fieldRange.start.line === origin.line && fieldRange.start.column === origin.column ? at(lexicalLocations.range(first).start) : fieldRange.start;
		const range = luaSourceRangeToTextRange(buffer, valueRange);
		return { value: {
			edit: { offset: range.start, deleteLength: range.end - range.start, text },
			fieldRange: { path, start, end },
			expressionRange: { path, start: at(expressionRange.start), end: at(expressionRange.end) },
		} };
	} catch (error) {
		if (!(error instanceof LuaSyntaxError)) throw error;
		return { error: `${error.message} (${error.line}:${error.column})` };
	}
}
