import { clamp } from '../../../machine/ts/common/clamp';
import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../machine/ts/common/rect';
import { SCROLLBAR_MIN_THUMB_HEIGHT } from '../../common/constants';
import { api } from '../../runtime/overlay_api';

/** Retained thumb geometry. Content coordinates need not be pixels (code uses rows/columns). */
export class Scrollbar {
	private readonly track = create_rect_bounds();
	private readonly thumb = create_rect_bounds();
	private visible = false;
	private contentSize = 0;
	private viewportSize = 0;
	private minScrollValue = 0;
	private scrollValue = 0;
	private maxScrollValue = 0;
	private scrollTravel = 0;
	private trackStart = 0;
	private thumbLength = 0;
	private thumbTravel = 0;

	public constructor(public readonly orientation: 'vertical' | 'horizontal') {}

	/** Geometry changes recompute the range; repeated layout and position retain it. */
	public layout(track: RectBounds, contentSize: number, viewportSize: number, scroll: number, minimum = 0): void {
		if (this.contentSize !== contentSize || this.viewportSize !== viewportSize || this.minScrollValue !== minimum
			|| this.track.left !== track.left || this.track.top !== track.top
			|| this.track.right !== track.right || this.track.bottom !== track.bottom) {
			write_rect_bounds(this.track, track.left, track.top, track.right, track.bottom);
			this.contentSize = contentSize;
			this.viewportSize = viewportSize;
			this.minScrollValue = minimum;
			this.scrollTravel = Math.max(0, contentSize - viewportSize);
			this.maxScrollValue = minimum + this.scrollTravel;
			this.trackStart = this.orientation === 'vertical' ? track.top : track.left;
			const trackLength = this.orientation === 'vertical' ? track.bottom - track.top : track.right - track.left;
			// An empty viewport or a track too short for a grabbable thumb has no drag affordance.
			this.visible = this.scrollTravel > 0 && viewportSize > 0 && trackLength > SCROLLBAR_MIN_THUMB_HEIGHT;
			if (this.visible) {
				this.thumbLength = Math.max(SCROLLBAR_MIN_THUMB_HEIGHT, trackLength * viewportSize / contentSize);
				this.thumbTravel = trackLength - this.thumbLength;
			}
			this.scrollValue = clamp(scroll, minimum, this.maxScrollValue);
			this.updateThumb();
		} else this.setScroll(scroll);
	}

	public setScroll(scroll: number): void {
		const value = clamp(scroll, this.minScrollValue, this.maxScrollValue);
		if (this.scrollValue === value) return;
		this.scrollValue = value;
		this.updateThumb();
	}

	private updateThumb(): void {
		if (!this.visible) return;
		const start = this.trackStart + (this.scrollValue - this.minScrollValue) * this.thumbTravel / this.scrollTravel;
		if (this.orientation === 'vertical') write_rect_bounds(this.thumb, this.track.left, start, this.track.right, start + this.thumbLength);
		else write_rect_bounds(this.thumb, start, this.track.top, start + this.thumbLength, this.track.bottom);
	}

	public draw(trackColor: number, thumbColor: number): void {
		api.fill_rect(this.track.left, this.track.top, this.track.right, this.track.bottom, 0, trackColor);
		if (this.visible) api.fill_rect(this.thumb.left, this.thumb.top, this.thumb.right, this.thumb.bottom, 0, thumbColor);
	}

	public isVisible(): boolean { return this.visible; }
	public getTrack(): RectBounds { return this.track; }
	public getThumb(): RectBounds | null { return this.visible ? this.thumb : null; }
	public getScroll(): number { return this.scrollValue; }

	/** The control has hit a visible track. Track clicks center the thumb before capture. */
	public beginDrag(pointer: number): number {
		const start = this.orientation === 'vertical' ? this.thumb.top : this.thumb.left;
		if (pointer < start || pointer > start + this.thumbLength) this.drag(pointer, this.thumbLength / 2);
		const currentStart = this.orientation === 'vertical' ? this.thumb.top : this.thumb.left;
		return clamp(pointer - currentStart, 0, this.thumbLength);
	}

	/** Capture owns the visible-track lifetime; this is the thumb/content datapath. */
	public drag(pointer: number, pointerOffset: number): number {
		this.setScroll(this.minScrollValue + (pointer - pointerOffset - this.trackStart) * this.scrollTravel / this.thumbTravel);
		return this.scrollValue;
	}
}
