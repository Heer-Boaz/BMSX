import type { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import type { EditReviewLine, EditReviewRow } from './projection';

/** Source intent survives reflow and temporary viewport clamps; projected pixels do not replace it. */
export class EditReviewReadingState {
	public line: EditReviewLine | undefined;
	public offset = 0;
	public decoration = 0;
	public fraction = 0;
	public end = false;
	public projectedScroll: number | undefined;
	private rowHeight = 0;

	public capture(view: WorkbenchScrollViewport, rows: readonly EditReviewRow[]): void {
		if (this.rowHeight === 0 || rows.length === 0 || view.height === 0 || this.projectedScroll === view.scrollTop) return;
		const top = view.scrollTop, index = Math.trunc(top / this.rowHeight);
		const row = rows[index];
		this.line = row.line; this.offset = row.start; this.decoration = row.decoration;
		this.fraction = (top - index * this.rowHeight) / this.rowHeight;
		this.end = view.contentHeight > view.height && top + view.height >= view.contentHeight;
		this.projectedScroll = top;
	}

	public restore(view: WorkbenchScrollViewport, rows: readonly EditReviewRow[], rowHeight: number): void {
		let top = 0;
		if (this.end) top = view.contentHeight - view.height;
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
