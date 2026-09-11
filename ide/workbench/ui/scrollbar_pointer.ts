import { point_in_rect } from '../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../common/models';
import { PointerButton } from '../../input/pointer/buttons';
import { WORKBENCH_POINTER_SCOPE, type PointerCaptureScope, type PointerCaptureService, type PointerCaptureTarget } from '../../input/pointer/capture';
import type { Scrollbar } from './scrollbar';

/** Axis-only pointer capture. Scrolling a thumb never changes text/control focus. */
export class ScrollbarPointerControl implements PointerCaptureTarget {
	private input: Scrollbar | undefined;
	private revision = 0;
	private dragging = false;
	private pointerOffset = 0;

	public constructor(private readonly capture: PointerCaptureService, private readonly scope: PointerCaptureScope = WORKBENCH_POINTER_SCOPE) {}

	public setInput(input: Scrollbar): void {
		this.cancelPointer();
		this.input = input;
		this.revision = input.revision;
	}

	public clearInput(): void {
		this.cancelPointer();
		this.input = undefined;
	}

	public cancelPointer(): void {
		this.capture.release(this);
		this.dragging = false;
	}

	public update(): void {
		if (this.input !== undefined && this.revision !== this.input.revision) {
			this.cancelPointer();
			this.revision = this.input.revision;
		}
	}

	public handlePointer(snapshot: PointerSnapshot): boolean {
		this.update();
		const bar = this.input!;
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, bar.getTrack())) return false;
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0 && bar.isVisible()) {
			this.pointerOffset = bar.beginDrag(bar.orientation === 'vertical' ? snapshot.viewportY : snapshot.viewportX);
			this.capture.capture(this, PointerButton.Primary, this.scope);
			this.dragging = true;
			if ((snapshot.justReleasedButtons & PointerButton.Primary) !== 0) this.releaseCapturedPointer(snapshot);
		}
		return true;
	}

	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		this.update();
		if (this.dragging) {
			const bar = this.input!;
			bar.drag(bar.orientation === 'vertical' ? snapshot.viewportY : snapshot.viewportX, this.pointerOffset);
		}
	}

	public releaseCapturedPointer(snapshot: PointerSnapshot): void {
		this.handleCapturedPointer(snapshot);
		this.cancelPointer();
	}
}
