import { clamp } from '../../../machine/ts/common/clamp';
import { create_rect_bounds, write_rect_bounds } from '../../../machine/ts/common/rect';
import type { HostOverlayTransform } from '../../../machine/ts/render/host_overlay/transform';
import { SCROLLBAR_WIDTH } from '../../common/constants';
import { Scrollbar } from './scrollbar';

const IMAGE_ZOOM_LEVELS = [1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16] as const;

/** Original image pixels stay unchanged; scrollbars own scaled host-pixel offsets. */
export class WorkbenchImageViewport {
	public readonly bounds = create_rect_bounds();
	public readonly horizontal = new Scrollbar('horizontal');
	public readonly vertical = new Scrollbar('vertical');
	private readonly canvas = create_rect_bounds();
	private readonly horizontalTrack = create_rect_bounds();
	private readonly verticalTrack = create_rect_bounds();
	private readonly drawTransform: HostOverlayTransform = { scale: 1, offsetX: 0, offsetY: 0 };
	private imageWidth = 0;
	private imageHeight = 0;
	private scaleMode: 'fit' | number = 'fit';
	private scaleValue = 1;

	public get scale(): number { return this.scaleValue; }
	public get mode(): 'fit' | number { return this.scaleMode; }

	/** Each axis centers fitting content and scrolls oversized content. */
	public get transform(): Readonly<HostOverlayTransform> {
		const width = this.bounds.right - this.bounds.left;
		const height = this.bounds.bottom - this.bounds.top;
		this.drawTransform.scale = this.scaleValue;
		this.drawTransform.offsetX = this.bounds.left + Math.max(0, width - this.imageWidth * this.scaleValue) / 2 - this.horizontal.getScroll();
		this.drawTransform.offsetY = this.bounds.top + Math.max(0, height - this.imageHeight * this.scaleValue) / 2 - this.vertical.getScroll();
		return this.drawTransform;
	}

	/** A newly selected image starts at Fit, even when its dimensions match the previous image. */
	public setImage(width: number, height: number): void {
		this.imageWidth = width;
		this.imageHeight = height;
		this.scaleMode = 'fit';
		this.horizontal.setScroll(0);
		this.vertical.setScroll(0);
		this.updateScrollBounds();
	}

	/** Keep scrollbar gutters stable when a zoom level changes whether the image fits. */
	public layout(left: number, top: number, right: number, bottom: number): void {
		if (this.canvas.left === left && this.canvas.top === top && this.canvas.right === right && this.canvas.bottom === bottom) return;
		write_rect_bounds(this.canvas, left, top, right, bottom);
		const contentRight = Math.max(left, right - SCROLLBAR_WIDTH);
		const contentBottom = Math.max(top, bottom - SCROLLBAR_WIDTH);
		write_rect_bounds(this.bounds, left, top, contentRight, contentBottom);
		write_rect_bounds(this.horizontalTrack, left, contentBottom, contentRight, bottom);
		write_rect_bounds(this.verticalTrack, contentRight, top, right, contentBottom);
		this.updateScrollBounds();
	}

	/** Preserve the source pixel under the anchor, subject to the image's physical scroll extent. */
	public setScale(mode: 'fit' | number, anchorX = (this.bounds.left + this.bounds.right) / 2, anchorY = (this.bounds.top + this.bounds.bottom) / 2): void {
		if (mode === this.scaleMode) return;
		const before = this.transform;
		const sourceX = (anchorX - before.offsetX) / before.scale;
		const sourceY = (anchorY - before.offsetY) / before.scale;
		this.scaleMode = mode;
		this.updateScrollBounds();
		const after = this.transform;
		this.horizontal.setScroll(sourceX * after.scale + after.offsetX + this.horizontal.getScroll() - anchorX);
		this.vertical.setScroll(sourceY * after.scale + after.offsetY + this.vertical.getScroll() - anchorY);
	}

	/** Exact reciprocal/integer zoom steps; gestures saturate at either end of the sequence. */
	public zoomBySteps(steps: number, anchorX?: number, anchorY?: number): void {
		const last = IMAGE_ZOOM_LEVELS.length - 1;
		if (steps === 0 || (steps < 0 && this.scaleValue <= IMAGE_ZOOM_LEVELS[0])
			|| (steps > 0 && this.scaleValue >= IMAGE_ZOOM_LEVELS[last])) return;
		let index: number;
		if (steps > 0) {
			index = 0;
			while (index < last && IMAGE_ZOOM_LEVELS[index] <= this.scaleValue) index += 1;
			index += steps - 1;
		} else {
			index = last;
			while (index > 0 && IMAGE_ZOOM_LEVELS[index] >= this.scaleValue) index -= 1;
			index += steps + 1;
		}
		this.setScale(IMAGE_ZOOM_LEVELS[clamp(index, 0, last)], anchorX, anchorY);
	}

	public pan(dx: number, dy: number): void {
		this.horizontal.setScroll(this.horizontal.getScroll() + dx);
		this.vertical.setScroll(this.vertical.getScroll() + dy);
	}

	private updateScrollBounds(): void {
		const width = this.bounds.right - this.bounds.left;
		const height = this.bounds.bottom - this.bounds.top;
		this.scaleValue = this.scaleMode === 'fit' ? Math.min(1, width / this.imageWidth, height / this.imageHeight) : this.scaleMode;
		this.horizontal.layout(this.horizontalTrack, this.imageWidth * this.scaleValue, width, this.horizontal.getScroll());
		this.vertical.layout(this.verticalTrack, this.imageHeight * this.scaleValue, height, this.vertical.getScroll());
	}
}
