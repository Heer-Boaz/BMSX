import type { LuaTableConstructorExpression } from '../../../toolchain/ts/lua/syntax/ast';
import { LuaLexer } from '../../../toolchain/ts/lua/syntax/lexer';
import { getLuaTableFieldTriviaSpan } from '../../../toolchain/ts/lua/syntax/table_fields';
import type { EditorTextEdit } from '../../editor/model/text_model';
import { getTextSnapshot } from '../../editor/text/source_text';
import type { TextBuffer } from '../../editor/text/text_buffer';

/**
 * Exchanges adjacent field/separator pairs with their lexer-owned trivia.
 * The caller admits the sibling and supplies a complete current-buffer parse.
 */
export function createLuaTableFieldMoveEdit(
	buffer: TextBuffer,
	path: string,
	table: LuaTableConstructorExpression,
	index: number,
	direction: -1 | 1,
): EditorTextEdit {
	const firstIndex = direction === -1 ? index - 1 : index;
	const tokens = new LuaLexer(getTextSnapshot(buffer), path, false).scanTokens();
	const first = getLuaTableFieldTriviaSpan(tokens, table.fields[firstIndex]);
	const second = getLuaTableFieldTriviaSpan(tokens, table.fields[firstIndex + 1]);
	const start = buffer.offsetAt(first.startToken.line - 1, first.startToken.column - 1);
	const middle = buffer.offsetAt(second.startToken.line - 1, second.startToken.column - 1);
	const end = buffer.offsetAt(second.endToken.line - 1, second.endToken.column - 1);
	let secondText: string;
	if (second.separator === null) {
		// The former last field now needs punctuation before its trailing comments.
		const fieldEnd = table.fields[firstIndex + 1].range.end;
		const separatorOffset = buffer.offsetAt(fieldEnd.line - 1, fieldEnd.column);
		secondText = buffer.getTextRange(middle, separatorOffset) + ',' + buffer.getTextRange(separatorOffset, end);
	} else {
		secondText = buffer.getTextRange(middle, end);
	}
	return { offset: start, deleteLength: end - start, text: secondText + buffer.getTextRange(start, middle) };
}
