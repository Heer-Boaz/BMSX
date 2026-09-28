import type { AssistantEntry } from '../../services/assistant/conversation';
import type { WorkspaceEditProposalState } from '../../services/working_copy/workspace_edit';
import { MarkdownDocument, TextStyle } from '../../../common/markdown/model';
import { MarkdownLayout, type MarkdownRow, type StyledMeasure } from '../../../common/markdown/layout';

export type AssistantRow = MarkdownRow & { readonly entry: number; readonly heading: boolean };
type EntryLayout = { first: number; end: number; reset: number; length: number; document: MarkdownDocument; separator: AssistantRow };
const REVIEW_HEADINGS: Record<WorkspaceEditProposalState, string> = {
	pending: 'REVIEW: PENDING', applying: 'REVIEW: APPLYING', applied: 'REVIEW: APPLIED',
	discarded: 'REVIEW: DISCARDED', stale: 'REVIEW: STALE', failed: 'REVIEW: FAILED',
};

/** Retained Markdown documents/layout. Appending text never rereads completed messages. */
export class AssistantTranscriptProjection {
	public readonly rows: AssistantRow[] = [];
	private readonly entries: EntryLayout[] = [];
	private rowViews = new WeakMap<MarkdownRow, AssistantRow>();
	private layout: MarkdownLayout;
	private measure: StyledMeasure;
	private width = -1;
	private font: object | undefined;
	private dirty = 0;
	private readonly headingChanges = new Set<number>();
	public invalidate(entry: number): void { this.dirty = Math.min(this.dirty, entry); }
	public invalidateHeading(entry: number): void { this.headingChanges.add(entry); }
	public reset(): void { this.rows.length = 0; this.entries.length = 0; this.dirty = 0; this.headingChanges.clear(); }
	public update(entries: readonly AssistantEntry[], width: number, measure: StyledMeasure, font: object): boolean {
		const reflow = this.width !== width || this.font !== font;
		const removed = entries.length < this.entries.length;
		if (removed) this.reset();
		if (!removed && !reflow && this.dirty === entries.length && this.headingChanges.size === 0) return false;
		if (reflow) {
			this.width = width; this.font = font; this.measure = measure; this.layout = new MarkdownLayout(width, measure);
			this.rowViews = new WeakMap(); this.dirty = 0;
		}
		for (let index = this.dirty; index < entries.length; index++) {
			const entry = entries[index];
			let retained = this.entries[index];
			const first = index === 0 ? 0 : this.entries[index - 1].end;
			if (!retained || retained.reset !== entry.resetRevision) {
				retained = { first, end: first, reset: entry.resetRevision, length: 0, document: new MarkdownDocument(),
					separator: { text: '', runs: [], entry: index, heading: true, code: false, offset: 0 } };
				this.entries[index] = retained;
			}
			if (retained.length !== entry.text.length) {
				retained.document.append(entry.text.getTextRange(retained.length, entry.text.length));
				retained.length = entry.text.length;
			}
			this.rows.length = first;
			retained.first = first;
			if (entry.kind === 'proposal') {
				const text = REVIEW_HEADINGS[entry.proposal!.state];
				retained.separator = { ...retained.separator, text,
					runs: [{ text, x: 0, width: this.measure(text, 0, text.length, TextStyle.Bold), style: TextStyle.Bold }] };
			}
			if (index > 0 || entry.kind === 'proposal') this.rows.push(retained.separator);
			for (const block of retained.document.blocks) {
				for (const row of this.layout.layout(block)) {
					let view = this.rowViews.get(row);
					if (!view) { view = { ...row, entry: index, heading: false }; this.rowViews.set(row, view); }
					this.rows.push(view);
				}
			}
			retained.end = this.rows.length;
		}
		for (const index of this.headingChanges) {
			const retained = this.entries[index], text = REVIEW_HEADINGS[entries[index].proposal!.state];
			this.rows[retained.first] = retained.separator = { ...retained.separator, text,
				runs: [{ text, x: 0, width: this.measure(text, 0, text.length, TextStyle.Bold), style: TextStyle.Bold }] };
		}
		this.headingChanges.clear(); this.dirty = entries.length;
		return true;
	}
}
