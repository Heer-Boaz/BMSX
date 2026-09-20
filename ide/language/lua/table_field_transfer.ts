import type { LuaChunk, LuaTableConstructorExpression, LuaTableField } from '../../../toolchain/ts/lua/syntax/ast';
import { getLuaTableFieldTriviaSpan } from '../../../toolchain/ts/lua/syntax/table_fields';
import { findLuaTokenAfterPosition, luaTokenLeadingTriviaStart } from '../../../toolchain/ts/lua/syntax/token_navigation';
import type { EditorTextEdit } from '../../editor/model/text_model';
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
	chunk: LuaChunk,
	field: LuaTableField,
	target: LuaTableConstructorExpression,
	destination: number,
): LuaTableFieldTransfer {
	const { locations, tokens } = chunk;
	const selected = getLuaTableFieldTriviaSpan(locations, tokens, field);
	const start = locations.offset(selected.startToken.unit, selected.startToken.start);
	const end = locations.offset(selected.endToken.unit, selected.endToken.start);
	const fieldStart = buffer.offsetAt(locations.range(field.span).start.line - 1, locations.range(field.span).start.column - 1);
	const fieldEnd = buffer.offsetAt(locations.range(field.span).end.line - 1, locations.range(field.span).end.column);
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
		const next = getLuaTableFieldTriviaSpan(locations, tokens, target.fields[destination]).startToken;
		offset = locations.offset(next.unit, next.start);
	} else if (target.fields.length > 0) {
		const previous = target.fields[target.fields.length - 1];
		const span = getLuaTableFieldTriviaSpan(locations, tokens, previous);
		offset = locations.offset(span.endToken.unit, span.endToken.start);
		if (span.separator === null) {
			const punctuation = buffer.offsetAt(locations.range(previous.span).end.line - 1, locations.range(previous.span).end.column);
			if (punctuation === offset) {
				text = ',' + text;
				fieldPrefix += 1;
			} else {
				edits.push({ offset: punctuation, deleteLength: 0, text: ',' });
				precedingInsertion = 1;
			}
		}
	} else {
		const closeIndex = findLuaTokenAfterPosition(locations, tokens, locations.range(target.span).end) - 1;
		const anchor = tokens.get(luaTokenLeadingTriviaStart(tokens, closeIndex));
		offset = locations.offset(anchor.unit, anchor.start);
	}
	edits.push({ offset, deleteLength: 0, text });
	edits.sort((left, right) => left.offset - right.offset);
	const insertedStart = offset + fieldPrefix + precedingInsertion - (start < offset ? end - start : 0);
	return { edits, fieldRange: { start: insertedStart, end: insertedStart + fieldEnd - fieldStart } };
}
