import { point_in_rect } from '../../../../machine/ts/common/rect';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import { DOUBLE_CLICK_MAX_INTERVAL_MS, POINTER_DRAG_ACTIVATION_THRESHOLD } from '../../../common/constants';
import type { PointerSnapshot } from '../../../common/models';
import type { InputFocusService, InputFocusTarget } from '../../../input/focus';
import type { PointerCaptureService, PointerCaptureTarget } from '../../../input/pointer/capture';
import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import type { WorkbenchGraphItem, WorkbenchGraphModel } from './model';
import type { WorkbenchGraphViewport } from './viewport';
import type { WorkbenchGraphDragFeedback, WorkbenchGraphDragSession, WorkbenchGraphDragSource } from './drag';

export const enum WorkbenchGraphPointerResult { Outside, Handled, Activate }
const enum Gesture { None, Pan, PendingDrag, Drag }
const DRAG_SCROLL_MARGIN = 12;
const DRAG_SCROLL_SPEED = 120; // Viewport pixels per host second, not emulated frames.

/** Pane-owned control. Input/view state survives detachment; physical gestures do not. */
export class WorkbenchGraphControl implements PointerCaptureTarget {
	public readonly focusTarget: InputFocusTarget;
	public hover: WorkbenchGraphItem | null = null;
	private inputValue: WorkbenchGraphViewport | null = null;
	private pointerModel: WorkbenchGraphModel | null = null;
	private anchorX = 0;
	private anchorY = 0;
	private anchorScrollX = 0;
	private anchorScrollY = 0;
	private gesture = Gesture.None;
	private pressTarget: WorkbenchGraphItem | null = null;
	private dragSource: WorkbenchGraphDragSource | undefined;
	private drag: WorkbenchGraphDragSession | undefined;
	private pointerTime = 0;
	private dragPositionValid = false;
	private dragX = 0;
	private dragY = 0;
	private lastClick: WorkbenchGraphItem | null = null;
	private lastClickTime = 0;
	private hoverValid = false;
	private hoverX = 0;
	private hoverY = 0;
	private readonly unbindKeyboard: () => void;
	private readonly unbindBlur: () => void;

	public constructor(focus: InputFocusService, private readonly capture: PointerCaptureService,
		keyboard: (input: PlayerInput) => void = input => this.handleKeyboard(input), parent: InputFocusTarget | null = null) {
		this.focusTarget = focus.createTarget(parent);
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => {
			if (this.gesture !== Gesture.None && isKeyJustPressed('Escape', input)) {
				consumeIdeKey('Escape', input);
				this.cancelPointer();
				return;
			}
			keyboard(input);
		});
		this.unbindBlur = this.focusTarget.onDidBlur(() => this.cancelPointer());
	}

	public setInput(input: WorkbenchGraphViewport, dragSource?: WorkbenchGraphDragSource): void {
		this.cancelPointer();
		this.inputValue = input;
		this.pointerModel = input.model;
		this.dragSource = dragSource;
	}

	public clearInput(): void {
		this.cancelPointer();
		this.focusTarget.release();
		this.inputValue = null;
		this.pointerModel = null;
		this.dragSource = undefined;
	}

	public dispose(): void {
		this.clearInput();
		this.unbindKeyboard();
		this.unbindBlur();
	}

	public cancelPointer(): void {
		this.capture.release(this);
		this.gesture = Gesture.None;
		this.pressTarget = null;
		this.drag = undefined;
		this.lastClick = null;
		this.hover = null;
		this.hoverValid = false;
	}

	public get dragFeedback(): WorkbenchGraphDragFeedback | undefined {
		return this.drag?.feedback;
	}

	/** Called after the pane updates its projection, even without pointer motion. */
	public update(): void {
		if (this.inputValue === null) return;
		if (this.pointerModel !== this.inputValue.model
			|| (this.gesture !== Gesture.None && this.inputValue.selection !== this.pressTarget)
			|| (this.drag !== undefined && !this.drag.isCurrent())) {
			this.cancelPointer();
			this.pointerModel = this.inputValue.model;
		}
	}

	public handleCapturedPointer(snapshot: PointerSnapshot, now: number): void {
		this.update();
		if (this.gesture === Gesture.None) return;
		const view = this.inputValue!;
		if (this.gesture === Gesture.Pan) {
			view.scrollX = this.anchorScrollX - Math.round(snapshot.viewportX - this.anchorX);
			view.scrollY = this.anchorScrollY - Math.round(snapshot.viewportY - this.anchorY);
			return;
		}
		if (this.gesture === Gesture.PendingDrag) {
			if (Math.max(Math.abs(snapshot.viewportX - this.anchorX), Math.abs(snapshot.viewportY - this.anchorY)) < POINTER_DRAG_ACTIVATION_THRESHOLD) return;
			this.drag = this.dragSource!();
			if (this.drag === undefined) {
				this.cancelPointer();
				return;
			}
			this.gesture = Gesture.Drag;
			this.lastClick = null;
			this.dragPositionValid = false;
			this.pointerTime = now;
		}
		const elapsed = (now - this.pointerTime) / 1000;
		this.pointerTime = now;
		if (point_in_rect(snapshot.viewportX, snapshot.viewportY, view.bounds)) {
			view.pan(dragScrollSpeed(snapshot.viewportX, view.bounds.left, view.bounds.right) * elapsed,
				dragScrollSpeed(snapshot.viewportY, view.bounds.top, view.bounds.bottom) * elapsed);
		}
		this.updateDrag(snapshot);
	}

	public releaseCapturedPointer(snapshot: PointerSnapshot, now: number): void {
		// A fast press/move/release may be coalesced into one host input interval.
		if (this.gesture === Gesture.PendingDrag || this.gesture === Gesture.Pan) this.handleCapturedPointer(snapshot, now);
		else this.update();
		if (this.gesture === Gesture.Drag) {
			// Use the release coordinates, not the last accepted hover. No release-time scroll.
			this.updateDrag(snapshot);
			const drag = this.drag!;
			this.cancelPointer();
			if (drag.feedback.accepted) drag.drop();
		} else if (this.gesture === Gesture.PendingDrag) {
			this.gesture = Gesture.None; // A click preserves double-click tracking; it never edits.
			this.pressTarget = null;
		} else {
			this.cancelPointer();
		}
	}

	private updateDrag(snapshot: PointerSnapshot): void {
		const view = this.inputValue!;
		const drag = this.drag!;
		drag.feedback.offsetX = snapshot.viewportX - this.anchorX + view.scrollX - this.anchorScrollX;
		drag.feedback.offsetY = snapshot.viewportY - this.anchorY + view.scrollY - this.anchorScrollY;
		if (!point_in_rect(snapshot.viewportX, snapshot.viewportY, view.bounds)) {
			drag.feedback.accepted = false;
			this.dragPositionValid = false;
			return;
		}
		const x = snapshot.viewportX - view.bounds.left + view.scrollX;
		const y = snapshot.viewportY - view.bounds.top + view.scrollY;
		// A stationary drag outside the scroll margins repeats neither hits nor domain work.
		if (!this.dragPositionValid || this.dragX !== x || this.dragY !== y) {
			drag.dragOver(snapshot.viewportX, snapshot.viewportY);
			this.dragPositionValid = true;
			this.dragX = x;
			this.dragY = y;
		}
	}

	public handlePointer(snapshot: PointerSnapshot, justPressed: boolean, now: number): WorkbenchGraphPointerResult {
		const view = this.inputValue!;
		this.update();
		if (!snapshot.valid || !snapshot.insideViewport) {
			this.cancelPointer();
			return WorkbenchGraphPointerResult.Outside;
		}
		if (!point_in_rect(snapshot.viewportX, snapshot.viewportY, view.bounds)) {
			this.hover = null;
			this.hoverValid = false;
			return WorkbenchGraphPointerResult.Outside;
		}
		const x = snapshot.viewportX - view.bounds.left + view.scrollX;
		const y = snapshot.viewportY - view.bounds.top + view.scrollY;
		if (!this.hoverValid || this.hoverX !== x || this.hoverY !== y) {
			this.hover = view.hitTest(snapshot.viewportX, snapshot.viewportY);
			this.hoverX = x;
			this.hoverY = y;
			this.hoverValid = true;
		}
		if (!justPressed) return WorkbenchGraphPointerResult.Handled;
		this.focusTarget.focus();
		view.selection = this.hover;
		this.pressTarget = this.hover;
		this.anchorX = snapshot.viewportX;
		this.anchorY = snapshot.viewportY;
		this.anchorScrollX = view.scrollX;
		this.anchorScrollY = view.scrollY;
		if (this.hover === null) {
			this.lastClick = null;
			this.capture.capture(this);
			this.gesture = Gesture.Pan;
			return WorkbenchGraphPointerResult.Handled;
		}
		const activate = this.lastClick === this.hover && now - this.lastClickTime <= DOUBLE_CLICK_MAX_INTERVAL_MS;
		this.lastClick = activate ? null : this.hover;
		this.lastClickTime = now;
		if (!activate && this.dragSource !== undefined) {
			this.capture.capture(this);
			this.gesture = Gesture.PendingDrag;
		}
		return activate ? WorkbenchGraphPointerResult.Activate : WorkbenchGraphPointerResult.Handled;
	}

	public handleWheel(snapshot: PointerSnapshot, deltaX: number, deltaY: number): boolean {
		const view = this.inputValue!;
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, view.bounds)) return false;
		this.update();
		if (this.gesture !== Gesture.Drag && this.gesture !== Gesture.PendingDrag) this.cancelPointer();
		view.pan(deltaX, deltaY);
		if (this.gesture === Gesture.Drag) this.updateDrag(snapshot);
		return true;
	}

	private handleKeyboard(input: PlayerInput): void {
		const view = this.inputValue!;
		for (const key of PAN_KEYS) {
			if (shouldRepeatKeyFromPlayer(key.code, input)) {
				consumeIdeKey(key.code, input);
				this.cancelPointer();
				view.pan(key.x, key.y);
				return;
			}
		}
		if (shouldRepeatKeyFromPlayer('Home', input)) {
			consumeIdeKey('Home', input);
			this.cancelPointer();
			if (view.selection !== null) view.reveal(view.selection);
		}
	}
}

// Focus-local viewport movement, not gameplay keybindings or graph authoring.
const PAN_KEYS = [
	{ code: 'ArrowLeft', x: -16, y: 0 }, { code: 'ArrowRight', x: 16, y: 0 },
	{ code: 'ArrowUp', x: 0, y: -16 }, { code: 'ArrowDown', x: 0, y: 16 },
];

function dragScrollSpeed(position: number, start: number, end: number): number {
	if (position < start + DRAG_SCROLL_MARGIN) return -DRAG_SCROLL_SPEED * (start + DRAG_SCROLL_MARGIN - position) / DRAG_SCROLL_MARGIN;
	if (position > end - DRAG_SCROLL_MARGIN) return DRAG_SCROLL_SPEED * (position - end + DRAG_SCROLL_MARGIN) / DRAG_SCROLL_MARGIN;
	return 0;
}
