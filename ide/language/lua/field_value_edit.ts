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
export function parseLuaFieldValueEdit(buffer: TextBuffer, field: LuaTableField, text: string): LuaFieldValueEditResult {
	const path = field.range.path;
	try {
		const tokens = new LuaLexer(text, path, false).scanTokens();
		// A line comment at EOF could consume the source's untouched comma/brace.
		// Block comments and short comments followed by a newline remain legal.
		for (const token of tokens) if (token.type === LuaTokenType.SingleLineCommentTrivia
			&& token.endLine === tokens[tokens.length - 1].line) {
			return { error: 'End a line comment with a newline before the field separator.' };
		}
		const syntax = tokens.filter(token => !isLuaTrivia(token.type));
		const expression = new LuaParser(syntax, path, text).parseExpressionOnly();
		const origin = field.value.range.start;
		// Translate fragment coordinates at the owning language-edit boundary.
		const at = (position: LuaSourcePosition): LuaSourcePosition => ({
			line: origin.line + position.line - 1,
			column: position.column + (position.line === 1 ? origin.column - 1 : 0),
		});
		const first = syntax[0], last = syntax[syntax.length - 2], eof = at(syntax[syntax.length - 1]);
		const oldEnd = field.range.end, valueEnd = field.value.range.end;
		const end = oldEnd.line === valueEnd.line && oldEnd.column === valueEnd.column
			? at({ line: last.endLine, column: last.endColumn })
			: { line: eof.line + oldEnd.line - valueEnd.line,
				column: oldEnd.line === valueEnd.line ? eof.column - 1 + oldEnd.column - valueEnd.column : oldEnd.column };
		const start = field.range.start.line === origin.line && field.range.start.column === origin.column ? at(first) : field.range.start;
		const range = luaSourceRangeToTextRange(buffer, field.value.range);
		return { value: {
			edit: { offset: range.start, deleteLength: range.end - range.start, text },
			fieldRange: { path, start, end },
			expressionRange: { path, start: at(expression.range.start), end: at(expression.range.end) },
		} };
	} catch (error) {
		if (!(error instanceof LuaSyntaxError)) throw error;
		return { error: `${error.message} (${error.line}:${error.column})` };
	}
}
