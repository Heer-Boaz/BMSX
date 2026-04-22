import { getPressedState, makeButtonState, resetObject } from './manager';
import type { ButtonState, InputHandler, KeyOrButtonId2ButtonState } from './models';
import type { InputDevice } from '../platform';
import type { VibrationParams } from '../platform';
import { DualSenseHID } from './dualsense_hid';
import { $ } from '../core/engine';


export class GamepadInput implements InputHandler {
	private readonly buttonStates: KeyOrButtonId2ButtonState = {};
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
		const now = $.platform.clock.now();
		const prevPollTime = this.lastPollTime;
		this.lastPollTime = now;

		const keys = Object.keys(this.buttonStates);
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			const state = this.buttonStates[key];
			if (!state) continue;
			if (state.pressed) {
				const pressedAt = state.pressedAtMs ?? state.timestamp ?? now; // TODO: USE resolveStateTimestamp
				state.presstime = Math.max(0, now - pressedAt);
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
	}

	public ingestAxis2(code: string, x: number, y: number, timestamp: number): void {
		const state = this.buttonStates[code] ?? makeButtonState();
		state.value2d = [x, y];
		state.value = Math.hypot(x, y);
		state.timestamp = timestamp;
		this.buttonStates[code] = state;
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
			this.lastPollTime = 0;
			return;
		}
		resetObject(this.buttonStates, except);
	}

	public applyVibrationEffect(params: VibrationParams): void {
		if (this.device && this.device.supportsVibration) {
			this.device.setVibration({ effect: 'dual-rumble', duration: params.duration, intensity: params.intensity });
			return;
		}
		if (!this.hidPad.isConnected) {
			const nav = globalThis.navigator as (Navigator & { vibrate?: (pattern: number | number[]) => boolean }) | undefined;
			nav?.vibrate?.(Math.max(0, params.duration * params.intensity));
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
