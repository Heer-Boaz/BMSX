import { writeWrappedSourceLine, type TextRangeMeasure } from '../../../common/text';
import type { AssistantEntry } from '../../services/assistant/conversation';
import type { WorkspaceEditProposalState } from '../../services/working_copy/workspace_edit';

export type AssistantRow = { readonly text: string; readonly entry: number; readonly offset: number; readonly heading: boolean };
type EntryLayout = { first: number; end: number; reset: number };
const REVIEW_HEADINGS: Record<WorkspaceEditProposalState, string> = {
	pending: 'REVIEW: PENDING', applying: 'REVIEW: APPLYING', applied: 'REVIEW: APPLIED',
	discarded: 'REVIEW: DISCARDED', stale: 'REVIEW: STALE', failed: 'REVIEW: FAILED',
};

/** Streaming appends reflow only the last body row. Completed history is retained, not reread per token/frame. */
export class AssistantTranscriptProjection {
	public readonly rows: AssistantRow[] = [];
	private readonly entries: EntryLayout[] = [];
	private readonly wrapped: string[] = [];
	private width = -1;
	private font: object | undefined;
	private dirty = 0;
	private readonly headingChanges = new Set<number>();
	public invalidate(entry: number): void { this.dirty = Math.min(this.dirty, entry); }
	public invalidateHeading(entry: number): void { this.headingChanges.add(entry); }
	public reset(): void { this.rows.length = 0; this.entries.length = 0; this.wrapped.length = 0; this.dirty = 0; this.headingChanges.clear(); }
	public update(entries: readonly AssistantEntry[], width: number, measure: TextRangeMeasure, font: object): boolean {
		const reflow = this.width !== width || this.font !== font || entries.length < this.entries.length;
		if (!reflow && this.dirty === entries.length && this.headingChanges.size === 0) return false;
		if (reflow) { this.width = width; this.font = font; this.reset(); }
		const wrapped = this.wrapped;
		for (let index = this.dirty; index < entries.length; index++) {
			const entry = entries[index], previous = this.entries[index];
			let offset = 0;
			let first = this.rows.length;
			if (index === this.dirty && previous) {
				first = previous.first;
				if (previous.reset === entry.resetRevision) {
					const tail = this.rows[previous.end - 1];
					offset = tail.offset;
					this.rows.length = previous.end - 1;
				} else this.rows.length = first;
			}
			if (this.rows.length === first) this.rows.push({ text: entry.kind === 'proposal' ? REVIEW_HEADINGS[entry.proposal!.state] : entry.kind.toUpperCase(), entry: index, offset: 0, heading: true });
			for (const line of entry.text.getTextRange(offset, entry.text.length).split('\n')) {
				wrapped.length = 0;
				writeWrappedSourceLine(wrapped, line, width, measure);
				for (const text of wrapped) { this.rows.push({ text, entry: index, offset, heading: false }); offset += text.length; }
				offset++;
			}
			this.entries[index] = { first, end: this.rows.length, reset: entry.resetRevision };
		}
		// Review settlement changes one retained heading, never the body or later history.
		for (const index of this.headingChanges) {
			const first = this.entries[index].first;
			this.rows[first] = { ...this.rows[first], text: REVIEW_HEADINGS[entries[index].proposal!.state] };
		}
		this.headingChanges.clear();
		this.dirty = entries.length;
		return true;
	}
}
