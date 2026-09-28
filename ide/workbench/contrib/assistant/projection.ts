import type { AssistantEntry } from '../../services/assistant/conversation';
import type { WorkspaceEditProposalState } from '../../services/working_copy/workspace_edit';
import { FenwickPrefix } from '../../../common/fenwick';
import { MarkdownDocument, TextStyle } from '../../../common/markdown/model';
import { MarkdownLayout, type MarkdownRow, type StyledMeasure } from '../../../common/markdown/layout';

export type AssistantRow = MarkdownRow & { readonly entry: number; readonly heading: boolean };
type EntryGeometry = { entry: AssistantEntry; rows: number };
type EntryView = { document: MarkdownDocument; layout: MarkdownLayout; rows: MarkdownRow[]; views: WeakMap<MarkdownRow, AssistantRow>;
	length: number; reset: number; generation: number; dirty: boolean; heading: AssistantRow };
const REVIEW_HEADINGS: Record<WorkspaceEditProposalState, string> = {
	pending: 'REVIEW: PENDING', applying: 'REVIEW: APPLYING', applied: 'REVIEW: APPLIED',
	discarded: 'REVIEW: DISCARDED', stale: 'REVIEW: STALE', failed: 'REVIEW: FAILED',
};

/** Virtual transcript: durable text belongs to the conversation, geometry to an indexed
 * sequence, and parsed/layout objects only to the viewport plus one screen of overscan. */
export class AssistantTranscriptProjection {
	public readonly rows: AssistantRow[] = [];
	public firstRow = 0;
	private readonly heights = new FenwickPrefix();
	private readonly geometry = new WeakMap<AssistantEntry, EntryGeometry>();
	private readonly sequence: EntryGeometry[] = [];
	private readonly cache = new Map<AssistantEntry, EntryView>();
	private readonly dirty = new Set<number>();
	private width = -1;
	private font: object | undefined;
	private measure: StyledMeasure;
	private generation = 0;
	private revision = 0;
	private laidOutRevision = -1;
	private top = 0;
	private visible = -1;
	private followingEnd = false;
	private anchor: { entry: AssistantEntry; offset: number } | undefined;

	public get rowCount(): number { return this.heights.getTotal(); }
	public entryTop(index: number): number { return this.heights.prefixSum(index); }
	public rowAt(index: number): AssistantRow | undefined { return this.rows[index - this.firstRow]; }
	public invalidate(entry: number): void { this.dirty.add(entry); }
	public reset(): void {
		this.sequence.length = 0; this.heights.reset(0); this.cache.clear(); this.rows.length = 0;
		this.dirty.clear(); this.anchor = undefined; this.top = 0; this.firstRow = 0; this.revision++;
	}

	/** Metadata synchronization never reads or measures a completed offscreen message. */
	public update(entries: readonly AssistantEntry[], width: number, measure: StyledMeasure, font: object): boolean {
		let changed = false;
		if (this.width !== width || this.font !== font) {
			this.width = width; this.font = font; this.measure = measure; this.generation++; changed = true;
		}
		if (this.sequence.length > entries.length || this.sequence.length > 0 && this.sequence[0].entry !== entries[0]) {
			// A prepended page retains entry identity, measured heights and visible caches.
			this.sequence.length = 0; this.heights.reset(0); changed = true;
		}
		const columns = this.sequence.length < entries.length ? Math.max(1, Math.trunc(width / measure('m', 0, 1, TextStyle.Plain))) : 1;
		for (let index = this.sequence.length; index < entries.length; index++) {
			const entry = entries[index];
			let geometry = this.geometry.get(entry);
			if (!geometry) {
				// Explicit unmeasured height, refined when exposed, as with dynamic-height lists.
				geometry = { entry, rows: Math.max(1, entry.text.getLineCount(), Math.trunc((entry.text.length + columns - 1) / columns)) + 1 };
				this.geometry.set(entry, geometry);
			}
			this.sequence.push(geometry); this.heights.push(geometry.rows); changed = true;
		}
		for (const index of this.dirty) {
			const item = this.sequence[index];
			const cached = this.cache.get(item.entry);
			if (cached) cached.dirty = true;
			changed = true;
		}
		this.dirty.clear();
		if (changed) this.revision++;
		return changed;
	}

	/** Returns the corrected scroll row. Height refinement preserves the reading anchor,
	 * or the end of the conversation when following incoming output. */
	public layout(requestedTop: number, visibleRows: number, followEnd = false): number {
		if (this.laidOutRevision === this.revision && this.top === requestedTop && this.visible === visibleRows && this.followingEnd === followEnd) return this.top;
		const count = this.sequence.length;
		if (count === 0) { this.cache.clear(); this.rows.length = 0; this.firstRow = 0; return 0; }
		let anchorIndex: number, offset: number;
		if (followEnd) {
			let remaining = visibleRows * 2;
			for (let index = count - 1; index >= 0 && remaining > 0; index--) {
				this.prepare(index); remaining -= this.sequence[index].rows;
			}
			requestedTop = Math.max(0, this.rowCount - visibleRows);
		}
		if (!followEnd && requestedTop === this.top && this.anchor && this.sequence[this.anchor.entry.index]?.entry === this.anchor.entry) {
			anchorIndex = this.anchor.entry.index; offset = this.anchor.offset;
		} else {
			anchorIndex = Math.min(count - 1, this.heights.indexAt(requestedTop));
			offset = requestedTop - this.entryTop(anchorIndex);
		}
		this.prepare(anchorIndex);
		let top = this.entryTop(anchorIndex) + Math.min(offset, this.sequence[anchorIndex].rows - 1);
		let start = 0, end = 0, refined: boolean;
		do {
			refined = false;
			top = followEnd ? Math.max(0, this.rowCount - visibleRows)
				: Math.min(Math.max(0, this.rowCount - visibleRows), this.entryTop(anchorIndex) + Math.min(offset, this.sequence[anchorIndex].rows - 1));
			start = this.heights.indexAt(Math.max(0, top - visibleRows));
			end = start;
			while (end < count && this.entryTop(end) < top + visibleRows * 2) {
				if (this.prepare(end)) refined = true;
				end++;
			}
		} while (refined);
		for (const [entry] of this.cache) {
			if (entry.index < start || entry.index >= end || this.sequence[entry.index]?.entry !== entry) this.cache.delete(entry);
		}
		this.rows.length = 0;
		this.firstRow = Math.max(0, Math.trunc(top - visibleRows));
		for (let index = start; index < end; index++) {
			const cached = this.cache.get(this.sequence[index].entry)!;
			const first = this.entryTop(index), separator = index > 0 || this.sequence[index].entry.kind === 'proposal' ? 1 : 0;
			if (separator && first >= this.firstRow) {
				if (cached.heading.entry !== index) cached.heading = { ...cached.heading, entry: index };
				this.rows.push(cached.heading);
			}
			for (let rowIndex = Math.max(0, this.firstRow - first - separator);
				rowIndex < cached.rows.length && first + separator + rowIndex < top + visibleRows * 2; rowIndex++) {
				const row = cached.rows[rowIndex];
				let view = cached.views.get(row);
				if (!view || view.entry !== index) { view = { ...row, entry: index, heading: false }; cached.views.set(row, view); }
				this.rows.push(view);
			}
		}
		this.top = top; this.visible = visibleRows; this.followingEnd = followEnd; this.laidOutRevision = this.revision;
		const index = Math.min(count - 1, this.heights.indexAt(top));
		this.anchor = { entry: this.sequence[index].entry, offset: top - this.entryTop(index) };
		return top;
	}

	private prepare(index: number): boolean {
		const geometry = this.sequence[index], entry = geometry.entry;
		let cached = this.cache.get(entry);
		if (!cached || cached.reset !== entry.resetRevision) {
			cached = { document: new MarkdownDocument(entry.kind === 'user' || entry.kind === 'assistant' ? 'markdown' : 'text'),
				layout: new MarkdownLayout(this.width, this.measure), rows: [], views: new WeakMap(), length: 0,
				reset: entry.resetRevision, generation: this.generation, dirty: true,
				heading: { text: '', runs: [], entry: index, heading: true, code: false, offset: 0, inset: 0 } };
			this.cache.set(entry, cached);
		}
		if (cached.generation !== this.generation) {
			cached.layout = new MarkdownLayout(this.width, this.measure); cached.views = new WeakMap();
			cached.generation = this.generation; cached.dirty = true;
		}
		if (cached.heading.entry !== index) { cached.heading = { ...cached.heading, entry: index }; cached.dirty = true; }
		if (!cached.dirty) return false;
		if (cached.length !== entry.text.length) {
			cached.document.append(entry.text.getTextRange(cached.length, entry.text.length)); cached.length = entry.text.length;
		}
		cached.rows.length = 0;
		for (const block of cached.document.blocks) for (const row of cached.layout.layout(block)) cached.rows.push(row);
		if (entry.kind === 'proposal') {
			const text = REVIEW_HEADINGS[entry.proposal!.state];
			cached.heading = { ...cached.heading, text, runs: [{ text, x: 0, width: this.measure(text, 0, text.length, TextStyle.Bold), style: TextStyle.Bold }] };
		}
		if (cached.rows.length === 0) cached.rows.push({ text: '', runs: [], offset: 0, inset: 0, code: false });
		cached.dirty = false;
		const rows = Math.max(1, cached.rows.length + (index > 0 || entry.kind === 'proposal' ? 1 : 0));
		const delta = rows - geometry.rows;
		geometry.rows = rows; this.heights.add(index, delta);
		return delta !== 0;
	}
}
