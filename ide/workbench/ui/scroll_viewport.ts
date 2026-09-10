import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../machine/ts/common/rect';
import { SCROLLBAR_WIDTH } from '../../common/constants';
import { Scrollbar } from './scrollbar';

/** Retained vertical content viewport. Scrollbar is the only axis/range owner. */
export class WorkbenchScrollViewport {
	public readonly bounds = create_rect_bounds();
	public readonly scrollbar = new Scrollbar('vertical');
	public contentHeight = 0;
	public revision = 0;
	private readonly track = create_rect_bounds();

	public get scrollTop(): number { return this.scrollbar.getScroll(); }
	public get offsetTop(): number { return this.bounds.top - Math.round(this.scrollTop); }
	public get height(): number { return this.bounds.bottom - this.bounds.top; }

	/** Reserve the track even when content fits, so its appearance cannot reflow text. */
	public layout(left: number, top: number, right: number, bottom: number, contentHeight: number): void {
		const contentRight = Math.max(left, right - SCROLLBAR_WIDTH);
		bottom = Math.max(top, bottom);
		const bounds = this.bounds;
		if (bounds.left === left && bounds.top === top && bounds.right === contentRight
			&& bounds.bottom === bottom && this.track.right === right && this.contentHeight === contentHeight) return;
		write_rect_bounds(bounds, left, top, contentRight, bottom);
		write_rect_bounds(this.track, contentRight, top, right, bottom);
		this.contentHeight = contentHeight;
		this.scrollbar.layout(this.track, contentHeight, this.height, this.scrollTop);
		this.revision += 1;
	}

	public project(content: RectBounds, screen: RectBounds): void {
		const top = this.offsetTop;
		write_rect_bounds(screen, this.bounds.left + content.left, top + content.top,
			this.bounds.left + content.right, top + content.bottom);
	}
}
