import type { BmsxConsoleApi } from '../api';
import { clamp } from '../../utils/clamp';
import { SCROLLBAR_MIN_THUMB_HEIGHT } from './constants';
import type { ScrollbarKind } from './types';
import type { RectBounds } from '../../rompack/rompack';
import { computeMaximumScrollColumn, getActiveResourceViewer, resourceViewerTextCapacity } from './console_cart_editor';
import { ensureVisualLines, getVisualLineCount } from './text_utils';
import { ide_state } from './ide_state';

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
		api.rectfill(this.track.left, this.track.top, this.track.right, this.track.bottom, undefined, trackColor);
		const thumbRect = this.thumb;
		if (!thumbRect) {
			return;
		}
		api.rectfill(thumbRect.left, thumbRect.top, thumbRect.right, thumbRect.bottom, undefined, thumbColor);
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

export type ScrollbarMap = Record<ScrollbarKind, ConsoleScrollbar>;

export class ScrollbarController {
	private active: { kind: ScrollbarKind; pointerOffset: number } | null = null;

	constructor(private readonly scrollbars: ScrollbarMap) { }

	public hasActiveDrag(): boolean {
		return this.active !== null;
	}

	public getActive(): { kind: ScrollbarKind; pointerOffset: number } | null {
		return this.active;
	}

	public cancel(): void {
		this.active = null;
	}

	/**
	 * Try to begin a drag on any visible scrollbar.
	 * Returns true when a drag session starts. Invokes apply(kind, scroll) when paging via track clicks.
	 */
	public begin(pointerX: number, pointerY: number, primaryPressed: boolean, bottomMargin: number, apply: (kind: ScrollbarKind, scroll: number) => void): boolean {
		if (!primaryPressed) return false;
		const order: ScrollbarKind[] = ['codeVertical', 'codeHorizontal', 'resourceVertical', 'resourceHorizontal', 'viewerVertical'];
		for (let i = 0; i < order.length; i += 1) {
			const kind = order[i];
			const scrollbar = this.scrollbars[kind];
			const track = scrollbar.getTrack();
			if (!track) continue;
			const thumb = scrollbar.getThumb();
			const pointerCoord = scrollbar.orientation === 'vertical' ? pointerY : pointerX;
			const hitsThumb = !!thumb && this.pointInRect(pointerX, pointerY, thumb);
			const hitsTrack = this.pointInRect(pointerX, pointerY, track);
			const extendedHorizontalHit = scrollbar.orientation === 'horizontal'
				&& pointerX >= track.left && pointerX < track.right
				&& pointerY >= track.top && pointerY < track.top + bottomMargin;
			if (!hitsThumb && !hitsTrack && !extendedHorizontalHit) continue;
			const pointerOffset = scrollbar.beginDrag(pointerCoord);
			if (pointerOffset === null) continue;
			if (!hitsThumb) {
				apply(kind, scrollbar.getScroll());
			}
			this.active = { kind, pointerOffset };
			return true;
		}
		return false;
	}

	/**
	 * Update the active drag session. Returns true if it updated scrolling.
	 */
	public update(pointerX: number, pointerY: number, primaryPressed: boolean, apply: (kind: ScrollbarKind, scroll: number) => void): boolean {
		if (!this.active) return false;
		if (!primaryPressed) {
			this.active = null;
			return false;
		}
		const scrollbar = this.scrollbars[this.active.kind];
		if (!scrollbar.isVisible()) {
			this.active = null;
			return false;
		}
		const pointerCoord = scrollbar.orientation === 'vertical' ? pointerY : pointerX;
		const newScroll = scrollbar.drag(pointerCoord, this.active.pointerOffset);
		apply(this.active.kind, newScroll);
		return true;
	}

	private pointInRect(x: number, y: number, r: RectBounds): boolean {
		return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
	}
}
export function applyScrollbarScroll(kind: ScrollbarKind, scroll: number): void {
	if (Number.isNaN(scroll)) {
		return;
	}
	switch (kind) {
		case 'codeVertical': {
			ensureVisualLines();
			const rowCount = Math.max(1, ide_state.cachedVisibleRowCount);
			const maxScroll = Math.max(0, getVisualLineCount() - rowCount);
			ide_state.scrollRow = clamp(Math.round(scroll), 0, maxScroll);
			ide_state.cursorRevealSuspended = true;
			break;
		}
		case 'codeHorizontal': {
			if (ide_state.wordWrapEnabled) {
				ide_state.scrollColumn = 0;
				break;
			}
			const maxScroll = computeMaximumScrollColumn();
			ide_state.scrollColumn = clamp(Math.round(scroll), 0, maxScroll);
			ide_state.cursorRevealSuspended = true;
			break;
		}
		case 'resourceVertical': {
			ide_state.resourcePanel.setScroll(scroll);
			ide_state.resourcePanel.setFocused(true);
			const s = ide_state.resourcePanel.getStateForRender();
			ide_state.resourcePanelFocused = s.focused;
			break;
		}
		case 'resourceHorizontal': {
			ide_state.resourcePanel.setHScroll(scroll);
			ide_state.resourcePanel.setFocused(true);
			const s = ide_state.resourcePanel.getStateForRender();
			ide_state.resourcePanelFocused = s.focused;
			break;
		}
		case 'viewerVertical': {
			const viewer = getActiveResourceViewer();
			if (!viewer) {
				break;
			}
			const capacity = resourceViewerTextCapacity(viewer);
			const maxScroll = Math.max(0, viewer.lines.length - capacity);
			viewer.scroll = clamp(Math.round(scroll), 0, maxScroll);
			break;
		}
	}
}

