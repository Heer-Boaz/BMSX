import type { ScrollbarKind } from '../../common/models';
import { point_in_rect } from '../../../machine/ts/common/rect';
import type { Scrollbar } from '../../workbench/ui/scrollbar';

export type ScrollbarMap = Record<ScrollbarKind, Scrollbar>;

export class ScrollbarController {
	private active: { kind: ScrollbarKind; pointerOffset: number } | null = null;

	constructor(private readonly scrollbars: ScrollbarMap, private readonly apply: (kind: ScrollbarKind, scroll: number) => void) { }

	public hasActiveDrag(): boolean {
		return this.active !== null;
	}

	public cancel(): void {
		this.active = null;
	}

	/**
	 * Try to begin a drag on any visible scrollbar.
	 * Returns true when a drag session starts. Invokes apply(kind, scroll) when paging via track clicks.
	 */
	public begin(kinds: readonly ScrollbarKind[], pointerX: number, pointerY: number, primaryPressed: boolean, bottomMargin: number): boolean {
		if (!primaryPressed) return false;
		for (let i = 0; i < kinds.length; i += 1) {
			const kind = kinds[i];
			const scrollbar = this.scrollbars[kind];
			const track = scrollbar.getTrack();
			if (!scrollbar.isVisible()) continue;
			const pointerCoord = scrollbar.orientation === 'vertical' ? pointerY : pointerX;
			const hitsTrack = point_in_rect(pointerX, pointerY, track);
			const extendedHorizontalHit = scrollbar.orientation === 'horizontal'
				&& pointerX >= track.left && pointerX < track.right
				&& pointerY >= track.top && pointerY < track.top + bottomMargin;
			if (!hitsTrack && !extendedHorizontalHit) continue;
			const hitsThumb = point_in_rect(pointerX, pointerY, scrollbar.getThumb()!);
			const pointerOffset = scrollbar.beginDrag(pointerCoord);
			if (!hitsThumb) {
				this.apply(kind, scrollbar.getScroll());
			}
			this.active = { kind, pointerOffset };
			return true;
		}
		return false;
	}

	/**
	 * Update the active drag session. Returns true if it updated scrolling.
	 */
	public update(pointerX: number, pointerY: number, primaryPressed: boolean): boolean {
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
		this.apply(this.active.kind, newScroll);
		return true;
	}
}
