import { create_rect_bounds, write_rect_bounds } from '../../../../machine/ts/common/rect';
import { SCROLLBAR_WIDTH, SCROLLBAR_TRACK_COLOR, SCROLLBAR_THUMB_COLOR, COLOR_CODE_BACKGROUND,
	COLOR_RESOURCE_VIEWER_TEXT, COLOR_HEADER_BUTTON_BORDER, COLOR_FOCUS_BORDER,
	COLOR_RESOURCE_PANEL_HIGHLIGHT, COLOR_RESOURCE_PANEL_HIGHLIGHT_TEXT } from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import { api } from '../../../runtime/overlay_api';
import { Scrollbar } from '../../ui/scrollbar';

/** Display coordinates only; source bindings and move semantics belong to the cart projections. */
export type MapGridMarker = { readonly x: number; readonly y: number; readonly glyph: string };
export type MapGridContent = { readonly rows: readonly (readonly string[])[]; readonly width: number; readonly markers: readonly MapGridMarker[] };

/** Two-dimensional authored-cell viewport. Neither layout nor paint reads YAML or the guest. */
export class CartMapGrid {
	public readonly bounds = create_rect_bounds();
	public readonly horizontal = new Scrollbar('horizontal');
	public readonly vertical = new Scrollbar('vertical');
	private readonly track = create_rect_bounds();
	public cellSize = 0;
	private contentValue: MapGridContent | undefined;
	private minX = 0;
	private minY = 0;
	private endX = 0;
	private endY = 0;
	public get content(): MapGridContent | undefined { return this.contentValue; }
	public set content(content: MapGridContent | undefined) {
		if (this.contentValue === content) return;
		this.contentValue = content;
		this.minX = 0; this.minY = 0;
		this.endX = content === undefined ? 0 : content.width;
		this.endY = content === undefined ? 0 : content.rows.length;
		if (content !== undefined) for (const marker of content.markers) {
			this.minX = Math.min(this.minX, marker.x); this.minY = Math.min(this.minY, marker.y);
			this.endX = Math.max(this.endX, marker.x + 1); this.endY = Math.max(this.endY, marker.y + 1);
		}
	}
	public selected: MapGridMarker | undefined;

	public layout(left: number, top: number, right: number, bottom: number): void {
		this.cellSize = Math.max(editorViewState.font.advance('M') + 2, editorViewState.lineHeight + 2);
		write_rect_bounds(this.bounds, left, top, Math.max(left, right - SCROLLBAR_WIDTH), Math.max(top, bottom - SCROLLBAR_WIDTH));
		const bounds = this.bounds;
		write_rect_bounds(this.track, bounds.left, bounds.bottom, bounds.right, bottom);
		this.horizontal.layout(this.track, (this.endX - this.minX) * this.cellSize,
			bounds.right - bounds.left, this.horizontal.getScroll(), this.minX * this.cellSize);
		write_rect_bounds(this.track, bounds.right, bounds.top, right, bounds.bottom);
		this.vertical.layout(this.track, (this.endY - this.minY) * this.cellSize,
			bounds.bottom - bounds.top, this.vertical.getScroll(), this.minY * this.cellSize);
	}

	public reveal(marker: MapGridMarker): void {
		this.horizontal.reveal(marker.x * this.cellSize, (marker.x + 1) * this.cellSize, this.cellSize);
		this.vertical.reveal(marker.y * this.cellSize, (marker.y + 1) * this.cellSize, this.cellSize);
	}
	public columnAt(x: number): number {
		return this.minX + Math.trunc((x - this.bounds.left + this.horizontal.getScroll() - this.minX * this.cellSize) / this.cellSize);
	}
	public rowAt(y: number): number {
		return this.minY + Math.trunc((y - this.bounds.top + this.vertical.getScroll() - this.minY * this.cellSize) / this.cellSize);
	}

	public draw(focused: boolean): void {
		const bounds = this.bounds, content = this.content, size = this.cellSize;
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, COLOR_CODE_BACKGROUND);
		api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
		if (content !== undefined) {
			const x0 = bounds.left - this.horizontal.getScroll(), y0 = bounds.top - this.vertical.getScroll();
			const firstX = this.columnAt(bounds.left), firstY = this.rowAt(bounds.top);
			const lastX = (bounds.right - x0) / size, lastY = (bounds.bottom - y0) / size;
			const font = editorViewState.font.renderFont();
			for (let row = Math.max(0, firstY); row < lastY && row < content.rows.length; row++) {
				const text = content.rows[row], y = y0 + row * size;
				for (let column = Math.max(0, firstX); column < lastX && column < text.length; column++) {
					const glyph = text[column];
					if (glyph !== ' ') api.blit_text_inline_with_font(glyph, x0 + column * size + 1, y + 1, 0, COLOR_RESOURCE_VIEWER_TEXT, font);
				}
			}
			for (const marker of content.markers) {
				if (marker.x < firstX || marker.x >= lastX || marker.y < firstY || marker.y >= lastY) continue;
				const x = x0 + marker.x * size, y = y0 + marker.y * size;
				const selected = marker === this.selected;
				api.fill_rect(x, y, x + size, y + size, 0, COLOR_RESOURCE_PANEL_HIGHLIGHT);
				api.blit_text_inline_with_font(marker.glyph, x + 1, y + 1, 0, COLOR_RESOURCE_PANEL_HIGHLIGHT_TEXT, font);
				api.blit_rect(x, y, x + size, y + size, 0, selected ? COLOR_FOCUS_BORDER : COLOR_HEADER_BUTTON_BORDER);
			}
		}
		api.popClipRect();
		this.horizontal.draw(SCROLLBAR_TRACK_COLOR, SCROLLBAR_THUMB_COLOR);
		this.vertical.draw(SCROLLBAR_TRACK_COLOR, SCROLLBAR_THUMB_COLOR);
		if (focused) api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, COLOR_FOCUS_BORDER);
	}
}
