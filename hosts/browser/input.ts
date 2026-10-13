import { clipboardAction, type ClipboardAction } from '../common/clipboard';
import {
	type GamepadDevice as HostGamepadDevice,
	type InputDevice,
	type InputEventSink,
	type InputSource,
} from '../common/input/contracts';
import { type HostClock } from '../common/clock';
import { GAMEPAD_BUTTON_IDS } from '../common/input/gamepad_buttons';
import type { BrowserOnscreenGamepad } from './onscreen_gamepad';
import type { BrowserInputTraceObserver, BrowserInputTraceRoute, BrowserInputResetReason } from './input_trace_contract';
import {
	createGamepadHaptics,
	type GamepadHaptics,
} from './gamepad_haptics';
import { sonyGamepadProductId } from './sony_gamepad_hid';

const W3C_STANDARD_GAMEPAD_BUTTON_COUNT = 17;
const W3C_STANDARD_GAMEPAD_AXIS_COUNT = 4;
// Pointer Events report 1x1 when contact geometry is unavailable. This authored
// 28px touch envelope bridges adjacent gamepad buttons without enlarging mouse/pen input.
const ESTIMATED_TOUCH_HALF_SIZE = 14;
const POINTER_NATIVE_BUTTON_MASKS = [1, 4, 2, 8, 16] as const;
const POINTER_BUTTON_CODES = [
	'pointer_primary', 'pointer_aux', 'pointer_secondary', 'pointer_back', 'pointer_forward',
] as const;

class GamepadDevice implements HostGamepadDevice {
	readonly id: string;
	readonly kind = 'gamepad';
	readonly gamepadIndex: number;
	readonly label: string;
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
		this.label = `GAMEPAD ${this.gamepadIndex + 1}`;
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
	private foregroundPointerCapture: ((x: number, y: number) => boolean) | null = null;
	private nativeClipboardEnabled: ((action: ClipboardAction) => boolean) | undefined;
	private readonly nativeClipboardKeys = new Set<string>();
	private nextPressId = 1;
	private readonly activeKeyPressIds = new Map<string, number>();
	private readonly activePointerIds: number[] = [];
	private readonly activePointerButtonMasks: number[] = [];
	private activePointerCount = 0;
	private readonly pointerButtonCounts = new Uint32Array(POINTER_BUTTON_CODES.length);
	private readonly pointerPressIds = new Float64Array(POINTER_BUTTON_CODES.length);
	private readonly ownerDocument: Document;
	private readonly ownerWindow: Window;
	private traceObserver: BrowserInputTraceObserver | null = null;

	constructor(
		private readonly surface: HTMLElement,
		private readonly gestureSurface: HTMLElement,
		clock: HostClock,
		onscreenGamepad: BrowserOnscreenGamepad,
		private readonly supervisorRequestKeyCode: string,
	) {
		this.ownerDocument = surface.ownerDocument;
		this.ownerWindow = this.ownerDocument.defaultView;
		this.clock = clock;
		this.onscreenGamepad = onscreenGamepad;
		this.devicesList = [
			{ id: 'keyboard:0', kind: 'keyboard' },
			{ id: 'pointer:0', kind: 'pointer' },
		];
		if (onscreenGamepad) {
			this.devicesList.push(onscreenGamepad);
		}
	}

	/** Diagnostic callbacks are selected once; ordinary input handlers have no tracing work. */
	setTraceObserver(observer: BrowserInputTraceObserver): void {
		this.traceObserver = observer;
	}

	subscribe(sink: InputEventSink): () => void {
		this.sink = sink;
		const unsubscribeOnscreen = this.onscreenGamepad?.subscribe(sink);
		const ownerWindow = this.ownerWindow;
		const ownerDocument = this.ownerDocument;
		const surface = this.surface;
		const gestureSurface = this.gestureSurface;
		const trace = this.traceObserver;
		const pointerDown = trace ? this.observePointerRouting(trace, this.onPointerDown) : this.onPointerDown;
		const pointerMove = trace ? this.observePointerRouting(trace, this.onPointerMove) : this.onPointerMove;
		const pointerUp = trace ? this.observePointerRouting(trace, this.onPointerUp) : this.onPointerUp;
		const pointerCancel = trace ? this.observePointerRouting(trace, this.onPointerCancel) : this.onPointerCancel;
		const blur = trace ? () => this.observeInputReset(trace, 'blur') : this.cancelInput;
		const pagehide = trace ? () => this.observeInputReset(trace, 'pagehide') : this.cancelInput;
		const visibility = trace ? () => {
			if (ownerDocument.hidden) this.observeInputReset(trace, 'hidden');
		} : this.onVisibilityChange;
		ownerWindow.addEventListener('keydown', this.onKeyDown, { passive: false, capture: true });
		ownerWindow.addEventListener('keyup', this.onKeyUp, { passive: false, capture: true });
		ownerWindow.addEventListener('blur', blur, { passive: true });
		ownerWindow.addEventListener('pagehide', pagehide, { passive: true });
		ownerDocument.addEventListener('visibilitychange', visibility);
		gestureSurface.addEventListener('pointerdown', pointerDown, { passive: false, capture: true });
		ownerWindow.addEventListener('pointermove', pointerMove, { passive: false, capture: true });
		ownerWindow.addEventListener('pointerup', pointerUp, { passive: false, capture: true });
		ownerWindow.addEventListener('pointercancel', pointerCancel, { passive: false, capture: true });
		surface.addEventListener('pointerleave', this.onPointerLeave, { passive: true });
		surface.addEventListener('wheel', this.onWheel, { passive: false });
		gestureSurface.addEventListener('contextmenu', this.onContextMenu, { passive: false });
		gestureSurface.addEventListener('touchstart', this.onTouchGesture, { passive: false });
		gestureSurface.addEventListener('touchmove', this.onTouchGesture, { passive: false });
		gestureSurface.addEventListener('touchend', this.onTouchGesture, { passive: false });
		ownerWindow.addEventListener('gamepadconnected', this.onGamepadConnected);
		ownerWindow.addEventListener('gamepaddisconnected', this.onGamepadDisconnected);
		return () => {
			ownerWindow.removeEventListener('keydown', this.onKeyDown, true);
			ownerWindow.removeEventListener('keyup', this.onKeyUp, true);
			ownerWindow.removeEventListener('blur', blur);
			ownerWindow.removeEventListener('pagehide', pagehide);
			ownerDocument.removeEventListener('visibilitychange', visibility);
			gestureSurface.removeEventListener('pointerdown', pointerDown, true);
			ownerWindow.removeEventListener('pointermove', pointerMove, true);
			ownerWindow.removeEventListener('pointerup', pointerUp, true);
			ownerWindow.removeEventListener('pointercancel', pointerCancel, true);
			surface.removeEventListener('pointerleave', this.onPointerLeave);
			surface.removeEventListener('wheel', this.onWheel);
			gestureSurface.removeEventListener('contextmenu', this.onContextMenu);
			gestureSurface.removeEventListener('touchstart', this.onTouchGesture);
			gestureSurface.removeEventListener('touchmove', this.onTouchGesture);
			gestureSurface.removeEventListener('touchend', this.onTouchGesture);
			ownerWindow.removeEventListener('gamepadconnected', this.onGamepadConnected);
			ownerWindow.removeEventListener('gamepaddisconnected', this.onGamepadDisconnected);
			if (trace) this.observeInputReset(trace, 'teardown');
			else this.cancelInput();
			unsubscribeOnscreen?.();
			for (const device of this.gamepads) {
				if (device) {
					device.disconnect();
					this.devicesList.splice(this.devicesList.indexOf(device), 1);
				}
			}
			this.gamepads.length = 0;
			this.sink = null;
		};
	}

	private observePointerRouting(observer: BrowserInputTraceObserver, handler: (event: PointerEvent) => void): (event: PointerEvent) => void {
		return event => {
			const before = this.onscreenGamepad ? this.onscreenGamepad.buttons : 0;
			const commonBefore = observer.commonGamepad ? observer.commonGamepad.physicalGamepadButtonsWord() : -1;
			let route: BrowserInputTraceRoute = this.onscreenGamepad?.ownsContact(event.pointerId)
				? 'controller' : this.activePointerIndex(event.pointerId) >= 0 ? 'canvas' : 'ignored';
			let completed = false;
			try {
				handler(event);
				completed = true;
			} finally {
				if (event.type === 'pointerdown') {
					route = this.onscreenGamepad?.ownsContact(event.pointerId)
						? 'controller' : this.activePointerIndex(event.pointerId) >= 0 ? 'canvas' : 'ignored';
				}
				observer.pointerRouted(event, route, before, this.onscreenGamepad ? this.onscreenGamepad.buttons : 0,
					commonBefore, observer.commonGamepad ? observer.commonGamepad.physicalGamepadButtonsWord() : -1, completed);
			}
		};
	}

	private observeInputReset(observer: BrowserInputTraceObserver, reason: BrowserInputResetReason): void {
		const before = this.onscreenGamepad ? this.onscreenGamepad.buttons : 0;
		const commonBefore = observer.commonGamepad ? observer.commonGamepad.physicalGamepadButtonsWord() : -1;
		let completed = false;
		try {
			this.cancelInput();
			completed = true;
		} finally {
			observer.inputReset(reason, before, this.onscreenGamepad ? this.onscreenGamepad.buttons : 0,
				commonBefore, observer.commonGamepad ? observer.commonGamepad.physicalGamepadButtonsWord() : -1, completed);
		}
	}

	devices(): InputDevice[] {
		this.scanInitialGamepads();
		return this.devicesList;
	}

	poll(time: number): void {
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

	/** Foreground host UI owns new contacts inside its actual displayed surface. */
	setForegroundPointerCapture(handler: (x: number, y: number) => boolean): void {
		this.foregroundPointerCapture = handler;
	}

	/** Host controls may admit native clipboard events without injecting a guest key. */
	setNativeClipboardEnabled(enabled: ((action: ClipboardAction) => boolean) | undefined): void { this.nativeClipboardEnabled = enabled; }

	/** Browser gestures belong to the entire player surface, including control misses. */
	private readonly onTouchGesture = (event: TouchEvent): void => {
		if (event.cancelable) event.preventDefault();
	};

	private onKeyDown = (event: KeyboardEvent) => {
		const action = clipboardAction(event.code, event.ctrlKey, event.metaKey, event.shiftKey, event.altKey);
		if (action !== undefined && this.nativeClipboardEnabled?.(action)) {
			this.nativeClipboardKeys.add(event.code);
			return; // Exactly one native action, never a duplicate polled editor/guest key.
		}
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
		if (this.nativeClipboardKeys.delete(event.code)) return;
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

	private readonly cancelInput = (): void => {
		this.onscreenGamepad?.cancelContacts();
		this.nativeClipboardKeys.clear();
		const supervisorRequestLineHigh = this.activeKeyPressIds.has(this.supervisorRequestKeyCode);
		this.activeKeyPressIds.clear();
		for (let index = 0; index < this.activePointerCount; index += 1) {
			const id = this.activePointerIds[index];
			if (this.surface.hasPointerCapture(id)) this.surface.releasePointerCapture(id);
		}
		this.activePointerCount = 0;
		this.pointerButtonCounts.fill(0);
		if (supervisorRequestLineHigh) this.sink.setSupervisorRequestLine(false);
		this.sink.resetInput();
	};

	private readonly onVisibilityChange = (): void => {
		if (this.ownerDocument.hidden) this.cancelInput();
	};

	private readonly onPointerDown = (event: PointerEvent): void => {
		const touch = event.pointerType === 'touch';
		const active = touch || (event.buttons & 1) !== 0;
		const foreground = this.foregroundPointerCapture !== null
			&& this.foregroundPointerCapture(event.clientX, event.clientY);
		if (!foreground && this.onscreenGamepad) {
			const estimated = touch && event.width === 1 && event.height === 1;
			const halfWidth = touch ? estimated ? ESTIMATED_TOUCH_HALF_SIZE : event.width / 2 : 0;
			const halfHeight = touch ? estimated ? ESTIMATED_TOUCH_HALF_SIZE : event.height / 2 : 0;
			if (this.onscreenGamepad.beginContact(event.pointerId, event.clientX, event.clientY, halfWidth, halfHeight, active)) {
				event.preventDefault();
				event.stopImmediatePropagation();
				this.gestureSurface.setPointerCapture(event.pointerId);
				return;
			}
		}
		if (!this.surface.contains(event.target as Node)) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		const index = this.activePointerCount++;
		const buttons = event.pointerType === 'touch' ? 1 : event.buttons;
		this.activePointerIds[index] = event.pointerId;
		this.activePointerButtonMasks[index] = buttons;
		this.surface.setPointerCapture(event.pointerId);
		const now = this.clock.now();
		this.updateCanvasButtons(0, buttons, now, false);
		this.sink.inputAxis2('pointer:0', 'pointer_position', event.clientX, event.clientY, now);
	};

	private readonly onPointerUp = (event: PointerEvent): void => {
		if (this.onscreenGamepad?.endContact(event.pointerId)) {
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}
		this.endCanvasPointer(event, false);
	};

	private readonly onPointerCancel = (event: PointerEvent): void => {
		if (this.onscreenGamepad?.endContact(event.pointerId)) {
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}
		this.endCanvasPointer(event, true);
	};

	/** Canvas contacts contribute independently to one normalized logical pointer. */
	private updateCanvasButtons(previous: number, buttons: number, now: number, cancelled: boolean): void {
		const changed = previous ^ buttons;
		if (changed === 0) return;
		let cancelledButtons = 0;
		for (let bit = 0; bit < POINTER_BUTTON_CODES.length; bit += 1) {
			const mask = POINTER_NATIVE_BUTTON_MASKS[bit];
			if ((changed & mask) === 0) continue;
			if ((buttons & mask) !== 0) {
				this.pointerButtonCounts[bit] += 1;
				if (this.pointerButtonCounts[bit] === 1) {
					const pressId = this.nextPressId++;
					this.pointerPressIds[bit] = pressId;
					this.sink.inputButton('pointer:0', POINTER_BUTTON_CODES[bit], true, 1, now, pressId);
				}
			} else {
				this.pointerButtonCounts[bit] -= 1;
				if (this.pointerButtonCounts[bit] === 0) {
					if (cancelled) cancelledButtons |= 1 << bit;
					else this.sink.inputButton('pointer:0', POINTER_BUTTON_CODES[bit], false, 0, now, this.pointerPressIds[bit]);
				}
			}
		}
		if (cancelledButtons !== 0) this.sink.cancelPointerButtons('pointer:0', cancelledButtons, now);
	}

	private activePointerIndex(pointerId: number): number {
		for (let index = 0; index < this.activePointerCount; index += 1) {
			if (this.activePointerIds[index] === pointerId) return index;
		}
		return -1;
	}

	private endCanvasPointer(event: PointerEvent, cancelled: boolean): void {
		const index = this.activePointerIndex(event.pointerId);
		if (index < 0) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		const now = this.clock.now();
		this.updateCanvasButtons(this.activePointerButtonMasks[index], 0, now, cancelled);
		const last = --this.activePointerCount;
		this.activePointerIds[index] = this.activePointerIds[last];
		this.activePointerButtonMasks[index] = this.activePointerButtonMasks[last];
		if (!cancelled) this.sink.inputAxis2('pointer:0', 'pointer_position', event.clientX, event.clientY, now);
	}

	private readonly onPointerMove = (event: PointerEvent): void => {
		const touch = event.pointerType === 'touch';
		const active = touch || (event.buttons & 1) !== 0;
		if (this.onscreenGamepad) {
			const estimated = touch && event.width === 1 && event.height === 1;
			const halfWidth = touch ? estimated ? ESTIMATED_TOUCH_HALF_SIZE : event.width / 2 : 0;
			const halfHeight = touch ? estimated ? ESTIMATED_TOUCH_HALF_SIZE : event.height / 2 : 0;
			if (this.onscreenGamepad.moveContact(event.pointerId, event.clientX, event.clientY, halfWidth, halfHeight, active)) {
				event.preventDefault();
				event.stopImmediatePropagation();
				return;
			}
		}
		const index = this.activePointerIndex(event.pointerId);
		if (index >= 0) {
			event.preventDefault();
			event.stopImmediatePropagation();
			const now = this.clock.now();
			const buttons = event.pointerType === 'touch' ? 1 : event.buttons;
			this.updateCanvasButtons(this.activePointerButtonMasks[index], buttons, now, false);
			this.activePointerButtonMasks[index] = buttons;
			this.sink.inputAxis2('pointer:0', 'pointer_position', event.clientX, event.clientY, now);
			return;
		}
		if (event.pointerType !== 'touch' && event.buttons === 0 && this.surface.contains(event.target as Node)) {
			this.sink.inputAxis2('pointer:0', 'pointer_position', event.clientX, event.clientY, this.clock.now());
		}
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
		if (event.pointerType === 'touch' || this.onscreenGamepad?.ownsContact(event.pointerId)) return;
		if (event.buttons !== 0 && this.activePointerIndex(event.pointerId) < 0) return;
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
