import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import type { QuickPickHighlight } from './provider';

/** Candidate match ranges; normalize only after every query term has matched. */
export class QuickPickHighlightSet {
	public readonly ranges = new ScratchBuffer<QuickPickHighlight>(() => ({ field: 'label', start: 0, end: 0 }));
	private readonly ordered: QuickPickHighlight[] = [];

	/** Retained field-local union, following VS Code's normalizeMatches range sweep. */
	public normalize(): readonly QuickPickHighlight[] {
		const ordered = this.ordered;
		ordered.length = this.ranges.length;
		for (let index = 0; index < ordered.length; index += 1) ordered[index] = this.ranges.peek(index);
		if (ordered.length < 2) return ordered;
		ordered.sort(compareHighlights);
		let size = 0;
		for (const range of ordered) {
			const previous = ordered[size - 1];
			if (size !== 0 && range.field === previous.field && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
			else ordered[size++] = range;
		}
		ordered.length = size;
		return ordered;
	}
}

function compareHighlights(left: QuickPickHighlight, right: QuickPickHighlight): number {
	return left.field === right.field ? left.start - right.start : left.field < right.field ? -1 : 1;
}
