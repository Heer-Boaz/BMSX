import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { SCROLLBAR_WIDTH, SCROLLBAR_TRACK_COLOR, SCROLLBAR_THUMB_COLOR, COLOR_RESOURCE_VIEWER_BACKGROUND,
	COLOR_RESOURCE_VIEWER_TEXT, COLOR_HEADER_BUTTON_BORDER, COLOR_FOCUS_BORDER,
	COLOR_CANVAS_GRID_MINOR, COLOR_CANVAS_GRID_MAJOR, COLOR_CANVAS_BOUNDARY,
	COLOR_RESOURCE_PANEL_HIGHLIGHT, COLOR_RESOURCE_PANEL_HIGHLIGHT_TEXT } from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import { api } from '../../../runtime/overlay_api';
import { Scrollbar } from '../../ui/scrollbar';
import type { EditorFont } from '../../../editor/ui/view/font';

/** Display coordinates only; source bindings and move semantics belong to the cart projections. */
export type MapGridMarker = { readonly x: number; readonly y: number; readonly glyph: string };
export type MapGridContent = { readonly rows: readonly (readonly string[])[]; readonly width: number; readonly markers: readonly MapGridMarker[] };

/** World-cell coordinates, including the fraction of the first visible cell. */
export type CartMapGridPosition = { readonly x: number; readonly y: number };
export type CartMapGridViewState = CartMapGridPosition & { readonly reveal?: CartMapGridPosition };

const gridMeasurements = new WeakMap<EditorFont, { readonly cellSize: number; readonly minimumWidth: number }>();

/** Eight complete authored cells plus the retained scrollbar lane, before any grid is attached. */
export function measureCartMapGrid(font: EditorFont): { readonly cellSize: number; readonly minimumWidth: number } {
	let measured = gridMeasurements.get(font);
	if (measured === undefined) {
		const cellSize = Math.max(font.charAdvance + 2, font.lineHeight + 2);
		measured = { cellSize, minimumWidth: cellSize * 8 + SCROLLBAR_WIDTH }; gridMeasurements.set(font, measured);
	}
	return measured;
}

/** Two-dimensional authored-cell viewport. Neither layout nor paint reads YAML or the guest. */
export class CartMapGrid {
	public readonly bounds = create_rect_bounds();
	public readonly horizontal = new Scrollbar('horizontal');
	public readonly vertical = new Scrollbar('vertical');
	private readonly track = create_rect_bounds();
	public cellSize = 0;
	private visible = false;
	private positionX = 0;
	private positionY = 0;
	private restorePending = false;
	private pendingReveal: CartMapGridPosition | undefined;
	private contentValue: MapGridContent | undefined;
	private minX = 0;
	private minY = 0;
	private endX = 0;
	private endY = 0;
	private readonly range = create_rect_bounds();
	private rangeScrollX = 0;
	private rangeScrollY = 0;
	private rangeWidth = 0;
	private rangeHeight = 0;
	private rangeCellSize = 0;
	private rangeVisible = false;
	/** Intersecting world cells, with exclusive right/bottom edges; not the authored sheet extent. */
	public get visibleRange(): Readonly<RectBounds> {
		const x = this.horizontal.getScroll(), y = this.vertical.getScroll();
		const width = this.bounds.right - this.bounds.left, height = this.bounds.bottom - this.bounds.top;
		if (x !== this.rangeScrollX || y !== this.rangeScrollY || width !== this.rangeWidth || height !== this.rangeHeight
			|| this.cellSize !== this.rangeCellSize || this.visible !== this.rangeVisible) {
			this.rangeScrollX = x; this.rangeScrollY = y; this.rangeWidth = width; this.rangeHeight = height;
			this.rangeCellSize = this.cellSize; this.rangeVisible = this.visible;
			if (this.visible) {
				write_rect_bounds(this.range, this.columnAt(this.bounds.left), this.rowAt(this.bounds.top),
					this.columnAt(this.bounds.right) + ((x + width) % this.cellSize === 0 ? 0 : 1),
					this.rowAt(this.bounds.bottom) + ((y + height) % this.cellSize === 0 ? 0 : 1));
			} else write_rect_bounds(this.range, 0, 0, 0, 0);
		}
		return this.range;
	}
	public get content(): MapGridContent | undefined { return this.contentValue; }
	public set content(content: MapGridContent | undefined) {
		if (this.contentValue === content) return;
		this.pendingReveal = undefined;
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

	/** Eight complete authored cells plus the retained scrollbar lane. */
	public get minimumWidth(): number { return measureCartMapGrid(editorViewState.font).minimumWidth; }

	public captureView(): CartMapGridViewState {
		if (this.visible && !this.restorePending) this.capturePosition();
		return this.pendingReveal === undefined ? { x: this.positionX, y: this.positionY }
			: { x: this.positionX, y: this.positionY, reveal: { x: this.pendingReveal.x, y: this.pendingReveal.y } };
	}

	/** Bookmarks have no pixel range until the first visible measured arrangement. */
	public restoreView(position: CartMapGridViewState): void {
		this.positionX = position.x; this.positionY = position.y;
		this.restorePending = true; this.pendingReveal = position.reveal;
	}

	public layout(left: number, top: number, right: number, bottom: number): void {
		if (this.visible && !this.restorePending) this.capturePosition();
		write_rect_bounds(this.bounds, left, top, Math.max(left, right - SCROLLBAR_WIDTH), Math.max(top, bottom - SCROLLBAR_WIDTH));
		const bounds = this.bounds;
		this.visible = bounds.right > bounds.left && bounds.bottom > bounds.top;
		if (!this.visible) {
			write_rect_bounds(this.track, left, top, left, top);
			this.horizontal.layout(this.track, 0, 0, 0);
			this.vertical.layout(this.track, 0, 0, 0);
			return;
		}
		this.cellSize = measureCartMapGrid(editorViewState.font).cellSize;
		write_rect_bounds(this.track, bounds.left, bounds.bottom, bounds.right, bottom);
		this.horizontal.layout(this.track, (this.endX - this.minX) * this.cellSize,
			bounds.right - bounds.left, this.positionX * this.cellSize, this.minX * this.cellSize);
		write_rect_bounds(this.track, bounds.right, bounds.top, right, bounds.bottom);
		this.vertical.layout(this.track, (this.endY - this.minY) * this.cellSize,
			bounds.bottom - bounds.top, this.positionY * this.cellSize, this.minY * this.cellSize);
		this.restorePending = false;
		const reveal = this.pendingReveal;
		this.pendingReveal = undefined;
		if (reveal !== undefined) this.reveal(reveal);
		else this.capturePosition();
	}

	public reveal(marker: CartMapGridPosition): void {
		if (!this.visible || this.restorePending) { this.pendingReveal = marker; return; }
		this.horizontal.reveal(marker.x * this.cellSize, (marker.x + 1) * this.cellSize, this.cellSize);
		this.vertical.reveal(marker.y * this.cellSize, (marker.y + 1) * this.cellSize, this.cellSize);
		this.capturePosition();
	}

	public scrollBy(dx: number, dy: number): void {
		this.pendingReveal = undefined;
		if (!this.visible || this.restorePending) { this.positionX += dx; this.positionY += dy; return; }
		this.horizontal.setScroll(this.horizontal.getScroll() + dx * this.cellSize);
		this.vertical.setScroll(this.vertical.getScroll() + dy * this.cellSize);
		this.capturePosition();
	}

	private capturePosition(): void {
		this.positionX = this.horizontal.getScroll() / this.cellSize;
		this.positionY = this.vertical.getScroll() / this.cellSize;
	}

	public columnAt(x: number): number {
		return this.minX + Math.trunc((x - this.bounds.left + this.horizontal.getScroll() - this.minX * this.cellSize) / this.cellSize);
	}
	public rowAt(y: number): number {
		return this.minY + Math.trunc((y - this.bounds.top + this.vertical.getScroll() - this.minY * this.cellSize) / this.cellSize);
	}

	public draw(focused: boolean): void {
		if (!this.visible) return;
		const bounds = this.bounds, content = this.content, size = this.cellSize;
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, COLOR_RESOURCE_VIEWER_BACKGROUND);
		api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
		if (content !== undefined) {
			const x0 = bounds.left - this.horizontal.getScroll(), y0 = bounds.top - this.vertical.getScroll();
			const range = this.visibleRange;
			for (let column = range.left; column < range.right; column++) {
				const x = x0 + column * size;
				api.fill_rect(x, bounds.top, x + 1, bounds.bottom, 0, column % 8 === 0 ? COLOR_CANVAS_GRID_MAJOR : COLOR_CANVAS_GRID_MINOR);
			}
			for (let row = range.top; row < range.bottom; row++) {
				const y = y0 + row * size;
				api.fill_rect(bounds.left, y, bounds.right, y + 1, 0, row % 8 === 0 ? COLOR_CANVAS_GRID_MAJOR : COLOR_CANVAS_GRID_MINOR);
			}
			api.blit_rect(x0, y0, x0 + content.width * size, y0 + content.rows.length * size, 0, COLOR_CANVAS_BOUNDARY);
			const firstX = range.left, firstY = range.top;
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
