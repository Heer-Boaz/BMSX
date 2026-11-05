import { point_in_rect } from '../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../common/models';
import { PointerButton } from '../../../hosts/common/input/pointer_event';
import { type PointerCaptureScope, type PointerCaptureService, type PointerCaptureTarget } from '../../input/pointer/capture';
import type { Scrollbar, ScrollbarDragStart } from './scrollbar';
import { pointerHover, type PointerHoverService, type PointerHoverTarget } from '../../input/pointer/hover';

type ScrollbarGesture = {
	readonly scrollbar: Scrollbar;
	readonly start: ScrollbarDragStart;
	readonly unbindTrack: () => void;
	readonly onScroll: ((scroll: number) => void) | undefined;
	pointer: number;
};

/** One captured gesture, not an attachment to a pane's retained view model.
 * The track owner invalidates geometry; the capture service owns physical input lifetime. */
export class ScrollbarPointerControl implements PointerCaptureTarget, PointerHoverTarget {
	private gesture: ScrollbarGesture | undefined;
	private hovered: Scrollbar | undefined;
	private unbindHoverTrack: (() => void) | undefined;

	public constructor(private readonly capture: PointerCaptureService, private readonly scope?: PointerCaptureScope,
		private readonly hover: PointerHoverService = pointerHover) {}

	private readonly onTrackChanged = (): void => { this.capture.cancelTarget(this); };
	private readonly onHoverTrackChanged = (): void => { this.hover.release(this); };
	public onPointerLeave(): void {
		if (this.hovered !== undefined) this.hovered.hovered = false;
		this.hovered = undefined;
		this.unbindHoverTrack?.(); this.unbindHoverTrack = undefined;
	}

	/** Normal or extended track hit admitted by the owning scroll view. */
	public hoverTrack(scrollbar: Scrollbar): void {
		if (this.hovered !== scrollbar) {
			this.onPointerLeave();
			this.hovered = scrollbar;
			this.unbindHoverTrack = scrollbar.onDidChangeTrack(this.onHoverTrackChanged);
		}
		scrollbar.hovered = true;
		this.hover.visit(this);
	}

	public readonly cancelPointer = (): void => {
		this.capture.release(this);
		this.hover.release(this);
		if (this.gesture !== undefined) this.gesture.scrollbar.dragging = false;
		this.gesture?.unbindTrack();
		this.gesture = undefined;
	};

	/** Track hits consume pointer input without taking keyboard focus. */
	public handlePointer(snapshot: PointerSnapshot, scrollbar: Scrollbar, onDragStart?: () => void): boolean {
		if (!scrollbar.isVisible() || !snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, scrollbar.getTrack())) return false;
		this.hoverTrack(scrollbar);
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) {
			onDragStart?.();
			this.beginDrag(snapshot, scrollbar);
		}
		return true;
	}

	/** The owner has admitted a primary press, including an editor's extended track hit area. */
	public beginDrag(snapshot: PointerSnapshot, scrollbar: Scrollbar, onScroll?: (scroll: number) => void): void {
		this.cancelPointer(); // A new track replaces this control's old track subscription.
		if (!this.capture.capture(this, PointerButton.Primary, this.scope)) return;
		const pointer = scrollbar.orientation === 'vertical' ? snapshot.viewportY : snapshot.viewportX;
		const previous = scrollbar.getScroll();
		const start = scrollbar.beginDrag(pointer);
		scrollbar.dragging = true;
		this.gesture = { scrollbar, start, pointer, onScroll, unbindTrack: scrollbar.onDidChangeTrack(this.onTrackChanged) };
		// A coalesced click has its final coordinates already; it cannot leave a live grab.
		if ((snapshot.justReleasedButtons & PointerButton.Primary) !== 0) this.releaseCapturedPointer(snapshot);
		if (scrollbar.getScroll() !== previous) onScroll?.(scrollbar.getScroll());
	}

	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		this.move(this.gesture!, snapshot);
	}

	public releaseCapturedPointer(snapshot: PointerSnapshot): void {
		const gesture = this.gesture!;
		this.cancelPointer();
		this.move(gesture, snapshot);
		if (snapshot.valid && snapshot.insideViewport && gesture.scrollbar.isVisible()
			&& point_in_rect(snapshot.viewportX, snapshot.viewportY, gesture.scrollbar.getTrack())) this.hoverTrack(gesture.scrollbar);
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
