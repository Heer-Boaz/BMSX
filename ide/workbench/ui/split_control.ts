import type { KeyInputEvent } from '../../../hosts/common/input/text';
import type { PointerSnapshot } from '../../common/models';
import type { InputFocusService, InputFocusTarget } from '../../input/focus';
import { consumeIdeKey, isKeyDown } from '../../input/keyboard/key_input';
import { PointerButton } from '../../../hosts/common/input/pointer_event';
import type { PointerCaptureService, PointerCaptureTarget } from '../../input/pointer/capture';
import type { PointerHoverService, PointerHoverTarget } from '../../input/pointer/hover';
import type { WorkbenchSashView } from './split_view';

/** One captured sash gesture, with equivalent focused keyboard resizing. */
export class WorkbenchSplitControl implements PointerCaptureTarget, PointerHoverTarget {
	public readonly focusTarget: InputFocusTarget;
	public hovered = false;
	private input: WorkbenchSashView | undefined;
	private pointerOffset = 0;
	private readonly unbindKeyboard: () => void;
	private unbindPressBlur: (() => void) | undefined;
	public constructor(private readonly focus: InputFocusService, private readonly capture: PointerCaptureService,
		private readonly hover: PointerHoverService, parent: InputFocusTarget, scope = parent.scope) {
		this.focusTarget = focus.createTarget(parent, scope);
		this.focusTarget.canFocus = () => this.input?.resizable === true;
		this.unbindKeyboard = this.focusTarget.bindKeyboard(player => this.handleKeyboard(player));
	}
	public setInput(input: WorkbenchSashView): void {
		this.capture.cancelTarget(this); this.cancelPointer(); this.hover.release(this);
		this.input = input;
		if (!input.resizable) this.focusTarget.release();
	}
	public clearInput(): void { this.cancelPointer(); this.hover.release(this); this.focusTarget.release(); this.input = undefined; }
	public dispose(): void { this.clearInput(); this.unbindKeyboard(); }
	public onPointerLeave(): void { this.hovered = false; }
	public readonly cancelPointer = (): void => {
		this.capture.release(this);
		this.unbindPressBlur?.(); this.unbindPressBlur = undefined;
	};
	public handlePointer(snapshot: PointerSnapshot): boolean {
		const input = this.input;
		if (input === undefined || !input.resizable || !snapshot.valid || !snapshot.insideViewport) return false;
		const horizontal = input.orientation === 'horizontal';
		const position = horizontal ? snapshot.viewportX : snapshot.viewportY;
		const cross = horizontal ? snapshot.viewportY : snapshot.viewportX;
		if (Math.abs(position - input.position) > 4 || cross < (horizontal ? input.bounds.top : input.bounds.left)
			|| cross >= (horizontal ? input.bounds.bottom : input.bounds.right)) return false;
		this.hover.visit(this); this.hovered = true;
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) {
			// Like a scrollbar, pointer resizing keeps the active editor and draft.
			// Keyboard users reach the sash through its explicit focus order.
			this.pointerOffset = position - input.position;
			this.capture.capture(this);
			this.unbindPressBlur = this.focus.target?.onDidBlur(this.cancelPointer);
		}
		return true;
	}
	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		const input = this.input!;
		input.moveTo((input.orientation === 'horizontal' ? snapshot.viewportX : snapshot.viewportY) - this.pointerOffset);
	}
	public releaseCapturedPointer(snapshot: PointerSnapshot): void { this.handleCapturedPointer(snapshot); this.cancelPointer(); }
	private handleKeyboard(player: KeyInputEvent): void {
		const input = this.input!;
		const keys = input.orientation === 'horizontal' ? HORIZONTAL_KEYS : VERTICAL_KEYS;
		for (const key of keys) {
			if (!isKeyDown(key, player)) continue;
			consumeIdeKey(key, player);
			if (key === 'Home') input.reset();
			else {
				const extent = input.orientation === 'horizontal' ? input.bounds.right - input.bounds.left : input.bounds.bottom - input.bounds.top;
				input.moveTo(input.position + extent * (key === keys[0] ? -0.05 : 0.05));
			}
			return;
		}
	}
}
const HORIZONTAL_KEYS = ['ArrowLeft', 'ArrowRight', 'Home'] as const;
const VERTICAL_KEYS = ['ArrowUp', 'ArrowDown', 'Home'] as const;
