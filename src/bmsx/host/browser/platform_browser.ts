import {
	Clock,
	FrameLoop,
	Lifecycle,
	StorageService,
	HIDService,
	InputHub,
	InputEvt,
	InputDevice,
	DeviceKind,
	VibrationParams,
	PlatformServices,
	InputModifiers,
} from '../../core/platform';

class BrowserClock implements Clock {
	now(): number {
		return performance.now();
	}
}

class BrowserFrameLoop implements FrameLoop {
	private req = 0;

	start(tick: (t: number) => void): { stop(): void } {
		let alive = true;
		const loop = (t: number) => {
			if (!alive) return;
			tick(t);
			window.dispatchEvent(new Event('frame'));
			this.req = window.requestAnimationFrame(loop);
		};
		this.req = window.requestAnimationFrame(loop);
		return {
			stop: () => {
				alive = false;
				if (this.req !== 0) window.cancelAnimationFrame(this.req);
			},
		};
	}
}

class BrowserLifecycle implements Lifecycle {
	onVisibilityChange(cb: (visible: boolean) => void): () => void {
		const handler = () => {
			cb(!document.hidden);
		};
		document.addEventListener('visibilitychange', handler, { passive: true });
		return () => {
			document.removeEventListener('visibilitychange', handler);
		};
	}

	onWillExit(cb: (event: BeforeUnloadEvent) => void): () => void {
		const beforeUnload = (event: BeforeUnloadEvent) => {
			cb(event);
		};
		const pageHide = () => {
			const synthetic = new Event('beforeunload') as BeforeUnloadEvent;
			cb(synthetic);
		};
		window.addEventListener('beforeunload', beforeUnload);
		window.addEventListener('pagehide', pageHide);
		return () => {
			window.removeEventListener('beforeunload', beforeUnload);
			window.removeEventListener('pagehide', pageHide);
		};
	}
}

class BrowserStorage implements StorageService {
	getItem(k: string): string | null {
		return window.localStorage.getItem(k);
	}

	setItem(k: string, v: string): void {
		window.localStorage.setItem(k, v);
	}

	removeItem(k: string): void {
		window.localStorage.removeItem(k);
	}
}

class UnsupportedHID implements HIDService {
	isSupported(): boolean {
		return false;
	}

	async requestDevice(): Promise<HIDDevice[]> {
		throw new Error('WebHID not supported');
	}

	async getDevices(): Promise<HIDDevice[]> {
		return [];
	}
}

class WebHID implements HIDService {
	isSupported(): boolean {
		return 'hid' in navigator && navigator.hid !== undefined && navigator.hid !== null;
	}

	async requestDevice(options: HIDDeviceRequestOptions): Promise<HIDDevice[]> {
		return navigator.hid.requestDevice(options);
	}

	async getDevices(): Promise<HIDDevice[]> {
		return navigator.hid.getDevices();
	}
}

class KeyboardDevice implements InputDevice {
	id = 'keyboard:0';
	kind: DeviceKind = 'keyboard';
	description = 'Browser Keyboard';
	supportsVibration = false;

	setVibration(_params: VibrationParams): void {
		throw new Error('Keyboard vibration not supported');
	}

	poll(_clock: Clock): void { }
}

class PointerDevice implements InputDevice {
	id = 'pointer:0';
	kind: DeviceKind = 'pointer';
	description = 'Browser Pointer';
	supportsVibration = false;

	setVibration(_params: VibrationParams): void {
		throw new Error('Pointer vibration not supported');
	}

	poll(_clock: Clock): void { }
}

class GamepadDevice implements InputDevice {
	id: string;
	kind: DeviceKind = 'gamepad';
	description: string;
	supportsVibration = true;
	private index: number;
	private lastTimestamp: number | null = null;
	private buttonPrev: boolean[] = [];
	private pressIds: number[] = [];
	private nextPressId = 1;
	private post: (evt: InputEvt) => void;

	constructor(source: Gamepad, post: (evt: InputEvt) => void) {
		this.index = source.index;
		this.id = 'gamepad:' + this.index;
		this.description = source.id;
		this.post = post;
	}

	setVibration(params: VibrationParams): void {
		const pads = navigator.getGamepads();
		if (!pads) throw new Error('Gamepads unavailable');
		const pad = pads[this.index];
		if (!pad) throw new Error('Gamepad not present');
		const actuator = pad.vibrationActuator;
		if (!actuator) throw new Error('Vibration actuator not present');
		actuator.playEffect(params.effect, {
			duration: params.duration,
			strongMagnitude: params.intensity,
			weakMagnitude: params.intensity,
		});
	}

	poll(clock: Clock): void {
		const pads = navigator.getGamepads();
		if (!pads) return;
		const pad = pads[this.index];
		if (!pad) return;
		const timestamp = pad.timestamp;
		if (this.lastTimestamp !== null && timestamp === this.lastTimestamp) return;
		this.lastTimestamp = timestamp;

		const now = clock.now();
		const buttons = pad.buttons;
		for (let i = 0; i < buttons.length; i++) {
			const pressed = buttons[i].pressed;
			const prev = this.buttonPrev[i] === true;
			if (pressed && !prev) {
				const pressId = this.nextPressId++;
				this.pressIds[i] = pressId;
				this.post({ type: 'button', deviceId: this.id, code: mapButton(i), down: true, value: buttons[i].value, timestamp: now, pressId });
			} else if (!pressed && prev) {
				const pressId = this.pressIds[i] || null;
				this.post({ type: 'button', deviceId: this.id, code: mapButton(i), down: false, value: 0, timestamp: now, pressId });
			}
			this.buttonPrev[i] = pressed;
		}

		if (pad.axes.length >= 2) {
			this.post({ type: 'axis2', deviceId: this.id, code: 'ls', x: pad.axes[0], y: pad.axes[1], timestamp: now });
		}
		if (pad.axes.length >= 4) {
			this.post({ type: 'axis2', deviceId: this.id, code: 'rs', x: pad.axes[2], y: pad.axes[3], timestamp: now });
		}
	}
}

function mapButton(index: number): string {
	if (index === 0) return 'a';
	if (index === 1) return 'b';
	if (index === 2) return 'x';
	if (index === 3) return 'y';
	if (index === 4) return 'lb';
	if (index === 5) return 'rb';
	if (index === 6) return 'lt';
	if (index === 7) return 'rt';
	if (index === 8) return 'select';
	if (index === 9) return 'start';
	if (index === 10) return 'ls';
	if (index === 11) return 'rs';
	if (index === 12) return 'up';
	if (index === 13) return 'down';
	if (index === 14) return 'left';
	if (index === 15) return 'right';
	if (index === 16) return 'home';
	return 'touch';
}

function modifiersFrom(event: MouseEvent | PointerEvent | WheelEvent): InputModifiers {
	return {
		ctrl: event.ctrlKey === true,
		shift: event.shiftKey === true,
		alt: event.altKey === true,
	};
}


class BrowserInputHub implements InputHub {
  private subs = new Set<(e: InputEvt) => void>();
  private devicesList: InputDevice[] = [];
  private clock: Clock;
  private keyboardCapture: ((code: string) => boolean) | null = null;

  constructor(surface: HTMLElement, clock: Clock) {
	this.clock = clock;

	const keyboard = new KeyboardDevice();
	const pointer = new PointerDevice();
		this.devicesList.push(keyboard);
		this.devicesList.push(pointer);

		window.addEventListener('keydown', this.onKeyDown, { passive: false });
		window.addEventListener('keyup', this.onKeyUp, { passive: false });
		surface.addEventListener('pointerdown', this.onPointerDown, { passive: false });
		surface.addEventListener('pointerup', this.onPointerUp, { passive: false });
		surface.addEventListener('pointermove', this.onPointerMove, { passive: true });
		surface.addEventListener('wheel', this.onWheel, { passive: false });
		surface.addEventListener('contextmenu', this.onContextMenu, { passive: false });
		surface.addEventListener('pointercancel', this.onPointerCancel, { passive: false });
		surface.addEventListener('lostpointercapture', this.onPointerCancel, { passive: false });
		surface.addEventListener('pointerleave', this.onPointerLeave, { passive: true });

		window.addEventListener('gamepadconnected', this.onGamepadConnected);
		window.addEventListener('gamepaddisconnected', this.onGamepadDisconnected);
	}

	subscribe(fn: (e: InputEvt) => void): () => void {
		this.subs.add(fn);
		return () => {
			this.subs.delete(fn);
		};
	}

	post(e: InputEvt): void {
		const iterator = this.subs.values();
		for (let current = iterator.next(); !current.done; current = iterator.next()) {
			current.value(e);
		}
	}

	devices(): InputDevice[] {
		return this.devicesList;
	}

	setKeyboardCapture(handler: (code: string) => boolean): void {
		this.keyboardCapture = handler;
	}

	private onKeyDown = (event: KeyboardEvent) => {
		if (this.keyboardCapture && this.keyboardCapture(event.code)) {
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
		}
		const now = this.clock.now();
		this.post({ type: 'button', deviceId: 'keyboard:0', code: event.code, down: true, value: 1, timestamp: now, pressId: null });
	};

	private onKeyUp = (event: KeyboardEvent) => {
		if (this.keyboardCapture && this.keyboardCapture(event.code)) {
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
		}
		const now = this.clock.now();
		this.post({ type: 'button', deviceId: 'keyboard:0', code: event.code, down: false, value: 0, timestamp: now, pressId: null });
	};

  private onPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const target = event.target as Element | null;
    if (target?.setPointerCapture) {
      try { target.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    }
    const now = this.clock.now();
    const modifiers = modifiersFrom(event);
    this.post({ type: 'button', deviceId: 'pointer:0', code: pointerButton(event.button), down: true, value: 1, timestamp: now, pressId: null, modifiers });
    this.post({ type: 'axis2', deviceId: 'pointer:0', code: 'pointer_position', x: event.clientX, y: event.clientY, timestamp: now, modifiers });
  };

  private onPointerUp = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const target = event.target as Element | null;
    if (target && target.hasPointerCapture?.(event.pointerId)) {
      try { target.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
    }
    const now = this.clock.now();
    const modifiers = modifiersFrom(event);
    this.post({ type: 'button', deviceId: 'pointer:0', code: pointerButton(event.button), down: false, value: 0, timestamp: now, pressId: null, modifiers });
    this.post({ type: 'axis2', deviceId: 'pointer:0', code: 'pointer_position', x: event.clientX, y: event.clientY, timestamp: now, modifiers });
  };

  private onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') {
      event.preventDefault();
    }
    const now = this.clock.now();
    const modifiers = modifiersFrom(event);
    this.post({ type: 'axis2', deviceId: 'pointer:0', code: 'pointer_position', x: event.clientX, y: event.clientY, timestamp: now, modifiers });
  };

	private onWheel = (event: WheelEvent) => {
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		const now = this.clock.now();
		const modifiers = modifiersFrom(event);
		this.post({ type: 'axis1', deviceId: 'pointer:0', code: 'pointer_wheel', x: event.deltaY, timestamp: now, modifiers });
	};

	private onContextMenu = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
	};

  private onPointerCancel = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const target = event.target as Element | null;
    if (target && target.hasPointerCapture?.(event.pointerId)) {
      try { target.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
    }
    const now = this.clock.now();
    const modifiers = modifiersFrom(event);
    this.post({ type: 'button', deviceId: 'pointer:0', code: pointerButton(event.button), down: false, value: 0, timestamp: now, pressId: null, modifiers });
    this.post({ type: 'axis2', deviceId: 'pointer:0', code: 'pointer_position', x: event.clientX, y: event.clientY, timestamp: now, modifiers });
  };

  private onPointerLeave = (event: PointerEvent) => {
    const now = this.clock.now();
    const modifiers = modifiersFrom(event);
    this.post({ type: 'axis2', deviceId: 'pointer:0', code: 'pointer_position', x: event.clientX, y: event.clientY, timestamp: now, modifiers });
  };

	private onGamepadConnected = (event: GamepadEvent) => {
		const source = event.gamepad;
		const device = new GamepadDevice(source, this.post.bind(this));
		this.devicesList.push(device);
		const now = this.clock.now();
		this.post({ type: 'connect', device, timestamp: now });
	};

	private onGamepadDisconnected = (event: GamepadEvent) => {
		const source = event.gamepad;
		const id = 'gamepad:' + source.index;
		const now = this.clock.now();
		this.post({ type: 'disconnect', deviceId: id, timestamp: now });

		const retained: InputDevice[] = [];
		for (let i = 0; i < this.devicesList.length; i++) {
			if (this.devicesList[i].id !== id) retained.push(this.devicesList[i]);
		}
		this.devicesList = retained;
	};
}

function pointerButton(button: number): string {
	if (button < 0) return 'pointer_primary';
	if (button === 0) return 'pointer_primary';
	if (button === 1) return 'pointer_aux';
	if (button === 2) return 'pointer_secondary';
	if (button === 3) return 'pointer_back';
	return 'pointer_forward';
}

export class BrowserPlatformServices implements PlatformServices {
	clock: Clock;
	frames: FrameLoop;
	lifecycle: Lifecycle;
	input: InputHub;
	storage: StorageService;
	hid: HIDService;

	constructor(surface: HTMLElement) {
		this.clock = new BrowserClock();
		this.frames = new BrowserFrameLoop();
		this.lifecycle = new BrowserLifecycle();
		this.storage = new BrowserStorage();
		this.input = new BrowserInputHub(surface, this.clock);
		if ('hid' in navigator && navigator.hid !== undefined && navigator.hid !== null) {
			this.hid = new WebHID();
		} else {
			this.hid = new UnsupportedHID();
		}
	}
}
