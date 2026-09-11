import { point_in_rect } from '../../../machine/ts/common/rect';
import { KeyModifier, type PlayerInput } from '../../../hosts/common/input/player';
import type { EditorCommandId, EditorCommandRunner } from '../../common/commands';
import type { PointerSnapshot } from '../../common/models';
import type { InputFocusService, InputFocusTarget } from '../../input/focus';
import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../input/keyboard/key_input';
import { PointerButton } from '../../input/pointer/buttons';
import type { PointerCaptureService, PointerCaptureTarget } from '../../input/pointer/capture';
import type { PointerHoverService, PointerHoverTarget } from '../../input/pointer/hover';
import type { WorkbenchActionBarState } from './action_bar';

const TRIGGER_KEYS = ['Enter', 'NumpadEnter', 'Space'] as const;
const NAVIGATION_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End'] as const;

/** One composite control; input-owned geometry outlives physical gestures. */
export class WorkbenchActionBarControl implements PointerCaptureTarget, PointerHoverTarget {
	public readonly focusTarget: InputFocusTarget;
	private input: WorkbenchActionBarState | undefined;
	private pointerCommand: EditorCommandId | null = null;
	private triggerKey: string | undefined;
	private readonly unbindKeyboard: () => void;
	private readonly unbindFocus: () => void;
	private readonly unbindBlur: () => void;
	private unbindPressBlur: (() => void) | undefined;
	private readonly cancelPress = () => this.cancelPointer();

	public constructor(private readonly focus: InputFocusService, private readonly capture: PointerCaptureService,
		private readonly hover: PointerHoverService, private readonly commands: EditorCommandRunner, parent: InputFocusTarget) {
		this.focusTarget = focus.createTarget(parent);
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		this.unbindFocus = this.focusTarget.onDidFocus(() => {
			this.input!.hasFocus = true;
			this.update();
		});
		this.unbindBlur = this.focusTarget.onDidBlur(() => {
			this.cancelPointer();
			this.input!.hasFocus = false;
		});
	}

	public setInput(input: WorkbenchActionBarState, context: InputFocusTarget): void {
		if (this.input === input && this.focusTarget.commandContext === context) return;
		this.clearInput();
		this.input = input;
		this.focusTarget.commandContext = context;
	}

	public clearInput(): void {
		this.hover.release(this);
		this.cancelPointer();
		this.focusTarget.release();
		this.input = undefined;
	}

	public dispose(): void {
		this.clearInput();
		this.unbindKeyboard();
		this.unbindFocus();
		this.unbindBlur();
	}

	/** Revoke disabled attempts even when there is no new pointer or key event. */
	public update(): void {
		const state = this.input!;
		const command = this.pointerCommand === null ? state.pressedCommand : this.pointerCommand;
		if (command !== null && !this.commands.isEnabled(command)) this.cancelPointer();
		if (state.hasFocus && (state.focusedIndex < 0 || !this.commands.isEnabled(state.items[state.focusedIndex].command))) {
			this.moveFocus(1, state.focusedIndex);
		}
	}

	public cancelPointer(): void {
		this.capture.release(this);
		this.unbindPressBlur?.();
		this.unbindPressBlur = undefined;
		this.pointerCommand = null;
		this.triggerKey = undefined;
		if (this.input !== undefined) {
			this.input.pressedCommand = null;
			this.input.hoveredCommand = null;
		}
	}

	public onPointerLeave(): void { this.input!.hoveredCommand = null; }

	public handlePointer(snapshot: PointerSnapshot): boolean {
		const state = this.input!;
		const index = this.hitTest(snapshot);
		state.hoveredCommand = index < 0 ? null : state.items[index].command;
		if (index < 0) { this.hover.release(this); return false; }
		this.hover.visit(this);
		const command = state.items[index].command;
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0 && this.commands.isEnabled(command)) {
			this.cancelPointer();
			this.capture.capture(this);
			this.pointerCommand = command;
			state.pressedCommand = command;
			state.hoveredCommand = command;
			state.focusedIndex = index;
			// Keep field focus/drafts until the command's normal admission step.
			this.unbindPressBlur = this.focus.target?.onDidBlur(this.cancelPress);
			if ((snapshot.justReleasedButtons & PointerButton.Primary) !== 0) this.releaseCapturedPointer(snapshot);
		}
		return true;
	}

	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		this.update();
		if (this.pointerCommand === null) return;
		const state = this.input!;
		const index = this.hitTest(snapshot);
		state.hoveredCommand = index < 0 ? null : state.items[index].command;
		if (index < 0) this.hover.release(this);
		else this.hover.visit(this);
		state.pressedCommand = state.hoveredCommand === this.pointerCommand ? this.pointerCommand : null;
	}

	public releaseCapturedPointer(snapshot: PointerSnapshot): void {
		const command = this.pointerCommand;
		const index = this.hitTest(snapshot);
		const accept = command !== null && index >= 0 && this.input!.items[index].command === command && this.commands.isEnabled(command);
		this.cancelPointer(); // Execution may synchronously detach this pane/control.
		if (accept) this.commands.execute(command);
	}

	private hitTest(snapshot: PointerSnapshot): number {
		if (!snapshot.valid || !snapshot.insideViewport) return -1;
		const items = this.input!.items;
		for (let index = 0; index < items.length; index += 1) {
			if (point_in_rect(snapshot.viewportX, snapshot.viewportY, items[index].bounds)) return index;
		}
		return -1;
	}

	private moveFocus(direction: number, from: number): void {
		const state = this.input!;
		const count = state.items.length;
		let index = from;
		for (let remaining = count; remaining > 0; remaining -= 1) {
			index = (index + direction + count) % count;
			if (this.commands.isEnabled(state.items[index].command)) {
				state.focusedIndex = index;
				return;
			}
		}
		state.focusedIndex = -1;
	}

	private handleKeyboard(input: PlayerInput): void {
		this.update();
		if (input.getModifiers() !== KeyModifier.none) {
			if (this.triggerKey !== undefined) this.cancelPointer();
			return;
		}
		if (isKeyJustPressed('Escape', input)) {
			consumeIdeKey('Escape', input);
			this.cancelPointer();
			this.focusTarget.commandContext.focus();
			return;
		}
		const state = this.input!;
		for (const key of NAVIGATION_KEYS) if (shouldRepeatKeyFromPlayer(key, input)) {
			consumeIdeKey(key, input);
			this.cancelPointer();
			this.moveFocus(key === 'ArrowLeft' || key === 'End' ? -1 : 1,
				key === 'Home' ? -1 : key === 'End' ? 0 : state.focusedIndex);
			return;
		}
		for (const key of TRIGGER_KEYS) {
			const button = input.inputHandlers.keyboard.getKeyState(key);
			if (button.consumed) continue;
			if (button.justpressed && this.triggerKey === undefined && state.focusedIndex >= 0) {
				this.cancelPointer();
				this.triggerKey = key;
				state.pressedCommand = state.items[state.focusedIndex].command;
			}
			if (button.pressed || button.justpressed || button.justreleased) consumeIdeKey(key, input);
			if (key !== this.triggerKey) continue;
			const command = state.pressedCommand!;
			if (button.justreleased) {
				this.cancelPointer();
				if (this.commands.isEnabled(command)) this.commands.execute(command);
				return;
			}
			if (!button.pressed) this.cancelPointer(); // Lost input is not a release.
		}
	}
}
