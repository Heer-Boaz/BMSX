import type { LuaChunk, LuaTableConstructorExpression } from '../../../toolchain/ts/lua/syntax/ast';
import { getLuaTableFieldTriviaSpan } from '../../../toolchain/ts/lua/syntax/table_fields';
import { LuaTokenType } from '../../../toolchain/ts/lua/syntax/token';
import { findLuaTokenAfterPosition, luaTokenLeadingTriviaStart } from '../../../toolchain/ts/lua/syntax/token_navigation';
import type { EditorTextEdit } from '../../editor/model/text_model';
import { extractIndentation } from '../../editor/text/indentation';
import type { TextBuffer } from '../../editor/text/text_buffer';
import { parseLuaExpressionSource } from '../../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxError } from '../../../toolchain/ts/lua/errors';
import { isLuaIdentifier } from '../../../toolchain/ts/lua/syntax/identifier';
import { quoteLuaString } from '../../../toolchain/ts/lua/syntax/string_literal';

/** Named fields include keywords and arbitrary string keys, not only identifiers. */
export function formatLuaTableFieldSource(name: string, expression: string): string {
	return `${isLuaIdentifier(name) ? name : `[${quoteLuaString(name)}]`} = ${expression}`;
}

/** Human-entered expressions must not swallow an untouched field separator. */
export function validateLuaTableFieldExpression(text: string): string {
	const fragment = parseLuaExpressionSource(text, '[property]');
	const { tokens, locations } = fragment;
	const eof = locations.range(tokens.get(tokens.length - 1)).start;
	for (const cursor = tokens.cursor(); cursor.token !== undefined; cursor.advance()) {
		if (cursor.token.type === LuaTokenType.SingleLineCommentTrivia && locations.range(cursor.token).end.line === eof.line) {
			throw new LuaSyntaxError('End a line comment with a newline before the field separator.', locations.path, eof.line, eof.column);
		}
	}
	return text;
}

/**
 * Places one complete field source (no exterior trivia/separator) in a current
 * parser-owned table. The producer owns the new syntax and its interior bytes;
 * this owner supplies only insertion boundaries, punctuation and boundary layout.
 */
export function createLuaTableFieldInsertionEdits(
	buffer: TextBuffer,
	chunk: LuaChunk,
	table: LuaTableConstructorExpression,
	index: number,
	fieldSource: string,
): EditorTextEdit[] {
	const { locations, tokens } = chunk;
	const fields = table.fields;
	const referenceIndex = index < fields.length ? index : fields.length - 1;
	const reference = fields.length === 0 ? null : getLuaTableFieldTriviaSpan(locations, tokens, fields[referenceIndex]);
	let separator = ',';
	if (reference !== null) {
		if (reference.separator !== null) separator = reference.separator.lexeme;
		else if (referenceIndex > 0) separator = getLuaTableFieldTriviaSpan(locations, tokens, fields[referenceIndex - 1]).separator!.lexeme;
	}
	const openingLine = locations.range(table.span).start.line - 1;
	const lineEnd = buffer.getLineEndOffset(openingLine);
	const newline = buffer.charCodeAt(lineEnd - 1) === 13 ? '\r\n' : '\n';
	if (index < fields.length) {
		// New source goes before the next sibling's documentation, never through it.
		const anchor = reference!.startToken;
		const position = locations.range(anchor).start;
		const lineStart = position.column === 1;
		const indentation = lineStart ? extractIndentation(buffer.getLineContent(locations.range(fields[index].span).start.line - 1)) : '';
		return [{
			offset: locations.offset(anchor.unit, anchor.start), deleteLength: 0,
			text: indentation + fieldSource + separator + (lineStart ? newline : ' '),
		}];
	}

	const closeIndex = findLuaTokenAfterPosition(locations, tokens, locations.range(table.span).end) - 1;
	let offset: number;
	let text: string;
	const trailingSeparator = reference !== null && reference.separator !== null ? separator : '';
	if (locations.range(table.span).start.line === locations.range(table.span).end.line) {
		// Keep final horizontal padding at the closing brace; comments stay with
		// their existing token. An empty inline table repeats only its padding.
		let anchorIndex = closeIndex;
		while (tokens.get(anchorIndex - 1).type === LuaTokenType.WhitespaceTrivia) anchorIndex -= 1;
		const anchor = tokens.get(anchorIndex);
		offset = locations.offset(anchor.unit, anchor.start);
		const padding = reference === null
			? buffer.getTextRange(offset, buffer.offsetAt(locations.range(table.span).end.line - 1, locations.range(table.span).end.column - 1)) : ' ';
		text = padding + fieldSource + trailingSeparator;
	} else {
		const anchor = reference === null ? tokens.get(luaTokenLeadingTriviaStart(tokens, closeIndex)) : reference.endToken;
		const position = locations.range(anchor).start;
		offset = locations.offset(anchor.unit, anchor.start);
		const parentIndentation = extractIndentation(buffer.getLineContent(openingLine));
		const indentation = reference !== null && locations.range(fields[referenceIndex].span).start.line !== locations.range(table.span).start.line
			? extractIndentation(buffer.getLineContent(locations.range(fields[referenceIndex].span).start.line - 1)) : parentIndentation + '\t';
		const lineStart = position.column === 1;
		text = (lineStart ? '' : newline) + indentation + fieldSource + trailingSeparator + newline + (lineStart ? '' : parentIndentation);
	}
	const edits: EditorTextEdit[] = [];
	if (reference !== null && reference.separator === null) {
		const end = locations.range(fields[referenceIndex].span).end;
		const punctuationOffset = buffer.offsetAt(end.line - 1, end.column);
		// The edit producer owns order even when no trivia separates the offsets.
		if (punctuationOffset === offset) text = separator + text;
		else edits.push({ offset: punctuationOffset, deleteLength: 0, text: separator });
	}
	edits.push({ offset, deleteLength: 0, text });
	return edits;
}
