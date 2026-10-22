import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../../common/models';
import type { InputFocusService, InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyDown } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import type { PointerCaptureService, PointerCaptureTarget } from '../../../input/pointer/capture';
import { ActionPromptView, type ActionPromptAction, type ActionPromptChoice } from './action_prompt_view';

const TRIGGER_KEYS = ['Enter', 'NumpadEnter', 'Space'] as const;
const NAVIGATION_KEYS = ['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const;

/** Owns modal focus and physical gestures. The workspace command awaits only the decision. */
export class ActionPrompt implements PointerCaptureTarget {
	public readonly focusTarget: InputFocusTarget;
	public readonly pointerScope = Symbol('action-prompt');
	public readonly view = new ActionPromptView();
	private action: ActionPromptAction | undefined;
	private resolve: ((choice: ActionPromptChoice) => void) | undefined;
	private returnFocus: InputFocusTarget | null = null;
	private focused = 0;
	private hovered = -1;
	private pointerButton = -1;
	private triggerKey: string | undefined;
	private readonly unbindKeyboard: () => void;
	private readonly unbindBlur: () => void;

	public constructor(private readonly focus: InputFocusService, private readonly capture: PointerCaptureService,
		private readonly onDidChangeVisibility: () => void = () => {},
		private readonly acceptsFocusTransfer: (next: InputFocusTarget | null) => boolean = () => false) {
		this.focusTarget = focus.createTarget();
		this.focusTarget.scope.surfaceScope = this.pointerScope;
		this.focusTarget.canFocus = () => this.visible;
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => this.handleKeyboard(input), () => this.cancelPointer());
		this.unbindBlur = this.focusTarget.onDidBlur(next => { if (!this.acceptsFocusTransfer(next)) this.close(); });
	}

	public get visible(): boolean { return this.action !== undefined; }
	public get invocationOrigin(): InputFocusTarget | null { return this.returnFocus; }

	public show(action: ActionPromptAction): Promise<ActionPromptChoice> {
		this.close();
		this.capture.cancel();
		this.returnFocus = this.focus.target;
		this.action = action;
		this.focused = 0;
		this.view.update(action);
		const result = new Promise<ActionPromptChoice>(resolve => { this.resolve = resolve; });
		this.focusTarget.focus();
		this.onDidChangeVisibility();
		return result;
	}

	public close(choice: ActionPromptChoice = 'cancel', restoreFocus = true): void {
		if (!this.visible) return;
		const resolve = this.resolve!, returnFocus = this.returnFocus;
		this.action = undefined; this.resolve = undefined; this.returnFocus = null;
		this.cancelPointer();
		if (this.focusTarget.hasFocus || this.acceptsFocusTransfer(this.focus.target)) this.focus.setTarget(restoreFocus ? returnFocus : null);
		this.onDidChangeVisibility();
		resolve(choice);
	}

	public dispose(): void { this.close(); this.unbindKeyboard(); this.unbindBlur(); }

	public handlePointer(snapshot: PointerSnapshot): void {
		const index = this.hitTest(snapshot);
		this.hovered = index;
		if (index < 0 || (snapshot.justPressedButtons & PointerButton.Primary) === 0) return;
		this.cancelPointer();
		this.capture.capture(this, PointerButton.Primary, this.pointerScope);
		this.focused = this.pointerButton = this.hovered = index;
		if ((snapshot.justReleasedButtons & PointerButton.Primary) !== 0) this.releaseCapturedPointer(snapshot);
	}

	public handleCapturedPointer(snapshot: PointerSnapshot): void { this.hovered = this.hitTest(snapshot); }

	public releaseCapturedPointer(snapshot: PointerSnapshot): void {
		const index = this.pointerButton;
		const accept = index >= 0 && this.hitTest(snapshot) === index;
		this.cancelPointer();
		if (accept) this.close(this.view.buttons[index].choice);
	}

	public cancelPointer(): void {
		this.capture.release(this);
		this.pointerButton = this.hovered = -1;
		this.triggerKey = undefined;
	}

	private hitTest(snapshot: PointerSnapshot): number {
		if (!snapshot.valid || !snapshot.insideViewport) return -1;
		const buttons = this.view.buttons;
		for (let index = 0; index < buttons.length; index++) {
			if (point_in_rect(snapshot.viewportX, snapshot.viewportY, buttons[index].bounds)) return index;
		}
		return -1;
	}

	private handleKeyboard(input: KeyInputEvent): void {
		// Escape owns its down/up pair even if modifiers change before release.
		if (input.code === 'Escape' && !input.consumed) {
			if (input.down && !input.repeat) { this.cancelPointer(); this.triggerKey = 'Escape'; }
			consumeIdeKey('Escape', input);
			if (this.triggerKey === 'Escape' && !input.down) this.close();
			return;
		}
		if (this.triggerKey === 'Escape') return;
		const modifiers = input.modifiers;
		if (modifiers !== KeyModifier.none && modifiers !== KeyModifier.shift) { this.cancelPointer(); return; }
		for (const key of NAVIGATION_KEYS) if (isKeyDown(key, input)) {
			consumeIdeKey(key, input);
			this.cancelPointer();
			const backward = key === 'ArrowLeft' || key === 'ArrowUp' || key === 'Tab' && modifiers === KeyModifier.shift;
			this.focused = (this.focused + (backward ? -1 : 1) + this.view.buttons.length) % this.view.buttons.length;
			return;
		}
		if (!TRIGGER_KEYS.includes(input.code as typeof TRIGGER_KEYS[number]) || input.consumed) return;
		if (input.down && !input.repeat && this.triggerKey === undefined) {
			this.cancelPointer();
			this.triggerKey = input.code;
		}
		consumeIdeKey(input.code, input);
		if (input.code === this.triggerKey && !input.down) this.close(this.view.buttons[this.focused].choice);
	}

	public update(): void {
		if (this.visible) this.view.update(this.action!);
	}

	public draw(): void {
		if (!this.visible) return;
		const pressed = this.triggerKey !== undefined && this.triggerKey !== 'Escape' ? this.focused
			: this.pointerButton === this.hovered ? this.pointerButton : -1;
		this.view.draw(this.focused, pressed, this.hovered);
	}
}
