import type { SearchMatch } from './types';

export type RenameLineEdit = {
	row: number;
	text: string;
};

export function planRenameLineEdits(lines: readonly string[], matches: readonly SearchMatch[], newName: string): RenameLineEdit[] {
	if (matches.length === 0) {
		return [];
	}
	const edits: RenameLineEdit[] = [];
	let currentRow = matches[0].row;
	let source = lines[currentRow] ?? '';
	let builder = '';
	let sliceStart = 0;
	for (let index = 0; index < matches.length; index += 1) {
		const match = matches[index];
		if (match.row !== currentRow) {
			builder += source.slice(sliceStart);
			if (builder !== source) {
				edits.push({ row: currentRow, text: builder });
			}
			currentRow = match.row;
			source = lines[currentRow] ?? '';
			builder = '';
			sliceStart = 0;
		}
		builder += source.slice(sliceStart, match.start);
		builder += newName;
		sliceStart = match.end;
	}
	builder += source.slice(sliceStart);
	if (builder !== source) {
		edits.push({ row: currentRow, text: builder });
	}
	return edits;
}
