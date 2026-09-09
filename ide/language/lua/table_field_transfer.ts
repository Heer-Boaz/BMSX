import type { LuaTableConstructorExpression, LuaTableField } from '../../../toolchain/ts/lua/syntax/ast';
import { LuaLexer } from '../../../toolchain/ts/lua/syntax/lexer';
import { getLuaTableFieldTriviaSpan } from '../../../toolchain/ts/lua/syntax/table_fields';
import { findLuaTokenAfterPosition, luaTokenLeadingTriviaStart } from '../../../toolchain/ts/lua/syntax/token_navigation';
import type { EditorTextEdit } from '../../editor/model/text_model';
import { getTextSnapshot } from '../../editor/text/source_text';
import type { TextBuffer } from '../../editor/text/text_buffer';
import type { TrackedTextRange } from '../../editor/text/text_change';

export type LuaTableFieldTransfer = {
	readonly edits: EditorTextEdit[];
	/** Exact field syntax in the resulting buffer, excluding its travelling trivia/separator. */
	readonly fieldRange: TrackedTextRange;
};

/**
 * Transfers a complete punctuated field between distinct current-source tables.
 * Full Moon token attachment determines travelling trivia; enclosing brace
 * trivia stays put. Like VS Code text DnD, copy the selected span, not all text
 * between the endpoints, and return the actual insertion range to the caller.
 *
 * The caller owns semantic admission: complete syntax, real source membership,
 * a target outside the selected field, and a destination in 0..target.fields.length.
 * This is not scope/binding analysis, graph reparenting or a formatter.
 */
export function createLuaTableFieldTransfer(
	buffer: TextBuffer,
	path: string,
	field: LuaTableField,
	target: LuaTableConstructorExpression,
	destination: number,
): LuaTableFieldTransfer {
	const tokens = new LuaLexer(getTextSnapshot(buffer), path, false).scanTokens();
	const selected = getLuaTableFieldTriviaSpan(tokens, field);
	const start = buffer.offsetAt(selected.startToken.line - 1, selected.startToken.column - 1);
	const end = buffer.offsetAt(selected.endToken.line - 1, selected.endToken.column - 1);
	const fieldStart = buffer.offsetAt(field.range.start.line - 1, field.range.start.column - 1);
	const fieldEnd = buffer.offsetAt(field.range.end.line - 1, field.range.end.column);
	let text: string;
	if (selected.separator === null && destination < target.fields.length) {
		// The grammar separator precedes trailing comments, never follows them.
		text = buffer.getTextRange(start, fieldEnd) + ',' + buffer.getTextRange(fieldEnd, end);
	} else text = buffer.getTextRange(start, end);

	const edits: EditorTextEdit[] = [{ offset: start, deleteLength: end - start, text: '' }];
	let offset: number;
	let fieldPrefix = fieldStart - start;
	let precedingInsertion = 0;
	if (destination < target.fields.length) {
		const next = getLuaTableFieldTriviaSpan(tokens, target.fields[destination]).startToken;
		offset = buffer.offsetAt(next.line - 1, next.column - 1);
	} else if (target.fields.length > 0) {
		const previous = target.fields[target.fields.length - 1];
		const span = getLuaTableFieldTriviaSpan(tokens, previous);
		offset = buffer.offsetAt(span.endToken.line - 1, span.endToken.column - 1);
		if (span.separator === null) {
			const punctuation = buffer.offsetAt(previous.range.end.line - 1, previous.range.end.column);
			if (punctuation === offset) {
				text = ',' + text;
				fieldPrefix += 1;
			} else {
				edits.push({ offset: punctuation, deleteLength: 0, text: ',' });
				precedingInsertion = 1;
			}
		}
	} else {
		const closeIndex = findLuaTokenAfterPosition(tokens, target.range.end) - 1;
		const anchor = tokens[luaTokenLeadingTriviaStart(tokens, closeIndex)];
		offset = buffer.offsetAt(anchor.line - 1, anchor.column - 1);
	}
	edits.push({ offset, deleteLength: 0, text });
	edits.sort((left, right) => left.offset - right.offset);
	const insertedStart = offset + fieldPrefix + precedingInsertion - (start < offset ? end - start : 0);
	return { edits, fieldRange: { start: insertedStart, end: insertedStart + fieldEnd - fieldStart } };
}
