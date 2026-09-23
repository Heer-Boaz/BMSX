import { expandTabs, writeWrappedSourceLine, type TextRangeMeasure } from '../../../common/text';
import type { WorkspaceEditReviewInput } from './editor_input';

export type EditReviewRow = { readonly text: string; readonly kind: 'header' | 'before' | 'after' };

/** Layout-time projection only; no parsing, source access or wrapping on unchanged frames. */
export function layoutEditReviewRows(input: WorkspaceEditReviewInput, width: number, measure: TextRangeMeasure): void {
	const rows = input.rows;
	rows.length = 0;
	const wrapped: string[] = [];
	const append = (text: string, kind: EditReviewRow['kind']): void => {
		wrapped.length = 0;
		writeWrappedSourceLine(wrapped, text, width, measure);
		for (const text of wrapped) rows.push({ text, kind });
	};
	for (const { model, version, hunks } of input.proposal.files) {
		append(`${model.identity.domain}: ${model.identity.path}  v${version}`, 'header');
		for (const hunk of hunks) {
			append(`@@ line ${hunk.line} @@`, 'header');
			for (const kind of ['before', 'after'] as const) {
				const lines = hunk[kind].split('\n');
				for (let index = 0; index < lines.length; index++) {
					// Show terminators explicitly: CR/LF-only changes must remain reviewable.
					const text = expandTabs(lines[index]).replaceAll('\r', ' [CR]');
					append(`${kind === 'before' ? '-' : '+'} ${text}${index < lines.length - 1 ? ' [LF]' : ''}`, kind);
				}
			}
		}
	}
}
