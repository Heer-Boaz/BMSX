import type { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import type { EditReviewLine, EditReviewRow } from './projection';

/** Source intent survives reflow and temporary viewport clamps; projected pixels do not replace it. */
export class EditReviewReadingState {
	public line: EditReviewLine | undefined;
	public offset = 0;
	public decoration = 0;
	public fraction = 0;
	public edge: 'start' | 'end' | undefined;
	public projectedScroll: number | undefined;
	private rowHeight = 0;

	/** Absolute navigation names the document edge, not a possibly clamped pixel coordinate. */
	public noteUserScroll(edge?: 'start' | 'end'): void {
		this.edge = edge;
		this.projectedScroll = undefined;
		if (edge !== undefined) {
			this.line = undefined; this.offset = 0; this.decoration = 0; this.fraction = 0;
		}
	}

	public capture(view: WorkbenchScrollViewport, rows: readonly EditReviewRow[]): void {
		if (this.edge !== undefined || this.rowHeight === 0 || rows.length === 0 || this.projectedScroll === view.scrollTop) return;
		// Layout alone cannot choose a new source position in a covered body; admitted input can.
		if (view.height === 0 && this.projectedScroll !== undefined) return;
		const top = view.scrollTop;
		if (view.contentHeight > view.height && top + view.height >= view.contentHeight) {
			this.noteUserScroll('end'); this.projectedScroll = top;
			return;
		}
		const index = Math.trunc(top / this.rowHeight);
		const row = rows[index];
		this.line = row.line; this.offset = row.start; this.decoration = row.decoration;
		this.fraction = (top - index * this.rowHeight) / this.rowHeight;
		this.projectedScroll = top;
	}

	public restore(view: WorkbenchScrollViewport, rows: readonly EditReviewRow[], rowHeight: number): void {
		let top = 0;
		if (this.edge === 'end') top = view.contentHeight - view.height;
		else if (this.line !== undefined) {
			const index = rows.findIndex(row => row.line === this.line && (
				row.end > this.offset || row.end === this.offset && row.endDecoration > this.decoration
				|| row.start === this.offset && row.decoration === this.decoration));
			top = (index + this.fraction) * rowHeight;
		}
		view.scrollbar.setScroll(top);
		this.rowHeight = rowHeight;
		this.projectedScroll = view.scrollTop;
	}
}
