import type { LuaTableConstructorExpression } from '../../../toolchain/ts/lua/syntax/ast';
import { LuaLexer } from '../../../toolchain/ts/lua/syntax/lexer';
import { getLuaTableFieldTriviaSpan } from '../../../toolchain/ts/lua/syntax/table_fields';
import type { EditorTextEdit } from '../../editor/model/text_model';
import { getTextSnapshot } from '../../editor/text/source_text';
import type { TextBuffer } from '../../editor/text/text_buffer';

/**
 * Moves a field to a sibling's index, with lexer-owned separator/trivia pairs.
 * Like VS Code MoveLinesCommand, move the intervening text around the selected
 * field instead of replacing it: existing source markers keep tracking it.
 * The caller admits distinct indices in a complete current-buffer parse.
 */
export function createLuaTableFieldMoveEdits(
	buffer: TextBuffer,
	path: string,
	table: LuaTableConstructorExpression,
	index: number,
	destination: number,
): EditorTextEdit[] {
	const tokens = new LuaLexer(getTextSnapshot(buffer), path, false).scanTokens();
	const selected = getLuaTableFieldTriviaSpan(tokens, table.fields[index]);
	const sibling = getLuaTableFieldTriviaSpan(tokens, table.fields[destination]);
	const selectedStart = buffer.offsetAt(selected.startToken.line - 1, selected.startToken.column - 1);
	const selectedEnd = buffer.offsetAt(selected.endToken.line - 1, selected.endToken.column - 1);
	if (destination > index) {
		const end = buffer.offsetAt(sibling.endToken.line - 1, sibling.endToken.column - 1);
		let text: string;
		if (sibling.separator === null) {
			const fieldEnd = table.fields[destination].range.end;
			const separatorOffset = buffer.offsetAt(fieldEnd.line - 1, fieldEnd.column);
			text = buffer.getTextRange(selectedEnd, separatorOffset) + ',' + buffer.getTextRange(separatorOffset, end);
		} else text = buffer.getTextRange(selectedEnd, end);
		return [
			{ offset: selectedStart, deleteLength: 0, text },
			{ offset: selectedEnd, deleteLength: end - selectedEnd, text: '' },
		];
	}
	const start = buffer.offsetAt(sibling.startToken.line - 1, sibling.startToken.column - 1);
	let text = buffer.getTextRange(start, selectedStart);
	const edits: EditorTextEdit[] = [{ offset: start, deleteLength: selectedStart - start, text: '' }];
	if (selected.separator === null) {
		const fieldEnd = table.fields[index].range.end;
		const separatorOffset = buffer.offsetAt(fieldEnd.line - 1, fieldEnd.column);
		// Punctuation precedes trailing comments. Merge co-located insertions.
		if (separatorOffset === selectedEnd) text = ',' + text;
		else edits.push({ offset: separatorOffset, deleteLength: 0, text: ',' });
	}
	edits.push({ offset: selectedEnd, deleteLength: 0, text });
	return edits;
}
