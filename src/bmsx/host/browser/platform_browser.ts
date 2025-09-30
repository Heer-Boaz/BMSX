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
	Platform,
	AudioService,
	RngService,
	InputModifiers,
	OnscreenGamepadControlKind,
	OnscreenGamepadPlatform,
	OnscreenGamepadPlatformHooks,
	OnscreenGamepadPlatformSession,
	OnscreenPointerEvent,
} from '../platform';
import { WebAudioService } from './web_audio';
import type { GamepadControlHandle, GameViewCanvas, GameViewHost, HostEventListenerTarget, HostEventOptions, HostWindowEventType, OnscreenGamepadHandles, OverlayHandle, SurfaceBounds, ViewportDimensions, ViewportMetrics } from '../platform';
import type { GPUBackend } from 'bmsx/render/backend/pipeline_interfaces';
import { WebGLBackend } from 'bmsx/render/backend/webgl/webgl_backend';
import { WebGPUBackend } from 'bmsx/render/backend/webgpu/webgpu_backend';

export class BrowserPlatform implements Platform {
	clock: Clock;
	frames: FrameLoop;
	lifecycle: Lifecycle;
	input: InputHub;
	storage: StorageService;
	hid: HIDService;
	onscreenGamepad: OnscreenGamepadPlatform;
	audio: AudioService;
	rng: RngService;
	gameviewHost: BrowserGameViewHost;

	constructor(surface: HTMLElement, canvas: HTMLCanvasElement) {
		this.clock = new BrowserClock();
		this.frames = new BrowserFrameLoop();
		this.lifecycle = new BrowserLifecycle();
		this.storage = new BrowserStorage();
		this.input = new BrowserInputHub(surface, this.clock);
		const ownerDoc = surface.ownerDocument;
		if (!(ownerDoc instanceof Document)) {
			if (typeof document === 'undefined') {
				throw new Error('[BrowserPlatformServices] Unable to resolve a Document for the onscreen gamepad service.');
			}
			this.onscreenGamepad = new BrowserOnscreenGamepadPlatform(document);
		} else {
			this.onscreenGamepad = new BrowserOnscreenGamepadPlatform(ownerDoc);
		}
		if ('hid' in navigator && navigator.hid !== undefined && navigator.hid !== null) {
			this.hid = new WebHID();
		} else {
			this.hid = new UnsupportedHID();
		}
		this.audio = new WebAudioService();
		this.rng = new BrowserRngService();
		this.gameviewHost = new BrowserGameViewHost(canvas);
	}
}

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

class BrowserRngService implements RngService {
	private state: number;

	constructor(seed?: number) {
		this.state = this.normalizeSeed(seed ?? Date.now());
	}

	seed(value: number): void {
		this.state = this.normalizeSeed(value);
	}

	private normalizeSeed(value: number): number {
		const base = Math.floor(value);
		const normalized = base >>> 0;
		if (normalized === 0) return 0x6d2b79f5;
		return normalized;
	}

	next(): number {
		this.state = (this.state + 0x6d2b79f5) >>> 0;
		let t = this.state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		const result = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		return result;
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
				this.post({ type: 'button', deviceId: this.id, code: buttonMap[i], down: true, value: buttons[i].value, timestamp: now, pressId });
			} else if (!pressed && prev) {
				const pressId = this.pressIds[i] || null;
				this.post({ type: 'button', deviceId: this.id, code: buttonMap[i], down: false, value: 0, timestamp: now, pressId });
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

const buttonMap: { [index: number]: string } = {
	0: 'a',
	1: 'b',
	2: 'x',
	3: 'y',
	4: 'lb',
	5: 'rb',
	6: 'lt',
	7: 'rt',
	8: 'select',
	9: 'start',
	10: 'ls',
	11: 'rs',
	12: 'up',
	13: 'down',
	14: 'left',
	15: 'right',
	16: 'home',
};

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
		surface.addEventListener('pointermove', this.onPointerMove, { passive: false });
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

class BrowserOnscreenGamepadPlatformSession implements OnscreenGamepadPlatformSession {
	constructor(private readonly controller: AbortController) { }

	dispose(): void {
		this.controller.abort();
	}
}

function makePointerEvent(event: PointerEvent, owner: HTMLElement): OnscreenPointerEvent {
	const pointerId = event.pointerId;
	return {
		pointerId,
		clientX: event.clientX,
		clientY: event.clientY,
		pressure: event.pressure,
		buttons: event.buttons,
		capture(): void {
			owner.setPointerCapture(pointerId);
		},
		release(): void {
			if (owner.hasPointerCapture(pointerId)) {
				owner.releasePointerCapture(pointerId);
			}
		},
	};
}

function removeDpadClasses(target: Element): void {
	const removals: string[] = [];
	for (let i = 0; i < target.classList.length; i++) {
		const className = target.classList.item(i);
		if (className && className.indexOf('d-pad-') === 0) {
			removals.push(className);
		}
	}
	for (let i = 0; i < removals.length; i++) {
		target.classList.remove(removals[i]);
	}
}

export class BrowserOnscreenGamepadPlatform implements OnscreenGamepadPlatform {
	private readonly document: Document;

	constructor(doc?: Document) {
		if (doc) {
			this.document = doc;
		} else {
			if (typeof document === 'undefined') {
				throw new Error('[BrowserOnscreenGamepadPlatform] Global document is not available.');
			}
			this.document = document;
		}
		if (typeof window === 'undefined') {
			throw new Error('[BrowserOnscreenGamepadPlatform] Global window is not available.');
		}
	}

	attach(hooks: OnscreenGamepadPlatformHooks): OnscreenGamepadPlatformSession {
		const controller = new AbortController();
		const signal = controller.signal;
		const dpadSurface = this.querySurface('d-pad-controls');
		const actionSurface = this.querySurface('button-controls');
		this.setTouchActionNone(dpadSurface);
		this.setTouchActionNone(actionSurface);
		const pointerOptions: AddEventListenerOptions = { passive: options.passive, once: options.once, signal };
		this.bindSurfaceEvents(dpadSurface, 'dpad', hooks, pointerOptions);
		this.bindSurfaceEvents(actionSurface, 'action', hooks, pointerOptions);
		const blurHandler = () => hooks.blur();
		const focusHandler = () => hooks.focus();
		const outHandler = () => hooks.pointerOut();
		window.addEventListener('blur', blurHandler, { signal });
		window.addEventListener('focus', focusHandler, { signal });
		window.addEventListener('mouseout', outHandler, { signal });
		return new BrowserOnscreenGamepadPlatformSession(controller);
	}

	hideElements(elementIds: string[]): void {
		for (let i = 0; i < elementIds.length; i++) {
			const id = elementIds[i];
			const element = this.requireElement(id);
			element.classList.add('hidden');
			element.setAttribute('hidden', 'true');
			const textElement = this.requireElement(`${id}_text`);
			textElement.classList.add('hidden');
			textElement.setAttribute('hidden', 'true');
		}
	}

	collectElementIds(x: number, y: number, _kind: OnscreenGamepadControlKind): string[] {
		const elements = this.document.elementsFromPoint(x, y);
		const ids: string[] = [];
		for (let i = 0; i < elements.length; i++) {
			const elementId = elements[i].id;
			if (elementId && elementId.length > 0) {
				ids.push(elementId);
			}
		}
		return ids;
	}

	setElementActive(elementId: string, active: boolean): void {
		const element = this.requireElement(elementId);
		const isDpad = elementId.indexOf('d-pad-') === 0;
		const textElement = isDpad ? null : this.optionalElement(`${elementId}_text`);
		if (!isDpad && !textElement) {
			throw new Error(`[BrowserOnscreenGamepadPlatform] Text element '#${elementId}_text' was not found.`);
		}
		if (active) {
			element.classList.add('druk');
			element.classList.remove('los');
			element.setAttribute('data-touched', 'true');
			if (textElement) {
				textElement.classList.add('druk');
				textElement.classList.remove('los');
				textElement.setAttribute('data-touched', 'true');
			}
		} else {
			element.classList.remove('druk');
			element.classList.add('los');
			element.setAttribute('data-touched', 'false');
			if (textElement) {
				textElement.classList.remove('druk');
				textElement.classList.add('los');
				textElement.setAttribute('data-touched', 'false');
			}
		}
	}

	resetElements(elementIds: string[]): void {
		for (let i = 0; i < elementIds.length; i++) {
			const id = elementIds[i];
			const element = this.requireElement(id);
			const isDpad = id.indexOf('d-pad-') === 0;
			const textElement = isDpad ? null : this.optionalElement(`${id}_text`);
			if (!isDpad && !textElement) {
				throw new Error(`[BrowserOnscreenGamepadPlatform] Text element '#${id}_text' was not found.`);
			}
			element.classList.remove('druk');
			element.classList.add('los');
			element.setAttribute('data-touched', 'false');
			if (textElement) {
				textElement.classList.remove('druk');
				textElement.classList.add('los');
				textElement.setAttribute('data-touched', 'false');
			}
		}
	}

	updateDpadRing(activeElementIds: string[]): void {
		const ring = this.requireElement('d-pad-omheining');
		removeDpadClasses(ring);
		for (let i = 0; i < activeElementIds.length; i++) {
			ring.classList.add(activeElementIds[i]);
		}
	}

	supportsVibration(): boolean {
		if (typeof navigator === 'undefined') {
			return false;
		}
		if (typeof navigator.vibrate !== 'function') {
			return false;
		}
		return true;
	}

	vibrate(durationMs: number): void {
		if (!this.supportsVibration()) {
			throw new Error('[BrowserOnscreenGamepadPlatform] Vibration is not supported.');
		}
		navigator.vibrate(durationMs);
	}

	private bindSurfaceEvents(surface: HTMLElement, kind: OnscreenGamepadControlKind, hooks: OnscreenGamepadPlatformHooks, listenerOptions: AddEventListenerOptions): void {
		const pointerDown = (event: PointerEvent) => {
			hooks.pointerDown(kind, makePointerEvent(event, surface));
		};
		const pointerMove = (event: PointerEvent) => {
			hooks.pointerMove(kind, makePointerEvent(event, surface));
		};
		const pointerUp = (event: PointerEvent) => {
			hooks.pointerUp(kind, makePointerEvent(event, surface));
		};
		surface.addEventListener('pointerdown', pointerDown, listenerOptions);
		surface.addEventListener('pointermove', pointerMove, listenerOptions);
		surface.addEventListener('pointerup', pointerUp, listenerOptions);
		surface.addEventListener('pointercancel', pointerUp, listenerOptions);
		surface.addEventListener('lostpointercapture', pointerUp, listenerOptions);
	}

	private querySurface(id: string): HTMLElement {
		const element = this.document.getElementById(id);
		if (!(element instanceof HTMLElement)) {
			throw new Error(`[BrowserOnscreenGamepadPlatform] Element '#${id}' was not found or is not an HTMLElement.`);
		}
		return element;
	}

	private requireElement(id: string): Element {
		const element = this.document.getElementById(id);
		if (!element) {
			throw new Error(`[BrowserOnscreenGamepadPlatform] Element '#${id}' was not found.`);
		}
		return element;
	}

	private optionalElement(id: string): Element | null {
		return this.document.getElementById(id);
	}

	private setTouchActionNone(surface: HTMLElement): void {
		surface.style.touchAction = 'none';
	}
}

export const options: EventListenerOptions & { passive: boolean; once: boolean; } = {
	passive: false,
	once: false,
};

class BrowserGameViewCanvas implements GameViewCanvas {
	public readonly handle: HTMLCanvasElement;

	public constructor(canvas: HTMLCanvasElement) {
		this.handle = canvas;
	}

	public isVisible(): boolean {
		return this.handle.style.visibility !== 'hidden';
	}

	public setRenderTargetSize(width: number, height: number): void {
		this.handle.width = width;
		this.handle.height = height;
	}

	public setDisplaySize(width: number, height: number): void {
		this.handle.style.width = `${width}px`;
		this.handle.style.height = `${height}px`;
	}

	public setDisplayPosition(left: number, top: number): void {
		this.handle.style.left = `${left}px`;
		this.handle.style.top = `${top}px`;
	}

	public measureDisplay(): SurfaceBounds {
		const rect = this.handle.getBoundingClientRect();
		return {
			width: rect.width,
			height: rect.height,
			left: rect.left,
			top: rect.top,
		};
	}
}
class BrowserGamepadControlHandle implements GamepadControlHandle {
	public constructor(public readonly id: string, private readonly element: HTMLElement) { }

	public getNumericAttribute(name: string): number | null {
		const value = this.element.getAttribute(name);
		return value ? parseInt(value, 10) : null;
	}

	public measure(): { width: number; height: number; } {
		const rect = this.element.getBoundingClientRect();
		return { width: rect.width, height: rect.height };
	}

	public setBottom(px: number): void {
		this.element.style.bottom = `${px}px`;
	}

	public setScale(scale: number): void {
		this.element.style.transform = `scale(${scale})`;
	}
}
class BrowserOverlayHandle implements OverlayHandle {
	public constructor(private readonly element: HTMLElement, private readonly dispose: () => void) { }

	public setText(text: string): void {
		this.element.textContent = text;
	}

	public addClass(className: string): void {
		this.element.classList.add(className);
	}

	public removeClass(className: string): void {
		this.element.classList.remove(className);
	}

	public onAnimationEnd(callback: () => void): void {
		const handler = (_event: AnimationEvent) => {
			this.element.removeEventListener('animationend', handler);
			callback();
		};
		this.element.addEventListener('animationend', handler, { once: true });
	}

	public forceReflow(): void {
		void this.element.offsetWidth;
	}

	public remove(): void {
		this.element.remove();
		this.dispose();
	}

	public get native(): HTMLElement {
		return this.element;
	}
}
function toDomOptions(options?: HostEventOptions): boolean | AddEventListenerOptions | undefined {
	if (options === undefined) return undefined;
	if (typeof options === 'boolean') return options;
	return options as AddEventListenerOptions;
}

export class BrowserGameViewHost implements GameViewHost {
	public readonly surface: BrowserGameViewCanvas;
	private readonly overlays = new Map<string, BrowserOverlayHandle>();
	private readonly listenerCache = new WeakMap<HostEventListenerTarget, EventListenerOrEventListenerObject>();

	public constructor(canvas: HTMLCanvasElement) {
		if (!(canvas instanceof HTMLCanvasElement)) {
			throw new Error('[BrowserGameViewHost] Provided canvas element was not an HTMLCanvasElement.');
		}
		this.surface = new BrowserGameViewCanvas(canvas);
	}

	private getDomListener(listener: HostEventListenerTarget): EventListenerOrEventListenerObject {
		let cached = this.listenerCache.get(listener);
		if (cached) {
			return cached;
		}
		if (typeof listener === 'function') {
			const fn: EventListener = (event: Event) => listener(event);
			this.listenerCache.set(listener, fn);
			return fn;
		}
		const obj: EventListenerOrEventListenerObject = {
			handleEvent: (event: Event) => listener.handleEvent(event),
		};
		this.listenerCache.set(listener, obj);
		return obj;
	}

	public getViewportMetrics(): ViewportMetrics {
		const documentElement = document.documentElement;
		const documentDimensions: ViewportDimensions = {
			width: documentElement ? documentElement.clientWidth : 0,
			height: documentElement ? documentElement.clientHeight : 0,
		};
		const windowDimensions: ViewportDimensions = {
			width: typeof window.innerWidth === 'number' ? window.innerWidth : 0,
			height: typeof window.innerHeight === 'number' ? window.innerHeight : 0,
		};
		const screenDimensions: ViewportDimensions = {
			width: typeof window.screen?.width === 'number' ? window.screen.width : 0,
			height: typeof window.screen?.height === 'number' ? window.screen.height : 0,
		};
		return {
			document: documentDimensions,
			windowInner: windowDimensions,
			screen: screenDimensions,
		};
	}

	public getOnscreenGamepadHandles(): OnscreenGamepadHandles | null {
		const dpad = document.querySelector<HTMLElement>('#d-pad-svg');
		const actionButtons = document.querySelector<HTMLElement>('#action-buttons-svg');
		if (!dpad || !actionButtons) {
			return null;
		}
		return {
			dpad: new BrowserGamepadControlHandle('d-pad-svg', dpad),
			actionButtons: new BrowserGamepadControlHandle('action-buttons-svg', actionButtons),
		};
	}

	public ensureOverlay(id: string): OverlayHandle {
		let overlay = this.overlays.get(id);
		if (!overlay) {
			const element = document.createElement('div');
			element.id = id;
			if (!document.body) {
				throw new Error('[BrowserGameViewHost] Document body not available while creating overlay element.');
			}
			document.body.appendChild(element);
			overlay = new BrowserOverlayHandle(element, () => this.overlays.delete(id));
			this.overlays.set(id, overlay);
		}
		return overlay;
	}

	public getOverlay(id: string): OverlayHandle | null {
		return this.overlays.get(id) ?? null;
	}

	public addWindowEventListener(type: HostWindowEventType, listener: HostEventListenerTarget, options?: HostEventOptions): void {
		window.addEventListener(type, this.getDomListener(listener), toDomOptions(options));
	}

	public removeWindowEventListener(type: HostWindowEventType, listener: HostEventListenerTarget, options?: HostEventOptions): void {
		window.removeEventListener(type, this.getDomListener(listener), toDomOptions(options));
	}

	public addDisplayModeChangeListener(listener: (isFullscreen: boolean) => void): void {
		const mediaQuery = window.matchMedia('(display-mode: fullscreen)');
		const handler = (event: MediaQueryListEvent) => {
			listener(event.matches);
		};
		mediaQuery.addEventListener('change', handler);
	}

	public fullscreenAvailable(): boolean {
		return document.fullscreenEnabled ? true : false;
	}

	public get fullscreen(): boolean {
		return document.fullscreenElement === document.documentElement;
	}

	public async setFullscreen(value: boolean): Promise<void> {
		if (value) {
			await document.documentElement.requestFullscreen().catch((e) => { console.warn(`Failed to enter fullscreen mode: ${e}`); });
		} else {
			await document.exitFullscreen().catch((e) => { console.warn(`Failed to exit fullscreen mode: ${e}`); });
		}
	}

	public async createBackend() {
		return createBackend(this);
	}
}
const WEBGPU_RENDERER_SUPPORT = false;

/**
 * Create a GPU backend for the given canvas, preferring WebGPU if available,
 * otherwise falling back to WebGL2. The GameView stays backend-agnostic and
 * only receives the backend interface and the native context for helpers.
 */

export async function createBackend(host: BrowserGameViewHost): Promise<GPUBackend> {
	const canvas = host.surface.handle;
	if (!(canvas instanceof HTMLCanvasElement)) {
		throw new Error('GameView host surface is not a canvas element.');
	}
	// Try WebGPU first
	if (WEBGPU_RENDERER_SUPPORT) {
		try {
			if (!navigator.gpu) {
				throw Error('WebGPU not supported.');
			}

			const adapter = await navigator.gpu.requestAdapter();
			if (!adapter) {
				throw Error('Couldn\'t request WebGPU adapter.');
			}

			const context = (canvas as HTMLCanvasElement).getContext('webgpu') as GPUCanvasContext | null;
			if (context) {
				const adapter: GPUAdapter | null = await navigator.gpu.requestAdapter();
				if (adapter) {
					const device: GPUDevice = await adapter.requestDevice();
					// Configure the canvas context for presentation
					const preferredFormat: GPUTextureFormat = (navigator.gpu.getPreferredCanvasFormat && navigator.gpu.getPreferredCanvasFormat()) || 'bgra8unorm';
					try {
						context.configure({ device, format: preferredFormat, alphaMode: 'premultiplied' });
					} catch (e) {
						console.error('Failed to configure WebGPU canvas context:', e);
						throw e;
					}
					const backend = new WebGPUBackend(device, context);
					return backend;
				}
			}
		} catch (e) {
			console.info(`WebGPU initialization failed: ${e}`);
		}
	}

	// Fallback to WebGL2
	const gl = (canvas as HTMLCanvasElement).getContext('webgl2', { alpha: true, antialias: false }) as WebGL2RenderingContext | null;
	if (!gl) throw new Error('Failed to acquire WebGL2 context, cannot start the game :-(');
	const backend = new WebGLBackend(gl);
	console.info(WEBGPU_RENDERER_SUPPORT ? 'Browser doesn\'t support WebGPU, fallback to WebGL2-backend' : 'Forced using WebGL2-backend as the game engine doesn\'t support WebGPU yet');
	return backend;
}
