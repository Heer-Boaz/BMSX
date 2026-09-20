import type { LuaChunk, LuaTableConstructorExpression } from '../../../toolchain/ts/lua/syntax/ast';
import { getLuaTableFieldTriviaSpan } from '../../../toolchain/ts/lua/syntax/table_fields';
import type { EditorTextEdit } from '../../editor/model/text_model';
import type { TextBuffer } from '../../editor/text/text_buffer';

/**
 * Moves a field to a sibling's index, with lexer-owned separator/trivia pairs.
 * Like VS Code MoveLinesCommand, move the intervening text around the selected
 * field instead of replacing it: existing source markers keep tracking it.
 * The caller admits distinct indices in a complete current-buffer parse.
 */
export function createLuaTableFieldMoveEdits(
	buffer: TextBuffer,
	chunk: LuaChunk,
	table: LuaTableConstructorExpression,
	index: number,
	destination: number,
): EditorTextEdit[] {
	const { locations, tokens } = chunk;
	const selected = getLuaTableFieldTriviaSpan(locations, tokens, table.fields[index]);
	const sibling = getLuaTableFieldTriviaSpan(locations, tokens, table.fields[destination]);
	const selectedStart = locations.offset(selected.startToken.unit, selected.startToken.start);
	const selectedEnd = locations.offset(selected.endToken.unit, selected.endToken.start);
	if (destination > index) {
		const end = locations.offset(sibling.endToken.unit, sibling.endToken.start);
		let text: string;
		if (sibling.separator === null) {
			const fieldEnd = locations.range(table.fields[destination].span).end;
			const separatorOffset = buffer.offsetAt(fieldEnd.line - 1, fieldEnd.column);
			text = buffer.getTextRange(selectedEnd, separatorOffset) + ',' + buffer.getTextRange(separatorOffset, end);
		} else text = buffer.getTextRange(selectedEnd, end);
		return [
			{ offset: selectedStart, deleteLength: 0, text },
			{ offset: selectedEnd, deleteLength: end - selectedEnd, text: '' },
		];
	}
	const start = locations.offset(sibling.startToken.unit, sibling.startToken.start);
	let text = buffer.getTextRange(start, selectedStart);
	const edits: EditorTextEdit[] = [{ offset: start, deleteLength: selectedStart - start, text: '' }];
	if (selected.separator === null) {
		const fieldEnd = locations.range(table.fields[index].span).end;
		const separatorOffset = buffer.offsetAt(fieldEnd.line - 1, fieldEnd.column);
		// Punctuation precedes trailing comments. Merge co-located insertions.
		if (separatorOffset === selectedEnd) text = ',' + text;
		else edits.push({ offset: separatorOffset, deleteLength: 0, text: ',' });
	}
	edits.push({ offset: selectedEnd, deleteLength: 0, text });
	return edits;
}
