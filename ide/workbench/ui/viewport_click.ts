import { PointerButton } from '../../../hosts/common/input/pointer_event';
import { create_rect_bounds, point_in_rect, type RectBounds } from '../../../machine/ts/common/rect';
import { POINTER_DRAG_ACTIVATION_THRESHOLD } from '../../common/constants';
import type { PointerInputSnapshot } from '../../common/models';
import type { InputFocusService, InputFocusTarget } from '../../input/focus';
import type { PointerCaptureService, PointerCaptureTarget } from '../../input/pointer/capture';

/** A viewport click commits on release, after competing navigation/edit tools
 * have declined the press. Leaving, dragging, chords and retirement cancel it. */
export class WorkbenchViewportClick implements PointerCaptureTarget {
	private readonly bounds = create_rect_bounds();
	private button = 0;
	private x = 0;
	private y = 0;
	private generation = 0;
	private unbindContext: (() => void) | undefined;
	private readonly unbindBlur: () => void;
	private readonly unbindCancel: () => void;

	public constructor(private readonly focus: InputFocusService, private readonly capture: PointerCaptureService,
		private readonly target: InputFocusTarget, private readonly clicked: (x: number, y: number, button: PointerButton) => void) {
		this.unbindBlur = target.onDidBlur(() => this.cancel());
		this.unbindCancel = target.onDidCancelInput(() => this.cancel());
	}
	public layout(bounds: Readonly<RectBounds>): void {
		if (this.bounds.left === bounds.left && this.bounds.top === bounds.top
			&& this.bounds.right === bounds.right && this.bounds.bottom === bounds.bottom) return;
		this.cancel(); Object.assign(this.bounds, bounds);
	}
	public begin(snapshot: PointerInputSnapshot, button: PointerButton): void {
		this.cancel();
		const context = this.target.scope.contextGeneration, generation = this.generation;
		if (!this.target.focus() || this.target.scope.contextGeneration !== context || this.generation !== generation
			|| this.focus.admittedTarget !== this.target) return;
		this.button = button; this.x = snapshot.viewportX; this.y = snapshot.viewportY;
		this.unbindContext = this.target.scope.onDidRetireContext(() => this.cancel());
		if (!this.capture.capture(this, button, this.target.scope.surfaceScope)) return;
		this.handleCapturedPointer(snapshot);
		if ((snapshot.justReleasedButtons & button) !== 0) this.releaseCapturedPointer(snapshot);
	}
	public handleCapturedPointer(snapshot: PointerInputSnapshot): void {
		if (this.button === 0) return;
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.bounds)
			|| ((snapshot.pressedButtons | snapshot.justPressedButtons | snapshot.justReleasedButtons) & ~this.button) !== 0
			|| Math.max(Math.abs(snapshot.viewportX - this.x), Math.abs(snapshot.viewportY - this.y)) >= POINTER_DRAG_ACTIVATION_THRESHOLD) this.cancel();
	}
	public releaseCapturedPointer(snapshot: PointerInputSnapshot): void {
		this.handleCapturedPointer(snapshot);
		const button = this.button;
		this.cancelPointer();
		if (button !== 0 && this.focus.admittedTarget === this.target) this.clicked(snapshot.viewportX, snapshot.viewportY, button);
	}
	public cancel(): void { this.generation++; this.capture.cancelTarget(this); this.cancelPointer(); }
	public cancelPointer(): void {
		this.button = 0; this.capture.release(this);
		this.unbindContext?.(); this.unbindContext = undefined;
	}
	public dispose(): void { this.cancel(); this.unbindBlur(); this.unbindCancel(); }
}
