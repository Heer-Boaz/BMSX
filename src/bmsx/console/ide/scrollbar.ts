import type { BmsxConsoleApi } from '../api';
import { clamp } from '../../utils/utils';
import { SCROLLBAR_MIN_THUMB_HEIGHT } from './constants';
import type { RectBounds, ScrollbarKind } from './types';

export class ConsoleScrollbar {
	public readonly orientation: 'vertical' | 'horizontal';
	private track: RectBounds | null = null;
	private thumb: RectBounds | null = null;
	private scrollValue = 0;
	private maxScrollValue = 0;
	private viewportSize = 0;
	private contentSize = 0;

	constructor(public readonly kind: ScrollbarKind, orientation: 'vertical' | 'horizontal') {
		this.orientation = orientation;
	}

	public layout(track: RectBounds, contentSize: number, viewportSize: number, scroll: number): void {
		this.track = track;
		this.contentSize = Math.max(0, contentSize);
		this.viewportSize = Math.max(0, viewportSize);
		this.maxScrollValue = Math.max(0, this.contentSize - this.viewportSize);
		this.scrollValue = clamp(scroll, 0, this.maxScrollValue);
		this.updateThumb();
	}

	private updateThumb(): void {
		if (!this.track || this.viewportSize <= 0 || this.contentSize <= this.viewportSize) {
			this.thumb = null;
			return;
		}
		const trackStart = this.orientation === 'vertical' ? this.track.top : this.track.left;
		const trackEnd = this.orientation === 'vertical' ? this.track.bottom : this.track.right;
		const trackLength = Math.max(0, trackEnd - trackStart);
		if (trackLength <= 0) {
			this.thumb = null;
			return;
		}
		const viewportRatio = clamp(this.viewportSize / this.contentSize, 0, 1);
		let thumbLength = Math.max(SCROLLBAR_MIN_THUMB_HEIGHT, trackLength * viewportRatio);
		if (thumbLength > trackLength) {
			thumbLength = trackLength;
		}
		if (thumbLength <= 0) {
			this.thumb = null;
			return;
		}
		const maxThumbTravel = Math.max(0, trackLength - thumbLength);
		const normalized = this.maxScrollValue === 0 ? 0 : this.scrollValue / this.maxScrollValue;
		const thumbStart = trackStart + normalized * maxThumbTravel;
		const thumbEnd = thumbStart + thumbLength;
		if (this.orientation === 'vertical') {
			this.thumb = { left: this.track.left, top: thumbStart, right: this.track.right, bottom: thumbEnd };
		} else {
			this.thumb = { left: thumbStart, top: this.track.top, right: thumbEnd, bottom: this.track.bottom };
		}
	}

	public draw(api: BmsxConsoleApi, trackColor: number, thumbColor: number): void {
		if (!this.track) {
			return;
		}
		api.rectfill(this.track.left, this.track.top, this.track.right, this.track.bottom, trackColor);
		const thumbRect = this.thumb;
		if (!thumbRect) {
			return;
		}
		api.rectfill(thumbRect.left, thumbRect.top, thumbRect.right, thumbRect.bottom, thumbColor);
	}

	public isVisible(): boolean {
		return this.thumb !== null;
	}

	public getTrack(): RectBounds | null {
		return this.track;
	}

	public getThumb(): RectBounds | null {
		return this.thumb;
	}

	public getMaxScroll(): number {
		return this.maxScrollValue;
	}

	public getScroll(): number {
		return this.scrollValue;
	}

	public beginDrag(pointer: number): number | null {
		if (!this.track || this.maxScrollValue <= 0) {
			return null;
		}
		const thumbRect = this.thumb;
		if (!thumbRect) {
			return null;
		}
		const trackStart = this.orientation === 'vertical' ? this.track.top : this.track.left;
		const trackEnd = this.orientation === 'vertical' ? this.track.bottom : this.track.right;
		const thumbStart = this.orientation === 'vertical' ? thumbRect.top : thumbRect.left;
		const thumbEnd = this.orientation === 'vertical' ? thumbRect.bottom : thumbRect.right;
		const thumbLength = this.orientation === 'vertical'
			? (thumbRect.bottom - thumbRect.top)
			: (thumbRect.right - thumbRect.left);
		if (pointer < trackStart || pointer > trackEnd) {
			return null;
		}
		if (pointer < thumbStart || pointer > thumbEnd) {
			const maxThumbTravel = Math.max(0, (trackEnd - trackStart) - thumbLength);
			const target = clamp(pointer - thumbLength * 0.5, trackStart, trackEnd - thumbLength);
			const normalized = maxThumbTravel === 0 ? 0 : (target - trackStart) / maxThumbTravel;
			this.scrollValue = clamp(normalized * this.maxScrollValue, 0, this.maxScrollValue);
			this.updateThumb();
			const updatedThumb = this.thumb;
			if (!updatedThumb) {
				return null;
			}
			const updatedStart = this.orientation === 'vertical' ? updatedThumb.top : updatedThumb.left;
			return clamp(pointer - updatedStart, 0, thumbLength);
		}
		return clamp(pointer - thumbStart, 0, thumbLength);
	}

	public drag(pointer: number, pointerOffset: number): number {
		if (!this.track || !this.thumb) {
			return this.scrollValue;
		}
		if (this.maxScrollValue <= 0) {
			this.scrollValue = 0;
			this.updateThumb();
			return this.scrollValue;
		}
		const trackStart = this.orientation === 'vertical' ? this.track.top : this.track.left;
		const trackEnd = this.orientation === 'vertical' ? this.track.bottom : this.track.right;
		const thumbLength = this.orientation === 'vertical'
			? (this.thumb.bottom - this.thumb.top)
			: (this.thumb.right - this.thumb.left);
		const maxThumbTravel = Math.max(0, (trackEnd - trackStart) - thumbLength);
		if (maxThumbTravel <= 0) {
			this.scrollValue = 0;
			this.updateThumb();
			return this.scrollValue;
		}
		const clampedPosition = clamp(pointer - pointerOffset, trackStart, trackEnd - thumbLength);
		const normalized = (clampedPosition - trackStart) / maxThumbTravel;
		this.scrollValue = clamp(normalized * this.maxScrollValue, 0, this.maxScrollValue);
		this.updateThumb();
		return this.scrollValue;
	}
}
