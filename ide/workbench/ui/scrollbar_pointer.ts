import { point_in_rect } from '../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../common/models';
import { PointerButton } from '../../input/pointer/buttons';
import { WORKBENCH_POINTER_SCOPE, type PointerCaptureScope, type PointerCaptureService, type PointerCaptureTarget } from '../../input/pointer/capture';
import type { Scrollbar, ScrollbarDragStart } from './scrollbar';

type ScrollbarGesture = {
	readonly scrollbar: Scrollbar;
	readonly start: ScrollbarDragStart;
	readonly unbindTrack: () => void;
	readonly onScroll: ((scroll: number) => void) | undefined;
	pointer: number;
};

/** One captured gesture, not an attachment to a pane's retained view model.
 * The track owner invalidates geometry; the capture service owns physical input lifetime. */
export class ScrollbarPointerControl implements PointerCaptureTarget {
	private gesture: ScrollbarGesture | undefined;

	public constructor(private readonly capture: PointerCaptureService, private readonly scope: PointerCaptureScope = WORKBENCH_POINTER_SCOPE) {}

	public readonly cancelPointer = (): void => {
		this.capture.release(this);
		this.gesture?.unbindTrack();
		this.gesture = undefined;
	};

	/** Track hits consume pointer input without taking keyboard focus. */
	public handlePointer(snapshot: PointerSnapshot, scrollbar: Scrollbar): boolean {
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, scrollbar.getTrack())) return false;
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0 && scrollbar.isVisible()) this.beginDrag(snapshot, scrollbar);
		return true;
	}

	/** The owner has admitted a primary press, including an editor's extended track hit area. */
	public beginDrag(snapshot: PointerSnapshot, scrollbar: Scrollbar, onScroll?: (scroll: number) => void): void {
		this.capture.capture(this, PointerButton.Primary, this.scope);
		const pointer = scrollbar.orientation === 'vertical' ? snapshot.viewportY : snapshot.viewportX;
		const previous = scrollbar.getScroll();
		const start = scrollbar.beginDrag(pointer);
		this.gesture = { scrollbar, start, pointer, onScroll, unbindTrack: scrollbar.onDidChangeTrack(this.cancelPointer) };
		// A coalesced click has its final coordinates already; it cannot leave a live grab.
		if ((snapshot.justReleasedButtons & PointerButton.Primary) !== 0) this.cancelPointer();
		if (scrollbar.getScroll() !== previous) onScroll?.(scrollbar.getScroll());
	}

	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		this.move(this.gesture!, snapshot);
	}

	public releaseCapturedPointer(snapshot: PointerSnapshot): void {
		const gesture = this.gesture!;
		this.cancelPointer();
		this.move(gesture, snapshot);
	}

	private move(gesture: ScrollbarGesture, snapshot: PointerSnapshot): void {
		const bar = gesture.scrollbar;
		const pointer = bar.orientation === 'vertical' ? snapshot.viewportY : snapshot.viewportX;
		if (pointer === gesture.pointer) return;
		gesture.pointer = pointer;
		const previous = bar.getScroll();
		const scroll = bar.drag(pointer, gesture.start);
		if (scroll !== previous) gesture.onScroll?.(scroll);
	}
}
