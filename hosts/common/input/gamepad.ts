import { getPressedState } from './manager';
import type { ButtonState, GamepadInputHandler, KeyOrButtonId2ButtonState } from './models';
import { inputControllerGamepadButtonBit } from './gamepad_buttons';
import type { HostClock } from '../clock';
import type { GamepadDevice } from './contracts';
import {
	INPUT_CONTROLLER_PAD_AXIS_COUNT,
	InputControllerGamepadAxis,
	type InputControllerPadSnapshot,
} from '../../../machine/ts/machine/devices/input/contracts';
import { encodeSignedFix16 } from '../../../machine/ts/machine/common/numeric';

export class GamepadInput implements GamepadInputHandler {
	public readonly gamepadIndex: number;
	private readonly buttonStates: KeyOrButtonId2ButtonState = {};
	private inputControllerButtons = 0;
	private readonly inputControllerAxesQ16 = new Uint32Array(INPUT_CONTROLLER_PAD_AXIS_COUNT);
	private routedInputControllerButtons = 0;
	private readonly routedInputControllerAxesQ16 = new Uint32Array(INPUT_CONTROLLER_PAD_AXIS_COUNT);
	private readonly leftAxis: [number, number] = [0, 0];
	private readonly rightAxis: [number, number] = [0, 0];
	private lastPollTime = 0;

	constructor(
		private readonly clock: HostClock,
		public readonly deviceId: string,
		public device: GamepadDevice,
	) {
		this.gamepadIndex = device.gamepadIndex;
		this.reset();
	}

	public get supportsVibrationEffect(): boolean {
		return this.device.supportsVibration;
	}

	public pollInput(): void {
		const now = this.clock.now();
		const prevPollTime = this.lastPollTime;
		this.lastPollTime = now;
		this.routedInputControllerButtons = this.inputControllerButtons;
		this.routedInputControllerAxesQ16.set(this.inputControllerAxesQ16);

		for (const key in this.buttonStates) {
			const state = this.buttonStates[key];
			state.consumed = false;
			if (state.pressed) {
				state.presstime = now - state.pressedAtMs;
				if (prevPollTime > 0 && state.justpressed && state.timestamp <= prevPollTime) {
					state.justpressed = false;
				}
				state.justreleased = false;
			} else {
				state.presstime = null;
				if (prevPollTime > 0 && state.justreleased && state.timestamp <= prevPollTime) {
					state.justreleased = false;
				}
				state.justpressed = false;
			}
		}
	}

	// disable-next-line single_line_method_pattern -- GamepadInputHandler keeps lazy button-state ownership inside the physical device adapter.
	public getButtonState(btn: string): ButtonState {
		return getPressedState(this.buttonStates, btn);
	}

	public physicalGamepadButtonsWord(): number { return this.inputControllerButtons; }
	public physicalGamepadAxisWord(axis: InputControllerGamepadAxis): number { return this.inputControllerAxesQ16[axis]; }

	public writeInputControllerPadSnapshot(snapshot: InputControllerPadSnapshot): void {
		snapshot.buttons = this.routedInputControllerButtons;
		snapshot.axesQ16.set(this.routedInputControllerAxesQ16);
	}

	public ingestButton(code: string, down: boolean, value: number, timestamp: number, pressId: number): void {
		const state = getPressedState(this.buttonStates, code);
		if (down) {
			state.pressed = true;
			state.justpressed = true;
			state.justreleased = false;
			state.waspressed = true;
			state.timestamp = timestamp;
			state.pressedAtMs = timestamp;
			state.releasedAtMs = 0;
			state.value = value;
			state.pressId = pressId;
		} else {
			const wasPressed = state.pressed;
			state.justreleased = wasPressed;
			state.pressed = false;
			state.justpressed = false;
			state.timestamp = timestamp;
			state.pressedAtMs = 0;
			state.releasedAtMs = timestamp;
			state.value = 0;
			state.waspressed = state.waspressed || wasPressed;
			state.wasreleased = state.wasreleased || wasPressed;
			state.pressId = pressId;
			state.consumed = false;
		}
		const bit = inputControllerGamepadButtonBit(code);
		if (bit >= 0) {
			const mask = 1 << bit;
			this.inputControllerButtons = down ? ((this.inputControllerButtons | mask) >>> 0) : ((this.inputControllerButtons & ~mask) >>> 0);
		}
		if (code === 'lt') {
			this.inputControllerAxesQ16[InputControllerGamepadAxis.LeftTrigger] =
				down ? encodeSignedFix16(value) : 0;
		} else if (code === 'rt') {
			this.inputControllerAxesQ16[InputControllerGamepadAxis.RightTrigger] =
				down ? encodeSignedFix16(value) : 0;
		}
	}

	public ingestAxis2(code: string, x: number, y: number, timestamp: number): void {
		const state = getPressedState(this.buttonStates, code);
		let value2d = state.value2d;
		if (code === 'ls') {
			value2d = this.leftAxis;
		} else if (code === 'rs') {
			value2d = this.rightAxis;
		} else if (!value2d) {
			value2d = [0, 0];
		}
		state.value2d = value2d;
		value2d[0] = x;
		value2d[1] = y;
		state.value = Math.hypot(x, y);
		const wasPressed = state.pressed;
		state.pressed = state.value > 0;
		state.justpressed = state.pressed && !wasPressed;
		state.justreleased = !state.pressed && wasPressed;
		state.waspressed = state.waspressed || state.pressed || wasPressed;
		state.wasreleased = state.wasreleased || state.justreleased;
		state.consumed = false;
		if (state.justpressed) {
			state.pressedAtMs = timestamp;
			state.releasedAtMs = 0;
		} else if (state.justreleased) {
			state.pressedAtMs = 0;
			state.releasedAtMs = timestamp;
		}
		state.timestamp = timestamp;
		if (code === 'ls') {
			this.inputControllerAxesQ16[InputControllerGamepadAxis.LeftX] =
				encodeSignedFix16(x);
			this.inputControllerAxesQ16[InputControllerGamepadAxis.LeftY] =
				encodeSignedFix16(y);
		} else if (code === 'rs') {
			this.inputControllerAxesQ16[InputControllerGamepadAxis.RightX] =
				encodeSignedFix16(x);
			this.inputControllerAxesQ16[InputControllerGamepadAxis.RightY] =
				encodeSignedFix16(y);
		}
	}

	public consumeButton(button: string): void {
		const state = this.buttonStates[button];
		if (state) {
			state.consumed = true;
		}
		const bit = inputControllerGamepadButtonBit(button);
		if (bit >= 0) {
			this.routedInputControllerButtons = (this.routedInputControllerButtons & ~(1 << bit)) >>> 0;
		}
		switch (button) {
			case 'lt':
				this.routedInputControllerAxesQ16[InputControllerGamepadAxis.LeftTrigger] = 0;
				break;
			case 'rt':
				this.routedInputControllerAxesQ16[InputControllerGamepadAxis.RightTrigger] = 0;
				break;
			case 'ls':
				this.routedInputControllerAxesQ16[InputControllerGamepadAxis.LeftX] = 0;
				this.routedInputControllerAxesQ16[InputControllerGamepadAxis.LeftY] = 0;
				break;
			case 'rs':
				this.routedInputControllerAxesQ16[InputControllerGamepadAxis.RightX] = 0;
				this.routedInputControllerAxesQ16[InputControllerGamepadAxis.RightY] = 0;
				break;
		}
	}

	public consumeAllInput(): void {
		for (const key in this.buttonStates) {
			this.buttonStates[key].consumed = true;
		}
		this.routedInputControllerButtons = 0;
		this.routedInputControllerAxesQ16.fill(0);
	}

	public reset(): void {
		for (const key in this.buttonStates) {
			delete this.buttonStates[key];
		}
		this.inputControllerButtons = 0;
		this.inputControllerAxesQ16.fill(0);
		this.routedInputControllerButtons = 0;
		this.routedInputControllerAxesQ16.fill(0);
		this.leftAxis[0] = 0;
		this.leftAxis[1] = 0;
		this.rightAxis[0] = 0;
		this.rightAxis[1] = 0;
		getPressedState(this.buttonStates, 'ls').value2d = this.leftAxis;
		getPressedState(this.buttonStates, 'rs').value2d = this.rightAxis;
		this.lastPollTime = 0;
	}

	// disable-next-line single_line_method_pattern -- GamepadInputHandler routes retained player-port output to the currently attached physical device.
	public applyVibrationEffect(durationMs: number, intensity: number): void {
		this.device.setVibration(durationMs, intensity);
	}
}
