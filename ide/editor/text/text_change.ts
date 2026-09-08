/** One replacement in application order; offsets refer to the preceding change's output. */
export type EditorTextChange = {
	readonly offset: number;
	readonly deletedLength: number;
	readonly insertedLength: number;
};

/** Half-open UTF-16 source span. A collapsed span has no selected source. */
export type TrackedTextRange = {
	start: number;
	end: number;
};

/**
 * VS Code nodeAcceptEdit with NeverGrowsWhenTypingAtEdges and collapseOnReplace.
 * Only existing source is tracked: replacing it completely clears the range,
 * and later Undo does not select newly inserted text on the user's behalf.
 */
export function mapTrackedTextRange(range: TrackedTextRange, changes: readonly EditorTextChange[]): void {
	for (const change of changes) {
		if (range.start === range.end) return;
		const start = change.offset;
		const end = start + change.deletedLength;
		if (start <= range.start && range.end <= end) {
			range.start = start;
			range.end = start;
			return;
		}
		const commonLength = Math.min(change.deletedLength, change.insertedLength);
		const commonEnd = start + commonLength;
		const delta = change.insertedLength - change.deletedLength;
		// A start marker moves past insertions at its edge, but remains inside
		// the common prefix of a replacement (the editor's ordinary marker rule).
		if (!(range.start < start || (range.start === start && change.deletedLength > 0)
			|| (commonLength > 0 && (range.start < commonEnd || (range.start === commonEnd && delta < 0))))) {
			range.start = range.start < end ? start + change.insertedLength : range.start + delta;
		}
		// The end marker stays before text inserted at its edge.
		if (!(range.end <= start || (commonLength > 0 && range.end <= commonEnd))) {
			range.end = range.end <= end ? start + change.insertedLength : range.end + delta;
		}
	}
}
