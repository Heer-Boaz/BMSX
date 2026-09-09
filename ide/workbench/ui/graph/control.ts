import { point_in_rect } from '../../../../machine/ts/common/rect';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import { DOUBLE_CLICK_MAX_INTERVAL_MS } from '../../../common/constants';
import type { PointerSnapshot } from '../../../common/models';
import type { InputFocusService, InputFocusTarget } from '../../../input/focus';
import type { PointerCaptureService, PointerCaptureTarget } from '../../../input/pointer/capture';
import { consumeIdeKey, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import type { WorkbenchGraphItem, WorkbenchGraphModel } from './model';
import type { WorkbenchGraphViewport } from './viewport';

export const enum WorkbenchGraphPointerResult { Outside, Handled, Activate }

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
	private lastClick: WorkbenchGraphItem | null = null;
	private lastClickTime = 0;
	private hoverValid = false;
	private hoverX = 0;
	private hoverY = 0;
	private readonly unbindKeyboard: () => void;
	private readonly unbindBlur: () => void;

	public constructor(focus: InputFocusService, private readonly capture: PointerCaptureService, parent: InputFocusTarget | null = null) {
		this.focusTarget = focus.createTarget(parent);
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		this.unbindBlur = this.focusTarget.onDidBlur(() => this.cancelPointer());
	}

	public setInput(input: WorkbenchGraphViewport): void {
		this.cancelPointer();
		this.inputValue = input;
		this.pointerModel = input.model;
	}

	public clearInput(): void {
		this.cancelPointer();
		this.focusTarget.release();
		this.inputValue = null;
		this.pointerModel = null;
	}

	public dispose(): void {
		this.clearInput();
		this.unbindKeyboard();
		this.unbindBlur();
	}

	public cancelPointer(): void {
		this.capture.release(this);
		this.lastClick = null;
		this.hover = null;
		this.hoverValid = false;
	}

	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		const view = this.inputValue!;
		if (this.pointerModel !== view.model) {
			this.cancelPointer();
			this.pointerModel = view.model;
			return;
		}
		view.scrollX = this.anchorScrollX - Math.round(snapshot.viewportX - this.anchorX);
		view.scrollY = this.anchorScrollY - Math.round(snapshot.viewportY - this.anchorY);
	}

	public handlePointer(snapshot: PointerSnapshot, justPressed: boolean, now: number): WorkbenchGraphPointerResult {
		const view = this.inputValue!;
		if (this.pointerModel !== view.model) {
			this.cancelPointer();
			this.pointerModel = view.model;
		}
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
		if (this.hover === null) {
			this.lastClick = null;
			this.capture.capture(this);
			this.anchorX = snapshot.viewportX;
			this.anchorY = snapshot.viewportY;
			this.anchorScrollX = view.scrollX;
			this.anchorScrollY = view.scrollY;
			return WorkbenchGraphPointerResult.Handled;
		}
		const activate = this.lastClick === this.hover && now - this.lastClickTime <= DOUBLE_CLICK_MAX_INTERVAL_MS;
		this.lastClick = activate ? null : this.hover;
		this.lastClickTime = now;
		return activate ? WorkbenchGraphPointerResult.Activate : WorkbenchGraphPointerResult.Handled;
	}

	public handleWheel(snapshot: PointerSnapshot, deltaX: number, deltaY: number): boolean {
		const view = this.inputValue!;
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, view.bounds)) return false;
		this.cancelPointer();
		view.pan(deltaX, deltaY);
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
