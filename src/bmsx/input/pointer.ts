import { $ } from '../core/engine';
import { getPressedState, makeButtonState, resetObject } from './manager';
import type { ButtonState, InputHandler, KeyOrButtonId2ButtonState } from './models';
import type { VibrationParams } from '../platform';


const POINTER_DEFAULT_CODES = [
	'pointer_primary',
	'pointer_secondary',
	'pointer_aux',
	'pointer_back',
	'pointer_forward',
	'pointer_position',
	'pointer_delta',
	'pointer_wheel',
] as const;

export class PointerInput implements InputHandler {
	public static readonly VIRTUAL_POINTER_INDEX = 0x7fffffff;
	public readonly gamepadIndex: number = PointerInput.VIRTUAL_POINTER_INDEX;

	private buttonStates: KeyOrButtonId2ButtonState = {};
	private nextPressId = 1;
	private lastPosition = { x: 0, y: 0 };
	private lastPositionValid = false;
	private lastDeltaTimestamp = 0;
	private lastWheelTimestamp = 0;

	constructor(public readonly deviceId: string = 'pointer:0') {
		this.reset();
	}

	public get supportsVibrationEffect(): boolean {
		return false;
	}

	public applyVibrationEffect(_params: VibrationParams): void { }

	public pollInput(): void {
		const now = $.platform.clock.now();
		for (const key of Object.keys(this.buttonStates)) {
			const state = this.buttonStates[key];
			if (!state) continue;
			if (state.pressed) {
				const pressedAt = state.pressedAtMs ?? state.timestamp ?? now; // TODO: USE resolveStateTimestamp
				state.presstime = now - pressedAt;
				state.justpressed = false;
			} else {
				state.presstime = null;
				state.justreleased = false;
			}
			if (key === 'pointer_delta') {
				const ts = state.timestamp ?? 0;
				if (ts === this.lastDeltaTimestamp) {
					state.value2d = [0, 0];
					state.value = 0;
					state.pressed = false;
					state.justpressed = false;
					state.justreleased = false;
				} else {
					this.lastDeltaTimestamp = ts;
				}
			} else if (key === 'pointer_wheel') {
				const ts = state.timestamp ?? 0;
				if (ts === this.lastWheelTimestamp) {
					const wasPressed = state.pressed;
					state.value = 0;
					state.pressed = false;
					state.justpressed = false;
					state.justreleased = wasPressed;
				} else {
					this.lastWheelTimestamp = ts;
					state.justreleased = false;
				}
			}
			state.waspressed = state.waspressed || state.pressed;
			state.wasreleased = state.wasreleased || (!state.pressed);
			state.consumed = state.consumed ?? false;
		}
	}

	public getButtonState(btn: string): ButtonState {
		return getPressedState(this.buttonStates, btn);
	}

	public ingestButton(code: string, state: ButtonState): void {
		const target = { ...state, value2d: state.value2d ? ([state.value2d[0], state.value2d[1]] as [number, number]) : null };
		if (target.pressed) {
			if (!target.pressId) target.pressId = this.nextPressId++;
			if (!target.pressedAtMs) target.pressedAtMs = target.timestamp ?? $.platform.clock.now();
		} else {
			target.consumed = false;
		}
		this.buttonStates[code] = target;
	}

	public ingestAxis2(code: string, x: number, y: number, timestamp: number): void {
		const current = this.buttonStates[code] ?? makeButtonState();
		const dx = this.lastPositionValid ? (x - this.lastPosition.x) : 0;
		const dy = this.lastPositionValid ? (y - this.lastPosition.y) : 0;
		this.lastPosition.x = x;
		this.lastPosition.y = y;
		this.lastPositionValid = true;
		current.value2d = [x, y];
		current.timestamp = timestamp;
		this.buttonStates[code] = current;

		const delta = this.buttonStates['pointer_delta'] ?? makeButtonState();
		const moved = dx !== 0 || dy !== 0;
		const wasPressed = delta.pressed;
		delta.value2d = [dx, dy];
		delta.value = Math.hypot(dx, dy);
		delta.timestamp = timestamp;
		delta.justreleased = !moved && wasPressed;
		delta.pressed = moved;
		delta.justpressed = moved && !wasPressed;
		delta.waspressed = moved || wasPressed;
		delta.consumed = false;
		this.buttonStates['pointer_delta'] = delta;
	}

	public ingestAxis1(code: string, x: number, timestamp: number): void {
		const current = this.buttonStates[code] ?? makeButtonState();
		current.value = x;
		current.timestamp = timestamp;
		if (code === 'pointer_wheel') {
			const hasDelta = x !== 0;
			if (hasDelta) {
				current.pressed = true;
				current.justpressed = true;
				current.justreleased = false;
				current.waspressed = true;
				current.consumed = false;
				current.pressedAtMs = current.timestamp;
				current.pressId = this.nextPressId++;
			}
		}
		this.buttonStates[code] = current;
	}

	public consumeButton(button: string): void {
		const state = this.buttonStates[button];
		if (state) {
			state.consumed = true;
			if (button === 'pointer_wheel') {
				state.pressed = false;
				state.justpressed = false;
				state.justreleased = false;
			}
		}
	}

	public reset(except?: string[]): void {
		if (!except) {
			this.buttonStates = {};
			for (const code of POINTER_DEFAULT_CODES) {
				this.buttonStates[code] = makeButtonState();
			}
			this.lastPosition = { x: 0, y: 0 };
			this.lastPositionValid = false;
			this.lastDeltaTimestamp = 0;
			this.lastWheelTimestamp = 0;
			return;
		}
		resetObject(this.buttonStates, except);
	}

	public dispose(): void {
		this.reset();
	}
}
