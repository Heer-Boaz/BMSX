import { TAB_SPACES } from '../../../common/constants';
import { writeWrappedSourceLine, type TextRangeMeasure } from '../../../common/text';
import type { TextEditPreviewHunk } from '../../../editor/text/edit_preview';
import type { WorkspaceEditPreviewFile } from '../../services/working_copy/workspace_edit';
import type { WorkspaceEditReviewInput } from './editor_input';

/** Immutable display/source correspondence, produced once from the proposal's exact preview. */
export type EditReviewLine = {
	readonly file: WorkspaceEditPreviewFile;
	readonly hunk: TextEditPreviewHunk | undefined;
	readonly part: 'file' | 'hunk' | 'before' | 'after';
	readonly sourceOffset: number;
	readonly text: string;
	readonly sourceToDisplay: readonly number[];
};

export type EditReviewRow = {
	text: string;
	kind: 'header' | 'before' | 'after';
	line: EditReviewLine;
	start: number;
	end: number;
	/** Display positions within a prefix or an expanded tab/terminator, not source characters. */
	decoration: number;
	endDecoration: number;
};

export function createEditReviewLines(files: readonly WorkspaceEditPreviewFile[]): readonly EditReviewLine[] {
	const lines: EditReviewLine[] = [];
	for (const file of files) {
		lines.push(createEditReviewLine(file, undefined, 'file', 0,
			`${file.identity.domain}: ${file.identity.path}  ${file.kind === 'create' ? 'NEW FILE' : `v${file.version}`}`, false));
		for (const hunk of file.hunks) {
			lines.push(createEditReviewLine(file, hunk, 'hunk', 0, `@@ line ${hunk.line} @@`, false));
			for (const part of ['before', 'after'] as const) {
				const sourceLines = hunk[part].split('\n');
				let sourceOffset = 0;
				for (let index = 0; index < sourceLines.length; index++) {
					const source = sourceLines[index], terminated = index < sourceLines.length - 1;
					lines.push(createEditReviewLine(file, hunk, part, sourceOffset, source, terminated));
					sourceOffset += source.length + (terminated ? 1 : 0);
				}
			}
		}
	}
	return lines;
}

function createEditReviewLine(file: WorkspaceEditPreviewFile, hunk: TextEditPreviewHunk | undefined,
	part: EditReviewLine['part'], sourceOffset: number, source: string, terminated: boolean): EditReviewLine {
	const decorated = part === 'before' || part === 'after';
	let text = decorated ? part === 'before' ? '- ' : '+ ' : '';
	const sourceToDisplay = [text.length];
	for (let index = 0; index < source.length; index++) {
		const char = source[index];
		text += decorated && char === '\t' ? ' '.repeat(TAB_SPACES) : decorated && char === '\r' ? ' [CR]' : char;
		sourceToDisplay.push(text.length);
	}
	if (terminated) { text += ' [LF]'; sourceToDisplay.push(text.length); }
	return { file, hunk, part, sourceOffset, text, sourceToDisplay };
}

/** Layout-time projection only; no parsing, source access or wrapping on unchanged frames. */
export function layoutEditReviewRows(input: WorkspaceEditReviewInput, width: number, measure: TextRangeMeasure): void {
	const rows = input.rows;
	rows.length = 0;
	input.rowStorage.clear();
	const wrapped: string[] = [];
	for (const line of input.lines) {
		wrapped.length = 0;
		writeWrappedSourceLine(wrapped, line.text, width, measure);
		let start = 0, sourceStart = 0, sourceEnd = 0;
		const map = line.sourceToDisplay;
		for (const text of wrapped) {
			const end = start + text.length;
			while (sourceStart + 1 < map.length && map[sourceStart + 1] <= start) sourceStart++;
			while (sourceEnd + 1 < map.length && map[sourceEnd + 1] <= end) sourceEnd++;
			const row = input.rowStorage.get(rows.length);
			row.text = text;
			row.kind = line.part === 'before' || line.part === 'after' ? line.part : 'header';
			row.line = line; row.start = line.sourceOffset + sourceStart; row.end = line.sourceOffset + sourceEnd;
			row.decoration = start - map[sourceStart]; row.endDecoration = end - map[sourceEnd];
			rows.push(row);
			start = end;
		}
	}
}
