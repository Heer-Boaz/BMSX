import { create_rect_bounds, write_rect_bounds } from '../../../machine/ts/common/rect';
import { SCROLLBAR_WIDTH } from '../../common/constants';
import { layoutWorkbenchList } from './list_view';
import { Scrollbar } from './scrollbar';
import type { WorkbenchTreeLayout, WorkbenchTreeNode, WorkbenchTreeState } from './tree_view';

/** Row-addressed tree navigation and scrollbar share one scroll position. */
export class ScrollableWorkbenchTree<Element> implements WorkbenchTreeState<Element> {
	public readonly roots: WorkbenchTreeNode<Element>[] = [];
	public readonly rows: WorkbenchTreeNode<Element>[] = [];
	public selectionIndex = -1;
	public hoverIndex = -1;
	public readonly scrollbar = new Scrollbar('vertical');
	private readonly track = create_rect_bounds();
	public readonly layout: WorkbenchTreeLayout = {
		contentLeft: 0, contentTop: 0, contentRight: 0, contentBottom: 0, rowHeight: 0, visibleRowCount: 0, indentWidth: 0, twistieWidth: 0,
	};
	public get scroll(): number { return this.scrollbar.getScroll() | 0; }
	public set scroll(value: number) { this.scrollbar.setScroll(value); }
	public updateLayout(left: number, top: number, right: number, bottom: number, rowHeight: number, indent: number): void {
		layoutWorkbenchList(this.layout, left, top, right - SCROLLBAR_WIDTH, bottom, rowHeight);
		this.layout.contentBottom = top + this.layout.visibleRowCount * rowHeight;
		this.layout.indentWidth = indent;
		this.layout.twistieWidth = indent;
		write_rect_bounds(this.track, right - SCROLLBAR_WIDTH, top, right, bottom);
		this.scrollbar.layout(this.track, this.rows.length, this.layout.visibleRowCount, this.scroll);
	}
}
