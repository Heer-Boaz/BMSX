import type { EditResult } from 'jsonc-parser';

import type { EditorTextEdit, EditorTextModel } from './text_model';

/** Applies one JSONC edit result through the canonical text-model undo owner. */
export function applyJsoncEditResult(model: EditorTextModel, result: EditResult): void {
	const edits: EditorTextEdit[] = new Array(result.length);
	for (let index = 0; index < result.length; index += 1) {
		const edit = result[index];
		edits[index] = {
			offset: edit.offset,
			deleteLength: edit.length,
			text: edit.content,
		};
	}
	if (edits.length > 1) {
		edits.sort((left, right) => left.offset - right.offset || left.deleteLength - right.deleteLength);
	}
	model.pushEditOperations(edits);
}
