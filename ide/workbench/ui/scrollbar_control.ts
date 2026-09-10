import { point_in_rect } from '../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../common/models';
import { PointerButton } from '../../input/pointer/buttons';
import type { PointerCaptureService, PointerCaptureTarget } from '../../input/pointer/capture';
import type { Scrollbar } from './scrollbar';

/** Captured scrollbar gestures; geometry belongs to Scrollbar, focus stays with the editor. */
export class WorkbenchScrollbarControl implements PointerCaptureTarget {
	private dragging = false;
	private revision = 0;
	private pointerOffset = 0;

	public constructor(private readonly scrollbar: Scrollbar, private readonly capture: PointerCaptureService) {}

	public begin(snapshot: PointerSnapshot): boolean {
		const bar = this.scrollbar;
		if (!bar.isVisible() || !point_in_rect(snapshot.viewportX, snapshot.viewportY, bar.getTrack())) return false;
		this.pointerOffset = bar.beginDrag(bar.orientation === 'horizontal' ? snapshot.viewportX : snapshot.viewportY);
		this.capture.capture(this);
		this.revision = bar.revision;
		this.dragging = true;
		if ((snapshot.justReleasedButtons & PointerButton.Primary) !== 0) this.releaseCapturedPointer(snapshot);
		return true;
	}

	public update(): void {
		if (this.dragging && this.revision !== this.scrollbar.revision) this.cancelPointer();
	}

	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		this.update();
		if (this.dragging) this.scrollbar.drag(this.scrollbar.orientation === 'horizontal' ? snapshot.viewportX : snapshot.viewportY, this.pointerOffset);
	}

	public releaseCapturedPointer(snapshot: PointerSnapshot): void { this.handleCapturedPointer(snapshot); this.cancelPointer(); }
	public cancelPointer(): void { this.capture.release(this); this.dragging = false; }
}
