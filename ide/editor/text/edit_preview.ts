import type { EditorTextEdit } from '../model/text_model';
import type { TextBuffer } from './text_buffer';
import { getTextSnapshot } from './source_text';

export type TextEditPreviewHunk = {
	readonly offset: number;
	readonly line: number;
	readonly before: string;
	readonly after: string;
};

/** Exact line-context projections of ascending, non-overlapping model edits. No diff search or editable copies. */
export function createTextEditPreview(buffer: TextBuffer, edits: readonly EditorTextEdit[]): readonly TextEditPreviewHunk[] {
	const source = getTextSnapshot(buffer);
	const position = { row: 0, column: 0 };
	const hunks: TextEditPreviewHunk[] = [];
	let index = 0;
	while (index < edits.length) {
		buffer.positionAt(edits[index].offset, position);
		const line = position.row;
		const start = buffer.getLineStartOffset(line);
		let end = start;
		let cursor = start;
		const after: string[] = [];
		do {
			const edit = edits[index++];
			after.push(source.slice(cursor, edit.offset), edit.text);
			cursor = edit.offset + edit.deleteLength;
			buffer.positionAt(cursor, position);
			end = buffer.getLineEndOffset(position.row);
		} while (index < edits.length && edits[index].offset <= end);
		after.push(source.slice(cursor, end));
		hunks.push({ offset: start, line: line + 1, before: source.slice(start, end), after: after.join('') });
	}
	return hunks;
}
