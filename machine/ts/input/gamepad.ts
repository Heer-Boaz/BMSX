import { getPressedState, makeButtonState, resetObject } from './manager';
import type { ButtonState, InputHandler, KeyOrButtonId2ButtonState } from './models';
import { inputControllerGamepadButtonBit } from './gamepad_buttons';
import type { InputDevice } from '../platform';
import type { VibrationParams } from '../platform';
import { DualSenseHID } from './dualsense_hid';
import { machineManager } from '../core/machine_manager';
import {
	INPUT_CONTROLLER_PAD_AXIS_COUNT,
	type InputControllerPadSnapshot,
	type InputControllerSnapshot,
} from '../machine/devices/input/contracts';

export class GamepadInput implements InputHandler {
	private readonly buttonStates: KeyOrButtonId2ButtonState = {};
	private inputControllerButtons = 0;
	private readonly inputControllerAxes = new Float32Array(INPUT_CONTROLLER_PAD_AXIS_COUNT);
	private readonly hidPad = new DualSenseHID();
	private nextPressId = 1;
	private lastPollTime = 0;

	private device: InputDevice;

	constructor(public readonly deviceId: string, public readonly description: string, device: InputDevice) {
		this.device = device;
		this.reset();
	}

	public get gamepadIndex(): number {
		const index = parseInt(this.deviceId.split(':')[1] ?? '-1', 10);
		return index;
	}

	public get supportsVibrationEffect(): boolean {
		return !!this.device?.supportsVibration || this.hidPad.isConnected;
	}

	public setDevice(device: InputDevice): void {
		this.device = device;
	}

	public pollInput(): void {
		const now = machineManager.platform.clock.now();
		const prevPollTime = this.lastPollTime;
		this.lastPollTime = now;

		const keys = Object.keys(this.buttonStates);
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			const state = this.buttonStates[key];
			if (!state) continue;
			if (state.pressed) {
				const pressedAt = state.pressedAtMs ?? state.timestamp ?? now; // TODO: USE resolveStateTimestamp
				state.presstime = now - pressedAt;
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
			state.consumed = state.consumed ?? false;
		}
	}

	public getButtonState(btn: string): ButtonState {
		return getPressedState(this.buttonStates, btn);
	}

	public writeInputControllerPadSnapshot(snapshot: InputControllerPadSnapshot): void {
		snapshot.buttons = this.inputControllerButtons;
		snapshot.axes.set(this.inputControllerAxes);
	}

	public writeInputControllerKeyWords(_keyWords: Uint32Array): void { }

	public writeInputControllerPointerSnapshot(_snapshot: InputControllerSnapshot): void { }

	public ingestButton(code: string, down: boolean, value: number, timestamp: number, pressId?: number): void {
		const state = this.buttonStates[code] ?? makeButtonState();
		if (down) {
			const existingPressId = pressId ?? state.pressId ?? this.nextPressId++;
			state.pressed = true;
			state.justpressed = true;
			state.justreleased = false;
			state.waspressed = true;
			state.timestamp = timestamp;
			state.pressedAtMs = timestamp;
			state.value = value;
			state.pressId = existingPressId;
		} else {
			const wasPressed = state.pressed;
			state.justreleased = wasPressed;
			state.pressed = false;
			state.justpressed = false;
			state.timestamp = timestamp;
			state.releasedAtMs = timestamp;
			state.value = 0;
			state.waspressed = state.waspressed || wasPressed;
			state.wasreleased = state.wasreleased || wasPressed;
			if (pressId !== undefined) state.pressId = pressId;
			state.consumed = false;
		}
		this.buttonStates[code] = state;
		const bit = inputControllerGamepadButtonBit(code);
		if (bit >= 0) {
			const mask = 1 << bit;
			this.inputControllerButtons = down ? ((this.inputControllerButtons | mask) >>> 0) : ((this.inputControllerButtons & ~mask) >>> 0);
		}
		if (code === 'lt') {
			this.inputControllerAxes[4] = down ? value : 0;
		} else if (code === 'rt') {
			this.inputControllerAxes[5] = down ? value : 0;
		}
	}

	public ingestAxis2(code: string, x: number, y: number, timestamp: number): void {
		const state = this.buttonStates[code] ?? makeButtonState();
		state.value2d = [x, y];
		state.value = Math.hypot(x, y);
		state.timestamp = timestamp;
		this.buttonStates[code] = state;
		if (code === 'ls') {
			this.inputControllerAxes[0] = x;
			this.inputControllerAxes[1] = y;
		} else if (code === 'rs') {
			this.inputControllerAxes[2] = x;
			this.inputControllerAxes[3] = y;
		}
	}

	public consumeButton(button: string): void {
		const state = this.buttonStates[button];
		if (state) {
			state.consumed = true;
		}
	}

	public reset(except?: string[]): void {
		if (!except) {
			const keys = Object.keys(this.buttonStates);
			for (let i = 0; i < keys.length; i++) delete this.buttonStates[keys[i]];
			this.inputControllerButtons = 0;
			this.inputControllerAxes.fill(0);
			this.lastPollTime = 0;
			return;
		}
		resetObject(this.buttonStates, except);
		this.rebuildInputControllerState();
	}

	private rebuildInputControllerState(): void {
		this.inputControllerButtons = 0;
		this.inputControllerAxes.fill(0);
		const keys = Object.keys(this.buttonStates);
		for (let i = 0; i < keys.length; i += 1) {
			const code = keys[i];
			const state = this.buttonStates[code];
			if (state.pressed) {
				const bit = inputControllerGamepadButtonBit(code);
				if (bit >= 0) {
					this.inputControllerButtons = (this.inputControllerButtons | (1 << bit)) >>> 0;
				}
			}
			if (code === 'ls' && state.value2d) {
				this.inputControllerAxes[0] = state.value2d[0];
				this.inputControllerAxes[1] = state.value2d[1];
			} else if (code === 'rs' && state.value2d) {
				this.inputControllerAxes[2] = state.value2d[0];
				this.inputControllerAxes[3] = state.value2d[1];
			} else if (code === 'lt') {
				this.inputControllerAxes[4] = state.pressed ? (state.value ?? 0) : 0;
			} else if (code === 'rt') {
				this.inputControllerAxes[5] = state.pressed ? (state.value ?? 0) : 0;
			}
		}
	}

	public applyVibrationEffect(params: VibrationParams): void {
		if (this.device && this.device.supportsVibration) {
			this.device.setVibration({ effect: 'dual-rumble', duration: params.duration, intensity: params.intensity });
			return;
		}
		if (!this.hidPad.isConnected) {
			const nav = globalThis.navigator as (Navigator & { vibrate?: (pattern: number | number[]) => boolean }) | undefined;
			nav?.vibrate?.(params.duration * params.intensity);
			return;
		}
		const strongMagnitude = ~~(params.intensity > 0.5 ? params.intensity * 255 : 0);
		const weakMagnitude = ~~(params.intensity <= 0.5 ? params.intensity * 255 : 0);
		try {
			this.hidPad.sendRumble({ strong: strongMagnitude, weak: weakMagnitude, duration: params.duration });
		} catch (err) {
			console.warn(`Error applying HID rumble: ${err}`);
			this.hidPad.disconnect();
		}
	}

	public async init(): Promise<void> {
		try {
			await this.hidPad.initForDevice(this.gamepadIndex, this.description);
		} catch (err) {
			console.warn(`Error initialising HID device for rumble: ${err}`);
		}
	}

	public dispose(): void {
		this.reset();
		this.hidPad.disconnect();
	}
}
