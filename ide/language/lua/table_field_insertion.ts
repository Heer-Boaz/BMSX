import type { LuaTableConstructorExpression } from '../../../toolchain/ts/lua/syntax/ast';
import { LuaLexer } from '../../../toolchain/ts/lua/syntax/lexer';
import { getLuaTableFieldTriviaSpan } from '../../../toolchain/ts/lua/syntax/table_fields';
import { LuaTokenType } from '../../../toolchain/ts/lua/syntax/token';
import { findLuaTokenAfterPosition, luaTokenLeadingTriviaStart } from '../../../toolchain/ts/lua/syntax/token_navigation';
import type { EditorTextEdit } from '../../editor/model/text_model';
import { extractIndentation } from '../../editor/text/indentation';
import { getTextSnapshot } from '../../editor/text/source_text';
import type { TextBuffer } from '../../editor/text/text_buffer';

/**
 * Places one complete field source (no exterior trivia/separator) in a current
 * parser-owned table. The producer owns the new syntax and its interior bytes;
 * this owner supplies only insertion boundaries, punctuation and boundary layout.
 */
export function createLuaTableFieldInsertionEdits(
	buffer: TextBuffer,
	path: string,
	table: LuaTableConstructorExpression,
	index: number,
	fieldSource: string,
): EditorTextEdit[] {
	const tokens = new LuaLexer(getTextSnapshot(buffer), path, false).scanTokens();
	const fields = table.fields;
	const referenceIndex = index < fields.length ? index : fields.length - 1;
	const reference = fields.length === 0 ? null : getLuaTableFieldTriviaSpan(tokens, fields[referenceIndex]);
	let separator = ',';
	if (reference !== null) {
		if (reference.separator !== null) separator = reference.separator.lexeme;
		else if (referenceIndex > 0) separator = getLuaTableFieldTriviaSpan(tokens, fields[referenceIndex - 1]).separator!.lexeme;
	}
	const openingLine = table.range.start.line - 1;
	const lineEnd = buffer.getLineEndOffset(openingLine);
	const newline = buffer.charCodeAt(lineEnd - 1) === 13 ? '\r\n' : '\n';
	if (index < fields.length) {
		// New source goes before the next sibling's documentation, never through it.
		const anchor = reference!.startToken;
		const lineStart = anchor.column === 1;
		const indentation = lineStart ? extractIndentation(buffer.getLineContent(fields[index].range.start.line - 1)) : '';
		return [{
			offset: buffer.offsetAt(anchor.line - 1, anchor.column - 1), deleteLength: 0,
			text: indentation + fieldSource + separator + (lineStart ? newline : ' '),
		}];
	}

	const closeIndex = findLuaTokenAfterPosition(tokens, table.range.end) - 1;
	let offset: number;
	let text: string;
	const trailingSeparator = reference !== null && reference.separator !== null ? separator : '';
	if (table.range.start.line === table.range.end.line) {
		// Keep final horizontal padding at the closing brace; comments stay with
		// their existing token. An empty inline table repeats only its padding.
		let anchorIndex = closeIndex;
		while (tokens[anchorIndex - 1].type === LuaTokenType.WhitespaceTrivia) anchorIndex -= 1;
		const anchor = tokens[anchorIndex];
		offset = buffer.offsetAt(anchor.line - 1, anchor.column - 1);
		const padding = reference === null
			? buffer.getTextRange(offset, buffer.offsetAt(table.range.end.line - 1, table.range.end.column - 1)) : ' ';
		text = padding + fieldSource + trailingSeparator;
	} else {
		const anchor = reference === null ? tokens[luaTokenLeadingTriviaStart(tokens, closeIndex)] : reference.endToken;
		offset = buffer.offsetAt(anchor.line - 1, anchor.column - 1);
		const parentIndentation = extractIndentation(buffer.getLineContent(openingLine));
		const indentation = reference !== null && fields[referenceIndex].range.start.line !== table.range.start.line
			? extractIndentation(buffer.getLineContent(fields[referenceIndex].range.start.line - 1)) : parentIndentation + '\t';
		const lineStart = anchor.column === 1;
		text = (lineStart ? '' : newline) + indentation + fieldSource + trailingSeparator + newline + (lineStart ? '' : parentIndentation);
	}
	const edits: EditorTextEdit[] = [];
	if (reference !== null && reference.separator === null) {
		const end = fields[referenceIndex].range.end;
		const punctuationOffset = buffer.offsetAt(end.line - 1, end.column);
		// The edit producer owns order even when no trivia separates the offsets.
		if (punctuationOffset === offset) text = separator + text;
		else edits.push({ offset: punctuationOffset, deleteLength: 0, text: separator });
	}
	edits.push({ offset, deleteLength: 0, text });
	return edits;
}
