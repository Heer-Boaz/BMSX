import {
	type GamepadDevice as HostGamepadDevice,
	type InputDevice,
	type InputEventSink,
	type InputSource,
} from '../common/input/contracts';
import { type HostClock } from '../common/clock';
import { GAMEPAD_BUTTON_IDS } from '../common/input/gamepad_buttons';
import type { BrowserOnscreenGamepad } from './onscreen_gamepad';
import {
	createGamepadHaptics,
	type GamepadHaptics,
} from './gamepad_haptics';
import { sonyGamepadProductId } from './sony_gamepad_hid';

const W3C_STANDARD_GAMEPAD_BUTTON_COUNT = 17;
const W3C_STANDARD_GAMEPAD_AXIS_COUNT = 4;

class GamepadDevice implements HostGamepadDevice {
	readonly id: string;
	readonly kind = 'gamepad';
	readonly gamepadIndex: number;
	private readonly mappedButtonCount: number;
	private readonly mappedAxisCount: number;
	private lastTimestamp = -1;
	private readonly buttonPrev: Uint8Array;
	private readonly pressIds: Float64Array;
	private readonly vibrationEffect: GamepadEffectParameters = {
		duration: 0,
		strongMagnitude: 0,
		weakMagnitude: 0,
	};
	readonly vibrationInitialization: GamepadHaptics | null;
	private readonly browserVibration = navigator.vibrate != null;
	private vibrationActuator: GamepadHapticActuator;
	private nextPressId = 1;
	private leftAxisX = 0;
	private leftAxisY = 0;
	private rightAxisX = 0;
	private rightAxisY = 0;

	constructor(source: Gamepad, clock: HostClock) {
		this.gamepadIndex = source.index;
		this.id = 'gamepad:' + this.gamepadIndex;
		const sonyProductId = sonyGamepadProductId(source.id);
		this.mappedButtonCount = Math.min(
			source.buttons.length,
			sonyProductId > 0
				? GAMEPAD_BUTTON_IDS.length
				: W3C_STANDARD_GAMEPAD_BUTTON_COUNT,
		);
		this.mappedAxisCount = Math.min(source.axes.length, W3C_STANDARD_GAMEPAD_AXIS_COUNT);
		this.buttonPrev = new Uint8Array(this.mappedButtonCount);
		this.pressIds = new Float64Array(this.mappedButtonCount);
		this.vibrationActuator = source.vibrationActuator;
		this.vibrationInitialization = createGamepadHaptics(
			source.index,
			source.id,
			clock,
		);
	}

	get supportsVibration(): boolean {
		return this.vibrationActuator != null
			|| (this.vibrationInitialization != null && this.vibrationInitialization.connected)
			|| this.browserVibration;
	}

	setVibration(durationMs: number, intensity: number): void {
		const actuator = this.vibrationActuator;
		if (actuator) {
			this.vibrationEffect.duration = durationMs;
			this.vibrationEffect.strongMagnitude = intensity;
			this.vibrationEffect.weakMagnitude = intensity;
			void actuator.playEffect('dual-rumble', this.vibrationEffect);
			return;
		}
		if (this.vibrationInitialization != null && this.vibrationInitialization.connected) {
			this.vibrationInitialization.setVibration(durationMs, intensity);
			return;
		}
		navigator.vibrate(durationMs * intensity);
	}

	disconnect(): void {
		if (this.vibrationInitialization != null) {
			this.vibrationInitialization.disconnect();
		}
	}

	poll(pad: Gamepad, time: number, sink: InputEventSink): void {
		this.vibrationActuator = pad.vibrationActuator;
		const timestamp = pad.timestamp;
		if (timestamp === this.lastTimestamp) return;
		this.lastTimestamp = timestamp;

		const buttons = pad.buttons;
		for (let i = 0; i < this.mappedButtonCount; i++) {
			const pressed = buttons[i].pressed;
			const prev = this.buttonPrev[i] !== 0;
			if (pressed && !prev) {
				const pressId = this.nextPressId++;
				this.pressIds[i] = pressId;
				sink.inputButton(this.id, GAMEPAD_BUTTON_IDS[i], true, buttons[i].value, time, pressId);
			} else if (!pressed && prev) {
				const pressId = this.pressIds[i];
				sink.inputButton(this.id, GAMEPAD_BUTTON_IDS[i], false, 0, time, pressId);
			}
			this.buttonPrev[i] = pressed ? 1 : 0;
		}

		if (this.mappedAxisCount >= 2) {
			const x = pad.axes[0];
			const y = pad.axes[1];
			if (x !== this.leftAxisX || y !== this.leftAxisY) {
				this.leftAxisX = x;
				this.leftAxisY = y;
				sink.inputAxis2(this.id, 'ls', x, y, time);
			}
		}
		if (this.mappedAxisCount >= 4) {
			const x = pad.axes[2];
			const y = pad.axes[3];
			if (x !== this.rightAxisX || y !== this.rightAxisY) {
				this.rightAxisX = x;
				this.rightAxisY = y;
				sink.inputAxis2(this.id, 'rs', x, y, time);
			}
		}
	}
}

export class BrowserInputHub implements InputSource {
	private sink: InputEventSink;
	private readonly devicesList: InputDevice[];
	private readonly gamepads: GamepadDevice[] = [];
	private readonly clock: HostClock;
	private readonly onscreenGamepad: BrowserOnscreenGamepad;
	private keyboardCapture: ((code: string) => boolean) = null;
	private nextPressId = 1;
	private readonly activeKeyPressIds = new Map<string, number>();
	private readonly activePointerIds: number[] = [];
	private readonly activePointerButtons: number[] = [];
	private readonly activePointerPressIds: number[] = [];

	constructor(
		surface: HTMLElement,
		clock: HostClock,
		onscreenGamepad: BrowserOnscreenGamepad,
		private readonly supervisorRequestKeyCode: string,
	) {
		this.clock = clock;
		this.onscreenGamepad = onscreenGamepad;
		this.devicesList = [
			{ id: 'keyboard:0', kind: 'keyboard' },
			{ id: 'pointer:0', kind: 'pointer' },
		];
		if (onscreenGamepad) {
			this.devicesList.push(onscreenGamepad);
		}

		window.addEventListener('keydown', this.onKeyDown, { passive: false, capture: true });
		window.addEventListener('keyup', this.onKeyUp, { passive: false, capture: true });
		window.addEventListener('blur', this.onWindowFocusChange, { passive: true });
		window.addEventListener('focus', this.onWindowFocusChange, { passive: true });
		surface.addEventListener('pointerdown', this.onPointerDown, { passive: false });
		surface.addEventListener('pointerup', this.onPointerUp, { passive: false });
		surface.addEventListener('pointermove', this.onPointerMove, { passive: false });
		surface.addEventListener('wheel', this.onWheel, { passive: false });
		surface.addEventListener('contextmenu', this.onContextMenu, { passive: false });
		surface.addEventListener('pointercancel', this.onPointerCancel, { passive: false });
		surface.addEventListener('lostpointercapture', this.onPointerCancel, { passive: false });
		surface.addEventListener('pointerleave', this.onPointerLeave, { passive: true });

		window.addEventListener('gamepadconnected', this.onGamepadConnected);
		window.addEventListener('gamepaddisconnected', this.onGamepadDisconnected);
		this.scanInitialGamepads();
	}

	subscribe(sink: InputEventSink): () => void {
		this.sink = sink;
		return () => {
			this.sink = null;
		};
	}

	devices(): InputDevice[] {
		return this.devicesList;
	}

	poll(time: number): void {
		if (this.onscreenGamepad) {
			this.onscreenGamepad.poll(time, this.sink);
		}
		const pads = navigator.getGamepads();
		for (let index = 0; index < this.gamepads.length; index += 1) {
			const device = this.gamepads[index];
			const pad = pads[index];
			if (device && pad) {
				device.poll(pad, time, this.sink);
			}
		}
	}

	setKeyboardCapture(handler: (code: string) => boolean): void {
		this.keyboardCapture = handler;
	}

	private onKeyDown = (event: KeyboardEvent) => {
		const captured = event.code === this.supervisorRequestKeyCode
			|| (this.keyboardCapture && this.keyboardCapture(event.code));
		if (captured || this.shouldBlockBrowserShortcut(event)) {
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			event.returnValue = false;
		}
		if (this.activeKeyPressIds.has(event.code)) {
			return;
		}
		const now = this.clock.now();
		const pressId = this.nextPressId++;
		this.activeKeyPressIds.set(event.code, pressId);
		if (event.code === this.supervisorRequestKeyCode) {
			this.sink.setSupervisorRequestLine(true);
			return;
		}
		this.sink.inputButton('keyboard:0', event.code, true, 1, now, pressId);
	};

	private onKeyUp = (event: KeyboardEvent) => {
		const captured = event.code === this.supervisorRequestKeyCode
			|| (this.keyboardCapture && this.keyboardCapture(event.code));
		if (captured || this.shouldBlockBrowserShortcut(event)) {
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			event.returnValue = false;
		}
		const now = this.clock.now();
		const wasPressed = this.activeKeyPressIds.has(event.code);
		let pressId = this.activeKeyPressIds.get(event.code);
		if (!pressId) {
			pressId = this.nextPressId++;
		}
		this.activeKeyPressIds.delete(event.code);
		if (event.code === this.supervisorRequestKeyCode) {
			if (wasPressed) {
				this.sink.setSupervisorRequestLine(false);
			}
			return;
		}
		this.sink.inputButton('keyboard:0', event.code, false, 0, now, pressId);
	};

	private onWindowFocusChange = () => {
		const supervisorRequestLineHigh = this.activeKeyPressIds.has(this.supervisorRequestKeyCode);
		this.activeKeyPressIds.clear();
		this.activePointerIds.length = 0;
		this.activePointerButtons.length = 0;
		this.activePointerPressIds.length = 0;
		if (supervisorRequestLineHigh) {
			this.sink.setSupervisorRequestLine(false);
		}
		this.sink.resetInput();
	};

	private onPointerDown = (event: PointerEvent) => {
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		(event.currentTarget as Element).setPointerCapture(event.pointerId);
		const now = this.clock.now();
		const code = pointerButton(event.button);
		const pressIndex = this.activePointerIndex(event.pointerId, event.button);
		let pressId = pressIndex >= 0 ? this.activePointerPressIds[pressIndex] : 0;
		if (!pressId) {
			pressId = this.nextPressId++;
			this.activePointerIds.push(event.pointerId);
			this.activePointerButtons.push(event.button);
			this.activePointerPressIds.push(pressId);
		}
		this.sink.inputButton('pointer:0', code, true, 1, now, pressId);
		this.sink.inputAxis2('pointer:0', 'pointer_position', event.clientX, event.clientY, now);
	};

	private onPointerUp = (event: PointerEvent) => {
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		const now = this.clock.now();
		const code = pointerButton(event.button);
		const pressIndex = this.activePointerIndex(event.pointerId, event.button);
		let pressId = pressIndex >= 0 ? this.activePointerPressIds[pressIndex] : 0;
		if (!pressId) {
			pressId = this.nextPressId++;
		}
		if (pressIndex >= 0) {
			const last = this.activePointerIds.length - 1;
			this.activePointerIds[pressIndex] = this.activePointerIds[last];
			this.activePointerButtons[pressIndex] = this.activePointerButtons[last];
			this.activePointerPressIds[pressIndex] = this.activePointerPressIds[last];
			this.activePointerIds.length = last;
			this.activePointerButtons.length = last;
			this.activePointerPressIds.length = last;
		}
		this.sink.inputButton('pointer:0', code, false, 0, now, pressId);
		this.sink.inputAxis2('pointer:0', 'pointer_position', event.clientX, event.clientY, now);
	};

	private onPointerCancel = (event: PointerEvent) => {
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		const now = this.clock.now();
		let index = 0;
		while (index < this.activePointerIds.length) {
			if (this.activePointerIds[index] !== event.pointerId) {
				index += 1;
				continue;
			}
			this.sink.inputButton(
				'pointer:0',
				pointerButton(this.activePointerButtons[index]),
				false,
				0,
				now,
				this.activePointerPressIds[index],
			);
			const last = this.activePointerIds.length - 1;
			this.activePointerIds[index] = this.activePointerIds[last];
			this.activePointerButtons[index] = this.activePointerButtons[last];
			this.activePointerPressIds[index] = this.activePointerPressIds[last];
			this.activePointerIds.length = last;
			this.activePointerButtons.length = last;
			this.activePointerPressIds.length = last;
		}
		this.sink.inputAxis2('pointer:0', 'pointer_position', event.clientX, event.clientY, now);
	};

	private activePointerIndex(pointerId: number, button: number): number {
		for (let index = 0; index < this.activePointerIds.length; index += 1) {
			if (this.activePointerIds[index] === pointerId
				&& this.activePointerButtons[index] === button) {
				return index;
			}
		}
		return -1;
	}

	private onPointerMove = (event: PointerEvent) => {
		if (event.pointerType !== 'mouse') {
			event.preventDefault();
		}
		const now = this.clock.now();
		this.sink.inputAxis2('pointer:0', 'pointer_position', event.clientX, event.clientY, now);
	};

	private onWheel = (event: WheelEvent) => {
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		const now = this.clock.now();
		this.sink.inputAxis1('pointer:0', 'pointer_wheel', event.deltaY, now);
	};

	private onContextMenu = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
	};

	private onPointerLeave = (event: PointerEvent) => {
		const now = this.clock.now();
		this.sink.inputAxis2('pointer:0', 'pointer_position', event.clientX, event.clientY, now);
	};

	private scanInitialGamepads(): void {
		const pads = navigator.getGamepads();
		for (let i = 0; i < pads.length; i++) {
			const gp = pads[i];
			if (!gp) continue;
			if (this.gamepads[gp.index]) continue;
			const device = new GamepadDevice(gp, this.clock);
			this.gamepads[gp.index] = device;
			this.devicesList.push(device);
		}
	}

	private onGamepadConnected = (event: GamepadEvent) => {
		const source = event.gamepad;
		if (this.gamepads[source.index]) return;
		const device = new GamepadDevice(source, this.clock);
		this.gamepads[source.index] = device;
		this.devicesList.push(device);
		this.sink.connectInputDevice(device);
	};

	private onGamepadDisconnected = (event: GamepadEvent) => {
		const source = event.gamepad;
		const id = 'gamepad:' + source.index;
		const device = this.gamepads[source.index];
		device.disconnect();
		delete this.gamepads[source.index];
		this.devicesList.splice(this.devicesList.indexOf(device), 1);
		this.sink.disconnectInputDevice(id);
	};

	private shouldBlockBrowserShortcut(_event: KeyboardEvent): boolean {
		return true;
	}
}

function pointerButton(button: number): string {
	if (button < 0) return 'pointer_primary';
	if (button === 0) return 'pointer_primary';
	if (button === 1) return 'pointer_aux';
	if (button === 2) return 'pointer_secondary';
	if (button === 3) return 'pointer_back';
	return 'pointer_forward';
}
