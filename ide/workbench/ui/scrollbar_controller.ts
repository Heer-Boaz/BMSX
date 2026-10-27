import type { PointerSnapshot, ScrollbarKind } from '../../common/models';
import { point_in_rect } from '../../../machine/ts/common/rect';
import { PointerButton } from '../../../hosts/common/input/pointer_event';
import type { PointerCaptureService } from '../../input/pointer/capture';
import type { Scrollbar } from './scrollbar';
import { ScrollbarPointerControl } from './scrollbar_pointer';

export type ScrollbarMap<Kind extends string = ScrollbarKind> = Record<Kind, Scrollbar>;

/** Chooses the active editor/resource axis and publishes its content-unit position. */
export class ScrollbarController<Kind extends string = ScrollbarKind> {
	private readonly pointer: ScrollbarPointerControl;

	constructor(private readonly scrollbars: ScrollbarMap<Kind>, private readonly apply: (kind: Kind, scroll: number) => void, capture: PointerCaptureService) {
		this.pointer = new ScrollbarPointerControl(capture);
	}

	public cancel(): void {
		this.pointer.cancelPointer();
	}

	/**
	 * Try to begin a drag on any visible scrollbar.
	 * Returns true when a drag session starts. Invokes apply(kind, scroll) when paging via track clicks.
	 */
	public begin(kinds: readonly Kind[], snapshot: PointerSnapshot, bottomMargin: number): boolean {
		if (!snapshot.valid || !snapshot.insideViewport || (snapshot.justPressedButtons & PointerButton.Primary) === 0) return false;
		const pointerX = snapshot.viewportX, pointerY = snapshot.viewportY;
		for (let i = 0; i < kinds.length; i += 1) {
			const kind = kinds[i];
			const scrollbar = this.scrollbars[kind];
			const track = scrollbar.getTrack();
			if (!scrollbar.isVisible()) continue;
			const hitsTrack = point_in_rect(pointerX, pointerY, track);
			const extendedHorizontalHit = scrollbar.orientation === 'horizontal'
				&& pointerX >= track.left && pointerX < track.right
				&& pointerY >= track.top && pointerY < track.top + bottomMargin;
			if (!hitsTrack && !extendedHorizontalHit) continue;
			this.pointer.beginDrag(snapshot, scrollbar, scroll => this.apply(kind, scroll));
			return true;
		}
		return false;
	}
}
