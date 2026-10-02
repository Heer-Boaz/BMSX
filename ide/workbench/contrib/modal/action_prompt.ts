import { KeyModifier, type PlayerInput } from '../../../../hosts/common/input/player';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../../common/models';
import type { InputFocusService, InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../input/pointer/buttons';
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

	public constructor(private readonly focus: InputFocusService, private readonly capture: PointerCaptureService) {
		this.focusTarget = focus.createTarget();
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		this.unbindBlur = this.focusTarget.onDidBlur(() => this.close());
	}

	public get visible(): boolean { return this.action !== undefined; }

	public show(action: ActionPromptAction): Promise<ActionPromptChoice> {
		this.close();
		this.capture.cancel();
		this.returnFocus = this.focus.target;
		this.action = action;
		this.focused = 0;
		this.view.update(action);
		const result = new Promise<ActionPromptChoice>(resolve => { this.resolve = resolve; });
		this.focusTarget.focus();
		return result;
	}

	public close(choice: ActionPromptChoice = 'cancel'): void {
		if (!this.visible) return;
		const resolve = this.resolve!, returnFocus = this.returnFocus;
		this.action = undefined; this.resolve = undefined; this.returnFocus = null;
		this.cancelPointer();
		if (this.focusTarget.hasFocus) this.focus.setTarget(returnFocus);
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

	private handleKeyboard(input: PlayerInput): void {
		// Escape owns its down/up pair even if modifiers change before release.
		const escape = input.inputHandlers.keyboard.getKeyState('Escape');
		if (!escape.consumed) {
			if (escape.justpressed) { this.cancelPointer(); this.triggerKey = 'Escape'; }
			if (escape.pressed || escape.justpressed || escape.justreleased) consumeIdeKey('Escape', input);
			if (this.triggerKey === 'Escape') {
				if (escape.justreleased) this.close();
				else if (!escape.pressed) this.cancelPointer();
				return;
			}
		}
		const modifiers = input.getModifiers();
		if (modifiers !== KeyModifier.none && modifiers !== KeyModifier.shift) { this.cancelPointer(); return; }
		for (const key of NAVIGATION_KEYS) if (shouldRepeatKeyFromPlayer(key, input)) {
			consumeIdeKey(key, input);
			this.cancelPointer();
			const backward = key === 'ArrowLeft' || key === 'ArrowUp' || key === 'Tab' && modifiers === KeyModifier.shift;
			this.focused = (this.focused + (backward ? -1 : 1) + this.view.buttons.length) % this.view.buttons.length;
			return;
		}
		for (const key of TRIGGER_KEYS) {
			const button = input.inputHandlers.keyboard.getKeyState(key);
			if (button.consumed) continue;
			if (button.justpressed && this.triggerKey === undefined) {
				this.cancelPointer();
				this.triggerKey = key;
			}
			if (button.pressed || button.justpressed || button.justreleased) consumeIdeKey(key, input);
			if (key !== this.triggerKey) continue;
			if (button.justreleased) {
				this.close(this.view.buttons[this.focused].choice);
				return;
			}
			if (!button.pressed) this.cancelPointer();
		}
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
