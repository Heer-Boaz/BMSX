import { $ } from '../core/game';
import type { ActionState } from '../input/inputtypes';
import type { BmsxConsoleButton, BmsxConsolePointerButton, ConsolePointerVector, ConsolePointerWheel } from './types';
import { BmsxConsoleButtonCount, BmsxConsolePointerButtonCount } from './types';

const BUTTON_ACTIONS: string[] = [
	'console_left',
	'console_right',
	'console_up',
	'console_down',
	'console_o',
	'console_x',
];

const POINTER_CODES: readonly string[] = [
	'pointer_primary',
	'pointer_secondary',
	'pointer_aux',
	'pointer_back',
	'pointer_forward',
] as const;
type RepeatStateEntry = {
	active: boolean;
	repeatCount: number;
	lastFrameEvaluated: number;
	lastResult: boolean;
	hasDispatchedThisCycle: boolean;
	pressStartFrame: number;
};

export class BmsxConsoleInput {
	private static readonly INITIAL_REPEAT_DELAY_FRAMES = 15;
	private static readonly REPEAT_INTERVAL_FRAMES = 4;

	private readonly playerIndex: number;
	private currentFrame: number = 0;
	private readonly repeatState: RepeatStateEntry[] = [];
	private readonly pointerPressed: boolean[] = new Array(BmsxConsolePointerButtonCount).fill(false);
	private readonly pointerJustPressed: boolean[] = new Array(BmsxConsolePointerButtonCount).fill(false);
	private readonly pointerJustReleased: boolean[] = new Array(BmsxConsolePointerButtonCount).fill(false);

	constructor(playerIndex: number) {
		this.playerIndex = playerIndex;
	}

	public beginFrame(frame: number): void {
		this.currentFrame = frame;
		this.updatePointerButtonStates();
	}

	public btn(button: BmsxConsoleButton): boolean {
		const state = this.getState(button);
		return state.pressed;
	}

	public btnp(button: BmsxConsoleButton): boolean {
		const state = this.getState(button);
		const repeat = this.ensureRepeatState(button);
		if (repeat.lastFrameEvaluated === this.currentFrame) {
			return repeat.lastResult;
		}
		let result = false;
		if (state.justpressed) {
			repeat.active = true;
			repeat.repeatCount = 0;
			repeat.hasDispatchedThisCycle = true;
			repeat.pressStartFrame = this.currentFrame;
			result = true;
		} else if (!state.pressed && state.justreleased && !repeat.hasDispatchedThisCycle) {
			repeat.active = false;
			repeat.repeatCount = 0;
			repeat.hasDispatchedThisCycle = true;
			repeat.pressStartFrame = -1;
			result = true;
		} else if (!state.pressed) {
			repeat.active = false;
			repeat.repeatCount = 0;
			repeat.hasDispatchedThisCycle = false;
			repeat.pressStartFrame = -1;
		} else {
			if (!repeat.active) {
				repeat.active = true;
				repeat.repeatCount = 0;
				repeat.pressStartFrame = this.currentFrame;
			}
			if (repeat.pressStartFrame < 0) {
				throw new Error(`[BmsxConsoleInput] Press start frame not set for button ${button}.`);
			}
			const heldFrames = this.currentFrame - repeat.pressStartFrame;
			if (heldFrames < 0) {
				throw new Error(`[BmsxConsoleInput] Negative held frame count detected for button ${button}.`);
			}
			const repeatsElapsed = this.computeRepeatCount(heldFrames);
			if (repeatsElapsed > repeat.repeatCount) {
				repeat.repeatCount = repeatsElapsed;
				repeat.hasDispatchedThisCycle = true;
				result = true;
			}
		}
		repeat.lastFrameEvaluated = this.currentFrame;
		repeat.lastResult = result;
		return result;
	}

	public pointerButton(button: BmsxConsolePointerButton): boolean {
		if (button < 0 || button >= BmsxConsolePointerButtonCount) {
			return false;
		}
		return this.pointerPressed[button] === true;
	}

	public pointerButtonPressed(button: BmsxConsolePointerButton): boolean {
		if (button < 0 || button >= BmsxConsolePointerButtonCount) {
			return false;
		}
		return this.pointerJustPressed[button] === true;
	}

	public pointerButtonReleased(button: BmsxConsolePointerButton): boolean {
		if (button < 0 || button >= BmsxConsolePointerButtonCount) {
			return false;
		}
		return this.pointerJustReleased[button] === true;
	}

	public pointerPosition(): ConsolePointerVector {
		const playerInput = $.input.getPlayerInput(this.playerIndex);
		const state = playerInput ? playerInput.getActionState('pointer_position') : null;
		const coords = state?.value2d ?? null;
		if (!coords) {
			return { x: 0, y: 0, valid: false };
		}
		return { x: coords[0], y: coords[1], valid: true };
	}

	public pointerDelta(): ConsolePointerVector {
		const playerInput = $.input.getPlayerInput(this.playerIndex);
		const state = playerInput ? playerInput.getActionState('pointer_delta') : null;
		const delta = state?.value2d ?? null;
		if (!delta) {
			return { x: 0, y: 0, valid: false };
		}
		return { x: delta[0], y: delta[1], valid: true };
	}

	public pointerWheel(): ConsolePointerWheel {
		const playerInput = $.input.getPlayerInput(this.playerIndex);
		const state = playerInput ? playerInput.getActionState('pointer_wheel') : null;
		const raw = typeof state?.value === 'number' ? state.value : null;
		if (typeof raw === 'number') {
			return { value: raw, valid: true };
		}
		return { value: 0, valid: false };
	}

	private ensureRepeatState(button: BmsxConsoleButton): RepeatStateEntry {
		const idx = button as number;
		let entry = this.repeatState[idx];
		if (!entry) {
			entry = {
				active: false,
				repeatCount: 0,
				lastFrameEvaluated: -1,
				lastResult: false,
				hasDispatchedThisCycle: false,
				pressStartFrame: -1,
			};
			this.repeatState[idx] = entry;
		}
		return entry;
	}

	private computeRepeatCount(heldFrames: number): number {
		if (heldFrames < 0) {
			throw new Error('[BmsxConsoleInput] Held frame count cannot be negative.');
		}
		if (heldFrames < BmsxConsoleInput.INITIAL_REPEAT_DELAY_FRAMES) {
			return 0;
		}
		const elapsedSinceDelay = heldFrames - BmsxConsoleInput.INITIAL_REPEAT_DELAY_FRAMES;
		return Math.floor(elapsedSinceDelay / BmsxConsoleInput.REPEAT_INTERVAL_FRAMES) + 1;
	}

	private getState(button: BmsxConsoleButton): ActionState {
		if (button < 0 || button >= BmsxConsoleButtonCount) {
			throw new Error(`[BmsxConsoleInput] Button index ${button} outside supported range 0-${BmsxConsoleButtonCount - 1}.`);
		}
		const actionName = BUTTON_ACTIONS[button];
		const playerInput = $.input.getPlayerInput(this.playerIndex);
		return playerInput.getActionState(actionName);
	}

	private updatePointerButtonStates(): void {
		const playerInput = $.input.getPlayerInput(this.playerIndex);
		if (!playerInput) {
			for (let i = 0; i < BmsxConsolePointerButtonCount; i++) {
				this.pointerJustPressed[i] = false;
				this.pointerJustReleased[i] = this.pointerPressed[i] === true;
				this.pointerPressed[i] = false;
			}
			return;
		}
		for (let i = 0; i < BmsxConsolePointerButtonCount; i++) {
			const previousPressed = this.pointerPressed[i] === true;
			const actionName = POINTER_CODES[i];
			const actionState = playerInput.getActionState(actionName);
			const pressed = actionState.pressed === true && actionState.consumed !== true;
			this.pointerJustPressed[i] = pressed && !previousPressed;
			this.pointerJustReleased[i] = !pressed && previousPressed;
			this.pointerPressed[i] = pressed;
		}
	}
}
