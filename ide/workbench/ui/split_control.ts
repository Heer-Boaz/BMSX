import { KeyModifier, type KeyInputEvent } from '../../../hosts/common/input/text';
import type { PointerSnapshot } from '../../common/models';
import type { InputFocusService, InputFocusTarget } from '../../input/focus';
import { consumeIdeKey, isKeyDown, isKeyJustPressed } from '../../input/keyboard/key_input';
import { PointerButton } from '../../../hosts/common/input/pointer_event';
import type { PointerCaptureService, PointerCaptureTarget } from '../../input/pointer/capture';
import type { PointerHoverService, PointerHoverTarget } from '../../input/pointer/hover';
import type { WorkbenchSashView } from './split_view';
import { EMPTY_STATUS_ITEMS, STATUS_PRIORITY_HINT, type WorkbenchStatusItem } from '../common/status_bar';

type KeyboardResize = {
	readonly origin: InputFocusTarget;
	readonly generation: number;
	readonly unbindFocus: () => void;
	readonly unbindOrigin: () => void;
	readonly unbindContext: () => void;
};
const RESIZE_STATUS: readonly WorkbenchStatusItem[] = [{ text: 'SIZE: ARROWS CTRL:FINE HOME:RESET ENTER/ESC:RETURN',
	alignment: 'left', priority: STATUS_PRIORITY_HINT, overflow: 'ellipsis', tone: 'info' }];

/** One captured sash gesture, with equivalent focused keyboard resizing. */
export class WorkbenchSplitControl implements PointerCaptureTarget, PointerHoverTarget {
	public readonly focusTarget: InputFocusTarget;
	public hovered = false;
	private inputValue: WorkbenchSashView | undefined;
	private keyboardResize: KeyboardResize | undefined;
	private pointerOffset = 0;
	private readonly unbindKeyboard: () => void;
	private unbindPressBlur: (() => void) | undefined;
	public constructor(private readonly focus: InputFocusService, private readonly capture: PointerCaptureService,
		private readonly hover: PointerHoverService, parent: InputFocusTarget, scope = parent.scope) {
		this.focusTarget = focus.createTarget(parent, scope);
		this.focusTarget.canFocus = () => this.input?.resizable === true;
		this.unbindKeyboard = this.focusTarget.bindKeyboard(player => this.handleKeyboard(player), () => this.finishKeyboardResize(false));
	}
	public get input(): WorkbenchSashView | undefined { return this.inputValue; }
	public get interactionActive(): boolean { return this.keyboardResize !== undefined; }
	public get statusItems(): readonly WorkbenchStatusItem[] { return this.interactionActive ? RESIZE_STATUS : EMPTY_STATUS_ITEMS; }
	public updateStatus(): void {}
	public setInput(input: WorkbenchSashView): void {
		this.inputValue = input;
		this.capture.cancelTarget(this); this.cancelPointer(); this.hover.release(this);
		if (this.keyboardResize !== undefined) this.finishKeyboardResize(false);
		else if (this.input?.resizable !== true) this.focusTarget.release();
	}
	public clearInput(): void {
		this.inputValue = undefined;
		this.capture.cancelTarget(this); this.cancelPointer(); this.hover.release(this);
		// Withdraw the old attachment completely before focus callbacks can admit its successor.
		if (this.keyboardResize !== undefined) this.finishKeyboardResize(false);
		else this.focusTarget.release();
	}
	public dispose(): void { this.clearInput(); this.unbindKeyboard(); }
	/** Explicit keyboard entry keeps only this invoking attachment's return authority. */
	public focusForResize(origin: InputFocusTarget): boolean {
		if (origin === this.focusTarget) return this.focus.admittedTarget === origin;
		if (this.input?.resizable !== true || this.focus.admittedTarget !== origin) return false;
		this.finishKeyboardResize(false);
		if (this.focus.admittedTarget !== origin || this.keyboardResize !== undefined) return false;
		const resize: KeyboardResize = {
			origin, generation: origin.scope.contextGeneration,
			unbindFocus: this.focus.onDidChangeTarget(() => {
				if (this.keyboardResize === resize && this.focus.admittedTarget !== this.focusTarget) this.finishKeyboardResize(false);
			}),
			unbindOrigin: origin.scope.onDidRetireContext(() => {
				if (this.keyboardResize === resize) this.finishKeyboardResize(false);
			}),
			unbindContext: this.focusTarget.scope.onDidRetireContext(() => {
				if (this.keyboardResize === resize) this.finishKeyboardResize(false);
			}),
		};
		this.keyboardResize = resize;
		const focused = this.focusTarget.focus();
		if (focused && this.keyboardResize === resize) return true;
		if (this.keyboardResize === resize) this.finishKeyboardResize(false);
		else if (this.keyboardResize === undefined && this.focus.target === this.focusTarget) this.focus.setTarget(null);
		return false;
	}
	private finishKeyboardResize(returnFocus: boolean): void {
		const resize = this.keyboardResize;
		if (resize === undefined) return;
		const returnAdmitted = returnFocus && this.focus.admittedTarget === this.focusTarget
			&& resize.origin.scope.contextGeneration === resize.generation;
		this.keyboardResize = undefined;
		resize.unbindFocus(); resize.unbindOrigin(); resize.unbindContext();
		if (returnAdmitted) resize.origin.focus();
		if (this.focus.target === this.focusTarget && this.keyboardResize === undefined) this.focus.setTarget(null);
		this.focus.notifyTargetChanged();
	}
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
		if (player.modifiers === KeyModifier.none && this.keyboardResize !== undefined
			&& (isKeyJustPressed('Enter', player) || isKeyJustPressed('Escape', player))) {
			consumeIdeKey(player.code, player); this.finishKeyboardResize(true); return;
		}
		if ((player.modifiers & ~KeyModifier.ctrl) !== 0) return;
		const input = this.input!;
		const keys = input.orientation === 'horizontal' ? HORIZONTAL_KEYS : VERTICAL_KEYS;
		for (const key of keys) {
			if (!isKeyDown(key, player)) continue;
			if (key === 'Home' && player.modifiers !== KeyModifier.none) return;
			consumeIdeKey(key, player);
			if (key === 'Home') input.reset();
			else {
				const extent = input.orientation === 'horizontal' ? input.bounds.right - input.bounds.left : input.bounds.bottom - input.bounds.top;
				const delta = player.modifiers === KeyModifier.ctrl ? 1 : extent * 0.05;
				input.moveTo(input.position + delta * (key === keys[0] ? -1 : 1));
			}
			return;
		}
	}
}
const HORIZONTAL_KEYS = ['ArrowLeft', 'ArrowRight', 'Home'] as const;
const VERTICAL_KEYS = ['ArrowUp', 'ArrowDown', 'Home'] as const;
