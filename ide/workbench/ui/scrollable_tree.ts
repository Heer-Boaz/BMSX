import { create_rect_bounds, point_in_rect, write_rect_bounds } from '../../../machine/ts/common/rect';
import { KeyModifier } from '../../../hosts/common/input/text';
import { SCROLLBAR_WIDTH } from '../../common/constants';
import type { WheelInputSnapshot } from '../../common/models';
import { layoutWorkbenchList } from './list_view';
import { Scrollbar } from './scrollbar';
import type { WorkbenchTreeLayout, WorkbenchTreeNode, WorkbenchTreeState } from './tree_view';

/** Row-addressed tree navigation and scrollbar share one scroll position. */
export class ScrollableWorkbenchTree<Element> implements WorkbenchTreeState<Element> {
	public readonly roots: WorkbenchTreeNode<Element>[] = [];
	public readonly rows: WorkbenchTreeNode<Element>[] = [];
	public selectionIndex = -1;
	public hoverIndex = -1;
	public rowsRevision = 0;
	public readonly scrollbar = new Scrollbar('vertical');
	public readonly horizontalScrollbar = new Scrollbar('horizontal');
	private readonly track = create_rect_bounds();
	private readonly horizontalTrack = create_rect_bounds();
	private readonly bounds = create_rect_bounds();
	private contentWidth = 0;
	private measuredRevision = -1;
	private measurementKey: object | undefined;
	private measureRow: ((row: WorkbenchTreeNode<Element>) => number) | undefined;
	public readonly layout: WorkbenchTreeLayout = {
		contentLeft: 0, contentTop: 0, contentRight: 0, contentBottom: 0, rowHeight: 0, visibleRowCount: 0, indentWidth: 0, twistieWidth: 0,
	};
	public get scroll(): number { return this.scrollbar.getScroll(); }
	public set scroll(value: number) { this.scrollbar.setScroll(value); }
	public get scrollLeft(): number { return this.horizontalScrollbar.getScroll(); }
	public get rowLeft(): number { return this.layout.contentLeft - Math.round(this.scrollLeft); }
	public onDidChangeRows(): void { this.rowsRevision++; }

	/** Measure only after row content or font metrics change, never on resize/scroll/paint. */
	public measureContentWidth(measureRow: (row: WorkbenchTreeNode<Element>) => number, measurementKey: object): void {
		if (this.measuredRevision === this.rowsRevision && this.measureRow === measureRow && this.measurementKey === measurementKey) return;
		this.measuredRevision = this.rowsRevision; this.measureRow = measureRow; this.measurementKey = measurementKey;
		this.contentWidth = 0;
		for (const row of this.rows) this.contentWidth = Math.max(this.contentWidth, measureRow(row));
	}

	public updateLayout(left: number, top: number, right: number, bottom: number, rowHeight: number, indent: number): void {
		write_rect_bounds(this.bounds, left, top, right, bottom);
		const width = Math.max(0, right - left), height = Math.max(0, bottom - top);
		let vertical = this.rows.length > ((height / rowHeight) | 0);
		let horizontal = this.contentWidth > width - (vertical ? SCROLLBAR_WIDTH : 0);
		vertical ||= this.rows.length > ((Math.max(0, height - (horizontal ? SCROLLBAR_WIDTH : 0)) / rowHeight) | 0);
		horizontal ||= this.contentWidth > width - (vertical ? SCROLLBAR_WIDTH : 0);
		const contentRight = Math.max(left, right - (vertical ? SCROLLBAR_WIDTH : 0));
		const contentBottom = Math.max(top, bottom - (horizontal ? SCROLLBAR_WIDTH : 0));
		layoutWorkbenchList(this.layout, left, top, contentRight, contentBottom, rowHeight);
		this.layout.contentBottom = top + this.layout.visibleRowCount * rowHeight;
		this.layout.indentWidth = indent;
		this.layout.twistieWidth = indent;
		write_rect_bounds(this.track, contentRight, top, right, contentBottom);
		this.scrollbar.layout(this.track, this.rows.length, this.layout.visibleRowCount, this.scroll);
		write_rect_bounds(this.horizontalTrack, left, contentBottom, contentRight, bottom);
		this.horizontalScrollbar.layout(this.horizontalTrack, this.contentWidth, contentRight - left, this.scrollLeft);
	}

	/** Both tree views use the same wheel axes; vertical units remain rows, horizontal units pixels. */
	public handleWheel(event: WheelInputSnapshot): boolean {
		if (!event.valid || !event.insideViewport || !point_in_rect(event.viewportX, event.viewportY, this.bounds)) return false;
		if ((event.modifiers & KeyModifier.shift) !== 0 && event.deltaX === 0) {
			this.horizontalScrollbar.setScroll(this.scrollLeft + event.deltaY * this.layout.rowHeight * 3);
		} else {
			this.horizontalScrollbar.setScroll(this.scrollLeft + event.deltaX * this.layout.rowHeight * 3);
			this.scroll += event.deltaY * 3;
		}
		this.hoverIndex = -1;
		return true;
	}
}
