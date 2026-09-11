import type { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import type { CaseFoldedText } from '../../../common/search_text';
import type { QuickPickHighlight, QuickPickItem } from './provider';

/** Matching positions are converted once, at the search/display representation boundary. */
export function appendQuickPickHighlights(
	output: ScratchBuffer<QuickPickHighlight>, item: QuickPickItem,
	text: CaseFoldedText, positions: readonly number[],
): void {
	let index = 0;
	while (index < positions.length) {
		const start = text.sourceStart(positions[index]);
		let end = text.sourceEnd(positions[index] + 1);
		index += 1;
		while (index < positions.length && text.sourceStart(positions[index]) <= end) {
			end = text.sourceEnd(positions[index] + 1);
			index += 1;
		}
		appendQuickPickSourceRange(output, item, start, end);
	}
}

/** A range in the provider's original joined display text becomes a field-local span. */
export function appendQuickPickSourceRange(output: ScratchBuffer<QuickPickHighlight>, item: QuickPickItem, start: number, end: number): void {
	const descriptionStart = item.label.length + 1;
	const detailStart = descriptionStart + item.description.length + 1;
	const range = output.get(output.length);
	if (start >= detailStart) {
		range.field = 'detail'; range.start = start - detailStart; range.end = end - detailStart;
	} else if (start >= descriptionStart) {
		range.field = 'description'; range.start = start - descriptionStart; range.end = end - descriptionStart;
	} else {
		range.field = 'label'; range.start = start; range.end = end;
	}
}
