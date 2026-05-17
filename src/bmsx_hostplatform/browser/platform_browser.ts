import {
	Clock,
	FrameLoop,
	Lifecycle,
	StorageService,
	ClipboardService,
	ClipboardPermissionState,
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
	PlatformExitEvent,
	PlatformHIDDevice,
	PlatformHIDDeviceRequestOptions,
	ViewportMetrics,
	MicrotaskQueue,
	defaultMicrotaskQueue,
	ViewportMetricsProvider,
	OverlayManager,
	WindowEventHub,
	DisplayModeController,
	OnscreenGamepadHandleProvider,
	GameViewHostCapabilityId,
	GameViewHostCapabilityMap,
	SubscriptionHandle,
	createSubscriptionHandle,
} from 'bmsx/platform';
import { HZ_SCALE } from 'bmsx/machine/runtime/timing/constants';
import { ensureBrowserBackendFactory } from 'bmsx/render/backend/browser_factory';
import { WorkerStreamingAudioService } from './worker_audio';
import type { GamepadControlHandle, GameViewCanvas, GameViewHost, HostEventListenerTarget, HostEventOptions, HostWindowEventType, OnscreenGamepadHandles, OverlayHandle, SurfaceBounds, ViewportDimensions } from '../platform';
import { type vec2 } from 'bmsx/rompack/format';

declare const consoleCore: any; // avoid circular dependency issues
const ONSCREEN_LAYOUT_MODE: 'canvas' | 'gamepad' = 'canvas';

/**
 * Platform wiring for the web-hosted runtime.
 *
 * This implementation maps the console's abstract platform contract to DOM-powered services and
 * provides the onscreen gamepad plumbing that the renderer relies on when the virtual controls are
 * active. Even though the integration lives inside a browser, we deliberately describe capabilities
 * in platform-neutral terms so higher layers can reason about clocks, storage, audio, and layout
 * without caring about underlying APIs.
 */
export class BrowserPlatform implements Platform {
	clock: Clock;
	frames: FrameLoop;
	lifecycle: Lifecycle;
	input: InputHub;
	storage: StorageService;
	ufpsScaled: number;
	requestShutdown(): void {
		const target = window;
		target.close();
		if (!target.closed) {
			throw new Error('[BrowserPlatform] Window refused to close; close the tab manually.');
		}
	}
	clipboard: ClipboardService;
	hid: HIDService;
	onscreenGamepad: OnscreenGamepadPlatform;
	audio: AudioService;
	rng: RngService;
	gameviewHost: BrowserGameViewHost;
	microtasks: MicrotaskQueue;

	constructor(surface: HTMLElement, canvas: HTMLCanvasElement, options: BrowserPlatformOptions) {
		this.clock = new BrowserClock();
		this.frames = new BrowserFrameLoop();
		this.lifecycle = new BrowserLifecycle();
		this.storage = new BrowserStorage();
		this.microtasks = defaultMicrotaskQueue;
		this.ufpsScaled = options.ufpsScaled ?? 0;
		this.clipboard = new BrowserClipboardService(surface);
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
		this.audio = new WorkerStreamingAudioService(options.audioContext);
		if (this.ufpsScaled > 0) {
			this.audio.setFrameTimeSec(HZ_SCALE / this.ufpsScaled);
		}
		this.rng = new BrowserRngService();
		this.gameviewHost = new BrowserGameViewHost(canvas);

		if (!options.debug) {
			// Prevent the user from accidentally closing the game window if not in debug mode
			this.lifecycle.onWillExit((e: PlatformExitEvent) => {
				e.preventDefault();
				e.setReturnMessage('Are you sure you want to exit this awesome game?');
			});
		}
	}
}

export interface BrowserPlatformOptions {
	ufpsScaled?: number;
	audioContext: AudioContext;
	debug: boolean;
}

class BrowserClock implements Clock {
	now(): number {
		return performance.now();
	}

	perf_now(): number {
		return this.now();
	}

	dateNow(): number {
		return Date.now();
	}

	scheduleOnce(delayMs: number, cb: (t: number) => void) {
		let active = true;
		const id = window.setTimeout(() => {
			if (!active) return;
			active = false;
			try { cb(this.now()); } catch (e) { /* swallow errors from callbacks */
				throw e;
				console.warn(`[BrowserClock] Error in scheduled callback: ${e}`);
			}
		}, delayMs);
		return {
			cancel: () => {
				if (!active) return;
				active = false;
				window.clearTimeout(id);
			},
			isActive: () => active,
		};
	}
}

class BrowserFrameLoop implements FrameLoop {
	start(tick: (t: number) => void): { stop(): void } {
		let req = 0;
		let alive = true;
		const loop = (t: number) => {
			if (!alive) return;
			tick(t);
			if (!alive) return;
			// window.dispatchEvent(new Event('frame'));
			req = window.requestAnimationFrame(loop);
		};
		req = window.requestAnimationFrame(loop);
		return {
			stop: () => {
				if (!alive) return;
				alive = false;
				if (req !== 0) {
					window.cancelAnimationFrame(req);
					req = 0;
				}
			},
		};
	}
}

class BrowserLifecycle implements Lifecycle {
	onVisibilityChange(cb: (visible: boolean) => void): SubscriptionHandle {
		const handler = () => {
			cb(!document.hidden);
		};
		document.addEventListener('visibilitychange', handler, { passive: true });
		return createSubscriptionHandle(() => {
			document.removeEventListener('visibilitychange', handler);
		});
	}

	onWillExit(cb: (event: PlatformExitEvent) => void): SubscriptionHandle {
		const toExitEvent = (domEvent: BeforeUnloadEvent): PlatformExitEvent => ({
			preventDefault: () => domEvent.preventDefault(),
			setReturnMessage: (message: string) => { domEvent.returnValue = message; },
		});
		const beforeUnload = (event: BeforeUnloadEvent) => {
			cb(toExitEvent(event));
		};
		const pageHide = () => {
			const synthetic: PlatformExitEvent = {
				preventDefault: () => { },
				setReturnMessage: () => { },
			};
			cb(synthetic);
		};
		window.addEventListener('beforeunload', beforeUnload);
		window.addEventListener('pagehide', pageHide);
		return createSubscriptionHandle(() => {
			window.removeEventListener('beforeunload', beforeUnload);
			window.removeEventListener('pagehide', pageHide);
		});
	}
}

class BrowserStorage implements StorageService {
	getItem(k: string): string {
		return window.localStorage.getItem(k);
	}

	setItem(k: string, v: string): void {
		window.localStorage.setItem(k, v);
	}

	removeItem(k: string): void {
		window.localStorage.removeItem(k);
	}
}

type ClipboardPermissionName = 'clipboard-write';

// type ClipboardAvailability = 'unknown' | 'allowed' | 'blocked';
const enum ClipboardAvailability {
	Unknown = 0,
	Allowed = 1,
	Blocked = 2,
}

class BrowserClipboardService implements ClipboardService {
	private writeStatus: ClipboardAvailability = ClipboardAvailability.Unknown;
	private clipboardBlocked = false;
	private lastClipboardBlockCheckMs = 0;
	private readonly clipboardDetectionIntervalMs = 1000;

	constructor(_focusTarget?: HTMLElement) { }

	isSupported(): boolean {
		return this.systemClipboard() !== null;
	}

	async writeText(text: string): Promise<void> {
		const now = performance.now();
		if (this.clipboardBlocked && (now - this.lastClipboardBlockCheckMs) < this.clipboardDetectionIntervalMs) {
			throw new Error('[BrowserClipboardService] Clipboard write was blocked by the browser.');
		}
		const clipboard = this.systemClipboard();
		if (!clipboard || typeof clipboard.writeText !== 'function') {
			this.writeStatus = ClipboardAvailability.Blocked;
			throw new Error('[BrowserClipboardService] Clipboard write is unavailable in this context.');
		}
		try {
			await clipboard.writeText(text);
			this.writeStatus = ClipboardAvailability.Allowed;
			this.clipboardBlocked = false;
			this.lastClipboardBlockCheckMs = now;
		}
		catch (error) {
			this.writeStatus = ClipboardAvailability.Blocked;
			if (this.detectClipboardBlock(error)) {
				throw new Error('[BrowserClipboardService] Clipboard write was blocked by the browser.');
			}
			if (error instanceof Error) {
				throw error;
			}
			throw new Error(String(error));
		}
	}

	getWritePermissionState(): ClipboardPermissionState {
		return this.toPermissionState(this.writeStatus);
	}

	async requestWritePermission(): Promise<ClipboardPermissionState> {
		const permission = await this.queryPermission('clipboard-write');
		this.writeStatus = this.fromPermissionState(permission, this.writeStatus);
		if (this.writeStatus !== ClipboardAvailability.Blocked) {
			this.clipboardBlocked = false;
		}
		return this.toPermissionState(this.writeStatus);
	}

	private systemClipboard(): Clipboard {
		return navigator.clipboard;
	}

	private async queryPermission(name: ClipboardPermissionName): Promise<ClipboardPermissionState> {
		const permissions = (navigator as Navigator & { permissions?: Permissions }).permissions;
		try {
			const status = await permissions.query({ name: name as PermissionName });
			if (status.state === 'granted') {
				return ClipboardPermissionState.Granted;
			}
			if (status.state === 'denied') {
				return ClipboardPermissionState.Denied;
			}
			return ClipboardPermissionState.Prompt;
		}
		catch (error) {
			if (this.detectClipboardBlock(error)) {
				return ClipboardPermissionState.Denied;
			}
			return ClipboardPermissionState.Unknown;
		}
	}

	private detectClipboardBlock(error: unknown): boolean {
		const now = performance.now();
		if ((now - this.lastClipboardBlockCheckMs) < this.clipboardDetectionIntervalMs) {
			return this.clipboardBlocked;
		}
		this.lastClipboardBlockCheckMs = now;
		const name = this.resolveErrorName(error);
		if (name) {
			const loweredName = name.toLowerCase();
			if (this.isClipboardBlockedIndicator(loweredName)) {
				this.clipboardBlocked = true;
				return true;
			}
		}
		const message = this.resolveErrorMessage(error);
		if (message) {
			const loweredMessage = message.toLowerCase();
			if (this.isClipboardBlockedIndicator(loweredMessage)) {
				this.clipboardBlocked = true;
				return true;
			}
		}
		this.clipboardBlocked = false;
		return false;
	}

	private resolveErrorName(error: unknown): string {
		if (!error) {
			return null;
		}
		if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
			return error.name;
		}
		if (typeof error === 'object') {
			const candidate = (error as { name?: unknown }).name;
			if (typeof candidate === 'string' && candidate.length > 0) {
				return candidate;
			}
		}
		return null;
	}

	private resolveErrorMessage(error: unknown): string {
		if (!error) {
			return null;
		}
		if (error instanceof Error) {
			return error.message;
		}
		if (typeof error === 'string' && error.length > 0) {
			return error;
		}
		return null;
	}

	private isClipboardBlockedIndicator(value: string): boolean {
		if (value.indexOf('notallowed') !== -1) {
			return true;
		}
		if (value.indexOf('not allowed') !== -1) {
			return true;
		}
		if (value.indexOf('security') !== -1) {
			return true;
		}
		if (value.indexOf('denied') !== -1) {
			return true;
		}
		if (value.indexOf('permission') !== -1) {
			return true;
		}
		return false;
	}

	private toPermissionState(status: ClipboardAvailability): ClipboardPermissionState {
		if (status === ClipboardAvailability.Allowed) {
			return ClipboardPermissionState.Granted;
		}
		if (status === ClipboardAvailability.Blocked) {
			return ClipboardPermissionState.Denied;
		}
		return ClipboardPermissionState.Unknown;
	}

	private fromPermissionState(state: ClipboardPermissionState, current: ClipboardAvailability): ClipboardAvailability {
		if (state === ClipboardPermissionState.Granted) {
			return ClipboardAvailability.Allowed;
		}
		if (state === ClipboardPermissionState.Denied) {
			return ClipboardAvailability.Blocked;
		}
		return current === ClipboardAvailability.Allowed ? ClipboardAvailability.Allowed : ClipboardAvailability.Unknown;
	}
}

class UnsupportedHID implements HIDService {
	isSupported(): boolean {
		return false;
	}

	async requestDevice(_options: PlatformHIDDeviceRequestOptions): Promise<PlatformHIDDevice[]> {
		throw new Error('WebHID not supported');
	}

	async getDevices(): Promise<PlatformHIDDevice[]> {
		return [];
	}
}

class WebHID implements HIDService {
	isSupported(): boolean {
		return 'hid' in navigator && navigator.hid !== undefined && navigator.hid !== null;
	}

	async requestDevice(options: PlatformHIDDeviceRequestOptions): Promise<PlatformHIDDevice[]> {
		const devices = await navigator.hid.requestDevice(options as HIDDeviceRequestOptions);
		return devices as PlatformHIDDevice[];
	}

	async getDevices(): Promise<PlatformHIDDevice[]> {
		const devices = await navigator.hid.getDevices();
		return devices as PlatformHIDDevice[];
	}
}

class BrowserRngService implements RngService {
	private state: number;

	constructor(seed?: number) {
		this.state = this.normalizeSeed(seed ?? performance.now());
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
	private lastTimestamp: number = null;
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
	private keyboardCapture: ((code: string) => boolean) = null;
	private nextPressId = 1;
	private readonly activeKeyPressIds = new Map<string, number>();
	private readonly activePointerPressIds = new Map<string, number>();

	constructor(surface: HTMLElement, clock: Clock) {
		this.clock = clock;

		const keyboard = new KeyboardDevice();
		const pointer = new PointerDevice();
		this.devicesList.push(keyboard);
		this.devicesList.push(pointer);

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

	subscribe(fn: (e: InputEvt) => void): SubscriptionHandle {
		this.subs.add(fn);
		return createSubscriptionHandle(() => {
			this.subs.delete(fn);
		});
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
		const captured = this.keyboardCapture && this.keyboardCapture(event.code);
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
		this.post({ type: 'button', deviceId: 'keyboard:0', code: event.code, down: true, value: 1, timestamp: now, pressId });
	};

	private onKeyUp = (event: KeyboardEvent) => {
		const captured = this.keyboardCapture && this.keyboardCapture(event.code);
		if (captured || this.shouldBlockBrowserShortcut(event)) {
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			event.returnValue = false;
		}
		const now = this.clock.now();
		let pressId = this.activeKeyPressIds.get(event.code);
		if (!pressId) {
			pressId = this.nextPressId++;
		}
		this.activeKeyPressIds.delete(event.code);
		this.post({ type: 'button', deviceId: 'keyboard:0', code: event.code, down: false, value: 0, timestamp: now, pressId });
	};

	private onWindowFocusChange = () => {
		this.activeKeyPressIds.clear();
		this.activePointerPressIds.clear();
	};

	private onPointerDown = (event: PointerEvent) => {
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		const target = event.target as Element;
		if (target?.setPointerCapture) {
			try { target.setPointerCapture(event.pointerId); } catch { /* ignore */ }
		}
		const now = this.clock.now();
		const modifiers = modifiersFrom(event);
		const pointerKey = `${event.pointerId}:${pointerButton(event.button)}`;
		let pressId = this.activePointerPressIds.get(pointerKey);
		if (!pressId) {
			pressId = this.nextPressId++;
			this.activePointerPressIds.set(pointerKey, pressId);
		}
		this.post({ type: 'button', deviceId: 'pointer:0', code: pointerButton(event.button), down: true, value: 1, timestamp: now, pressId, modifiers });
		this.post({ type: 'axis2', deviceId: 'pointer:0', code: 'pointer_position', x: event.clientX, y: event.clientY, timestamp: now, modifiers });
	};

	private onPointerUp = (event: PointerEvent) => {
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		const target = event.target as Element;
		if (target && target.hasPointerCapture?.(event.pointerId)) {
			try { target.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
		}
		const now = this.clock.now();
		const modifiers = modifiersFrom(event);
		const pointerKey = `${event.pointerId}:${pointerButton(event.button)}`;
		let pressId = this.activePointerPressIds.get(pointerKey);
		if (!pressId) {
			pressId = this.nextPressId++;
		}
		this.activePointerPressIds.delete(pointerKey);
		this.post({ type: 'button', deviceId: 'pointer:0', code: pointerButton(event.button), down: false, value: 0, timestamp: now, pressId, modifiers });
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
		const target = event.target as Element;
		if (target && target.hasPointerCapture?.(event.pointerId)) {
			try { target.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
		}
		const now = this.clock.now();
		const modifiers = modifiersFrom(event);
		const pointerKey = `${event.pointerId}:${pointerButton(event.button)}`;
		let pressId = this.activePointerPressIds.get(pointerKey);
		if (!pressId) {
			pressId = this.nextPressId++;
		}
		this.activePointerPressIds.delete(pointerKey);
		this.post({ type: 'button', deviceId: 'pointer:0', code: pointerButton(event.button), down: false, value: 0, timestamp: now, pressId, modifiers });
		this.post({ type: 'axis2', deviceId: 'pointer:0', code: 'pointer_position', x: event.clientX, y: event.clientY, timestamp: now, modifiers });
	};

	private onPointerLeave = (event: PointerEvent) => {
		const now = this.clock.now();
		const modifiers = modifiersFrom(event);
		this.post({ type: 'axis2', deviceId: 'pointer:0', code: 'pointer_position', x: event.clientX, y: event.clientY, timestamp: now, modifiers });
	};

	private scanInitialGamepads(): void {
		const pads = navigator.getGamepads();
		const now = this.clock.now();
		for (let i = 0; i < pads.length; i++) {
			const gp = pads[i];
			if (!gp) continue;
			const id = 'gamepad:' + gp.index;
			if (this.devicesList.some(device => device.id === id)) continue;
			const device = new GamepadDevice(gp, this.post.bind(this));
			this.devicesList.push(device);
			this.post({ type: 'connect', device, timestamp: now });
		}
	}

	private onGamepadConnected = (event: GamepadEvent) => {
		const source = event.gamepad;
		const id = 'gamepad:' + source.index;
		if (this.devicesList.some(device => device.id === id)) return;
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

/**
 * Web-backed implementation of the onscreen gamepad platform.
 *
 * The engine treats this class as the authoritative bridge between gameplay code and whichever DOM
 * nodes represent the virtual controls. It is responsible for normalising pointer input, preserving
 * the canonical element identifiers, and ensuring the controls can be measured/scaled so the GameView
 * can negotiate space for them. When the onscreen gamepad is visible, every layout calculation in the
 * renderer assumes these handles are present and responsive.
 */
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
		this.configureSurfaceBehaviour(dpadSurface);
		this.configureSurfaceBehaviour(actionSurface);
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
			const textElement = this.optionalElement(`${id}_text`);
			if (textElement) {
				textElement.classList.add('hidden');
				textElement.setAttribute('hidden', 'true');
			}
		}
	}

	collectElementIds(x: number, y: number, _kind: OnscreenGamepadControlKind): string[] {
		const elements = this.document.elementsFromPoint(x, y);
		const ids: string[] = [];
		for (let i = 0; i < elements.length; i++) {
			const elementId = elements[i].id;
			if (elementId && elementId.length > 0) {
				if (elementId === 'd-pad-controls' || elementId === 'button-controls') {
					continue;
				}
				ids.push(elementId);
			}
		}
		return ids;
	}

	setElementActive(elementId: string, active: boolean): void {
		const element = this.requireElement(elementId);
		if (element instanceof HTMLElement) {
			element.hidden = false;
		}
		element.removeAttribute('hidden');
		const container = this.findContainerForElement(elementId);
		if (container) {
			container.hidden = false;
			container.setAttribute('aria-hidden', 'false');
			container.classList.remove('hidden');
			container.removeAttribute('hidden');
		}
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
			if (element instanceof HTMLElement) {
				element.hidden = false;
			}
			const container = this.findContainerForElement(id);
			if (container) {
				container.hidden = false;
				container.setAttribute('aria-hidden', 'false');
				container.classList.remove('hidden');
				container.removeAttribute('hidden');
			}
			const isDpad = id.indexOf('d-pad-') === 0;
			const textElement = isDpad ? null : this.optionalElement(`${id}_text`);
			if (!isDpad && !textElement) {
				throw new Error(`[BrowserOnscreenGamepadPlatform] Text element '#${id}_text' was not found.`);
			}
			element.classList.remove('druk');
			element.classList.add('los');
			element.classList.remove('hidden');
			element.removeAttribute('hidden');
			element.setAttribute('data-touched', 'false');
			if (textElement) {
				textElement.classList.remove('druk');
				textElement.classList.add('los');
				textElement.classList.remove('hidden');
				textElement.removeAttribute('hidden');
				textElement.setAttribute('data-touched', 'false');
			}
		}
	}

	private findContainerForElement(elementId: string): HTMLElement {
		if (elementId === 'd-pad-controls' || elementId.indexOf('d-pad-') === 0) {
			const target = this.document.getElementById('d-pad-controls');
			return target instanceof HTMLElement ? target : null;
		}
		if (elementId === 'button-controls' || elementId.indexOf('_knop') !== -1) {
			const target = this.document.getElementById('button-controls');
			return target instanceof HTMLElement ? target : null;
		}
		return null;
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
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			hooks.pointerDown(kind, makePointerEvent(event, surface));
		};
		const pointerMove = (event: PointerEvent) => {
			if (event.buttons !== 0 || event.pressure !== 0) {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
			}
			hooks.pointerMove(kind, makePointerEvent(event, surface));
		};
		const pointerUp = (event: PointerEvent) => {
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
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

	private optionalElement(id: string): Element {
		return this.document.getElementById(id);
	}

	private configureSurfaceBehaviour(surface: HTMLElement): void {
		surface.style.touchAction = 'none';
		surface.style.pointerEvents = 'auto';
		surface.style.userSelect = 'none';
		surface.style.setProperty('-webkit-touch-callout', 'none');
		surface.style.setProperty('-webkit-tap-highlight-color', 'transparent');
		surface.style.setProperty('-ms-touch-action', 'none');
		surface.setAttribute('aria-hidden', 'false');
		surface.removeAttribute('hidden');
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
		let value = this.element.getAttribute(name);
		if (!value) {
			value = this.element.getAttribute(`data-${name}`);
		}
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
function toDomOptions(options?: HostEventOptions): boolean | AddEventListenerOptions {
	if (options === undefined) return undefined;
	if (typeof options === 'boolean') return options;
	return options as AddEventListenerOptions;
}

/**
 * GameViewHost bound to DOM primitives.
 *
 * Besides exposing the canvas handle, this bridge packages up auxiliary capabilities such as viewport
 * metrics, overlay management, window events, display mode toggles, and onscreen gamepad handles.
 * The GameView never queries the DOM directly; it relies on this host to supply consistent, platform-
 * agnostic data about sizing and interactivity. That is especially important for the onscreen gamepad,
 * whose handles are surfaced here so the renderer can scale and reposition them alongside the canvas.
 */
export class BrowserGameViewHost implements GameViewHost {
	private static visualViewportForwardingInstalled = false;
	private static viewportForwardingRafId: number = null;
	private static dispatchViewportChange(): void {
		window.dispatchEvent(new Event('resize'));
		window.dispatchEvent(new Event('orientationchange'));
	}
	private static forwardViewportChange(): void {
		BrowserGameViewHost.dispatchViewportChange();
		if (BrowserGameViewHost.viewportForwardingRafId === null) {
			BrowserGameViewHost.viewportForwardingRafId = window.requestAnimationFrame(() => {
				BrowserGameViewHost.viewportForwardingRafId = null;
				BrowserGameViewHost.dispatchViewportChange();
			});
		}
	}
	public readonly surface: BrowserGameViewCanvas;
	private readonly overlays = new Map<string, BrowserOverlayHandle>();
	private readonly listenerCache = new WeakMap<HostEventListenerTarget, EventListenerOrEventListenerObject>();
	private readonly viewportCapability: ViewportMetricsProvider;
	private readonly overlayCapability: OverlayManager;
	private readonly windowEventsCapability: WindowEventHub;
	private readonly displayModeCapability: DisplayModeController;
	private readonly gamepadHandlesCapability: OnscreenGamepadHandleProvider;

	public constructor(canvas: HTMLCanvasElement) {
		if (!(canvas instanceof HTMLCanvasElement)) {
			throw new Error('[BrowserGameViewHost] Provided canvas element was not an HTMLCanvasElement.');
		}
		this.surface = new BrowserGameViewCanvas(canvas);
		if (!BrowserGameViewHost.visualViewportForwardingInstalled) {
			const visualViewport = window.visualViewport!;
			const handler = BrowserGameViewHost.forwardViewportChange;
			visualViewport.addEventListener('resize', handler);
			visualViewport.addEventListener('scroll', handler);
			visualViewport.addEventListener('geometrychange', handler as EventListener);
			BrowserGameViewHost.visualViewportForwardingInstalled = true;
		}
		this.viewportCapability = {
			getViewportMetrics: () => this.computeViewportMetrics(),
		};
		this.overlayCapability = {
			ensureOverlay: (id: string) => this.ensureOverlayInternal(id),
			getOverlay: (id: string) => this.getOverlayInternal(id),
		};
		this.windowEventsCapability = {
			subscribe: (type: HostWindowEventType, listener: HostEventListenerTarget, options?: HostEventOptions): SubscriptionHandle => {
				const domListener = this.getDomListener(listener);
				const domOptions = toDomOptions(options);
				window.addEventListener(type, domListener, domOptions);
				return createSubscriptionHandle(() => window.removeEventListener(type, domListener, domOptions));
			},
		};
		this.displayModeCapability = {
			isSupported: () => document.fullscreenEnabled ? true : false,
			isFullscreen: () => document.fullscreenElement === document.documentElement,
			setFullscreen: async (enabled: boolean) => {
				if (enabled) {
					await document.documentElement.requestFullscreen().catch((e) => { console.warn(`Failed to enter fullscreen mode: ${e}`); });
				} else if (document.fullscreenElement) {
					await document.exitFullscreen().catch((e) => { console.warn(`Failed to exit fullscreen mode: ${e}`); });
				}
			},
			onChange: (listener: (isFullscreen: boolean) => void): SubscriptionHandle => {
				const handler = () => listener(document.fullscreenElement === document.documentElement);
				document.addEventListener('fullscreenchange', handler);
				return createSubscriptionHandle(() => document.removeEventListener('fullscreenchange', handler));
			},
		};
		this.gamepadHandlesCapability = {
			getHandles: () => this.resolveOnscreenGamepadHandles(),
		};
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

	private computeViewportMetrics(): ViewportMetrics {
		const documentElement = document.documentElement!;
		const documentDimensions = {
			width: documentElement.clientWidth,
			height: documentElement.clientHeight,
		} as any;
		const windowDimensions = {
			width: window.innerWidth,
			height: window.innerHeight,
		} as any;
		const screenDimensions = {
			width: window.screen.width,
			height: window.screen.height,
		} as any;
		const visual = window.visualViewport!;
		const visible = {
			width: visual.width,
			height: visual.height,
			offsetTop: visual.offsetTop,
			offsetLeft: visual.offsetLeft,
		};
		return {
			document: documentDimensions,
			windowInner: windowDimensions,
			screen: screenDimensions,
			visible,
		};
	}

	private resolveOnscreenGamepadHandles(): OnscreenGamepadHandles {
		const dpad = document.querySelector<HTMLElement>('#d-pad-controls');
		const actionButtons = document.querySelector<HTMLElement>('#button-controls');
		if (!dpad || !actionButtons) {
			return null;
		}
		return {
			dpad: new BrowserGamepadControlHandle('d-pad-svg', dpad),
			actionButtons: new BrowserGamepadControlHandle('action-buttons-svg', actionButtons),
		};
	}

	private ensureOverlayInternal(id: string): OverlayHandle {
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

	private getOverlayInternal(id: string): OverlayHandle {
		return this.overlays.get(id);
	}

	public getCapability<T extends GameViewHostCapabilityId>(capability: T): GameViewHostCapabilityMap[T] {
		switch (capability) {
			case 'viewport-metrics':
				return this.viewportCapability as GameViewHostCapabilityMap[T];
			case 'overlay':
				return this.overlayCapability as GameViewHostCapabilityMap[T];
			case 'window-events':
				return this.windowEventsCapability as GameViewHostCapabilityMap[T];
			case 'display-mode':
				return this.displayModeCapability as GameViewHostCapabilityMap[T];
			case 'onscreen-gamepad':
				return this.gamepadHandlesCapability as GameViewHostCapabilityMap[T];
			default:
				return null;
		}
	}

	private lastViewportSize: vec2 = { x: 256, y: 212 };
	private lastCanvasSize: vec2 = { x: 512, y: 424 };

	/**
	 * Comprehensive viewport sizing routine.
	 *
	 * This method gathers every dimension the host environment exposes (document, inner, screen, or any
	 * custom source supplied by the active platform)
	 * and derives two related concepts:
	 *  - `windowSize`/`availableWindowSize`: how much real estate we believe we can inhabit,
	 *    factoring in host shells that report a zero `innerWidth`/`innerHeight` while
	 *    an onscreen keyboard is sliding in (observed on several mobile web views).
	 *  - `viewportScale` and `canvasScale`: the ratio between that real estate and the
	 *    logical render sizes (`viewportSize` for gameplay, `canvasSize` for the backing buffer).
	 *    Ensure scale is a half-integer multiple of the logical viewport
	 *    (`viewportSize * viewportScale`) to reduce subpixel jitter when scaling non-integer factors.
	 *    We centre the resulting surface within the **largest** container reported by either
	 *
	 * Historical context / pitfalls:
	 *  - When the onscreen gamepad is enabled it becomes a first-class surface sharing the same
	 *    presentation field as the main canvas. Ignoring its footprint leads to either the game
	 *    canvas shrinking unpredictably or the controls falling off-screen. Every calculation in
	 *    this method treats those controls as essential viewports, not optional chrome.
	 *  - Prior to the onscreen-gamepad refactors we assumed the canvas could always consume
	 *    the full width of the container. Once the onscreen controls started participating
	 *    in normal flow (instead of being absolutely positioned), the gamepad effectively started
	 *    negotiating for horizontal space with the canvas. The layout simulator in
	 *    `tests/simulate_gamepad_positions_for_codex.js` captures how that shift collapses
	 *    available width if we do not pre-allocate "Lebensraum" for the gamepad.
	 *  - Fixed clamping to 20% of the larger screen dimension keeps the control overlays legible on
	 *    phones yet avoids dwarfing the canvas on tablets/desktops.
	 *  - We deliberately avoid defensive null checks here: the platform layer guarantees that
	 *    viewport metrics exist and that `OnscreenGamepadHandleProvider` returns handles while
	 *    the onscreen gamepad is enabled.
	 *
	 * The landscape branch further subtracts the horizontal footprint of both control clusters when
	 * the canvas is configured to "own" the shared space (`canvas_or_onscreen_gamepad_must_respect_lebensraum === 'canvas'`).
	 * That mirrors how the static-flow layout squeezes the canvas; without this subtraction, the canvas
	 * scale would be computed optimistically and the host flow would shove the controls off-screen.
	 *
	 * After all of the above, we convert to integers (via `~~`) to stabilise pixel snapping.
	 * This method calls `performLayout` internally to ensure the host surface is synchronized
	 * with the new dimensions before returning.
	 */
	public getSize(viewportSize: vec2, canvasSize: vec2): ViewportDimensions {
		this.lastViewportSize = viewportSize;
		this.lastCanvasSize = canvasSize;
		const metrics = this.computeViewportMetrics();
		const documentWidth = metrics.document.width;
		const documentHeight = metrics.document.height;
		const innerWidth = metrics.windowInner.width;
		const innerHeight = metrics.windowInner.height;
		const screenWidth = metrics.screen.width;
		const screenHeight = metrics.screen.height;

		const fallbackWidth = innerWidth > 0 ? innerWidth : screenWidth;
		const fallbackHeight = innerHeight > 0 ? innerHeight : screenHeight;
		let effectiveWidth = documentWidth;
		let effectiveHeight = documentHeight;
		if (fallbackWidth > effectiveWidth) {
			effectiveWidth = fallbackWidth;
		}
		if (fallbackHeight > effectiveHeight) {
			effectiveHeight = fallbackHeight;
		}

		const viewportWidth = innerWidth > 0 ? innerWidth : screenWidth;
		const viewportHeight = innerHeight > 0 ? innerHeight : screenHeight;
		const viewportIsLandscape = viewportWidth > viewportHeight && viewportWidth !== 0 && viewportHeight !== 0;

		let adjustedWidth = effectiveWidth;
		const onscreenGamepadEnabled = consoleCore.input?.isOnscreenGamepadEnabled;
		if (onscreenGamepadEnabled
			&& ONSCREEN_LAYOUT_MODE === 'canvas'
			&& viewportIsLandscape) {
			const handles = this.resolveOnscreenGamepadHandles();
			if (handles) {
				const referenceDimension = viewportWidth > viewportHeight ? viewportWidth : viewportHeight;
				const maxControlScale = referenceDimension * 0.20 / 100;
				const dpadWidthAttr = handles.dpad.getNumericAttribute('width');
				const actionButtonsWidthAttr = handles.actionButtons.getNumericAttribute('width');
				if (dpadWidthAttr !== null && actionButtonsWidthAttr !== null) {
					const dpadWidth = dpadWidthAttr * maxControlScale;
					const actionButtonsWidth = actionButtonsWidthAttr * maxControlScale;
					const reduction = dpadWidth + actionButtonsWidth;
					adjustedWidth = Math.max(0, adjustedWidth - reduction);
				}
			}
		}

		const dx = adjustedWidth / viewportSize.x;
		const dy = effectiveHeight / viewportSize.y;
		const viewportScale = Math.floor(Math.min(dx, dy) * 2) / 2;

		const targetWidth = viewportSize.x * viewportScale;
		const targetHeight = viewportSize.y * viewportScale;
		const canvasScale = Math.min(targetWidth / canvasSize.x, targetHeight / canvasSize.y);

		const dims: ViewportDimensions = {
			width: adjustedWidth,
			height: effectiveHeight,
			viewportScale,
			canvasScale,
		};
		this.performLayout(dims);
		return dims;
	}

	public onResize(handler: (size: ViewportDimensions) => void): SubscriptionHandle {
		const listener = () => {
			const size = this.getSize(this.lastViewportSize, this.lastCanvasSize);
			handler(size);
		};
		window.addEventListener('resize', listener);
		window.addEventListener('orientationchange', listener);
		return createSubscriptionHandle(() => {
			window.removeEventListener('resize', listener);
			window.removeEventListener('orientationchange', listener);
		});
	}

	private performLayout(size: ViewportDimensions): void {
		const metrics = this.computeViewportMetrics();
		const viewportWidth = metrics.windowInner.width > 0 ? metrics.windowInner.width : metrics.screen.width;
		const viewportHeight = metrics.windowInner.height > 0 ? metrics.windowInner.height : metrics.screen.height;
		const visibleViewportHeight = metrics.visible.height;
		const visibleViewportBottom = metrics.visible.offsetTop + visibleViewportHeight;
		const viewportBottomInset = Math.max(0, viewportHeight - visibleViewportBottom);

		const displayWidth = Math.round(this.lastViewportSize.x * size.viewportScale);
		const displayHeight = Math.round(this.lastViewportSize.y * size.viewportScale);

		const horizontalContainer = Math.max(viewportWidth, size.width, displayWidth);
		const verticalContainer = Math.max(viewportHeight, size.height, displayHeight);
		let displayLeft = ~~((horizontalContainer - displayWidth) / 2);
		if (displayLeft < 0) displayLeft = 0;

		const isLandscape = size.width >= size.height;
		const onscreenGamepadEnabled = consoleCore.input?.isOnscreenGamepadEnabled;
		let displayTop = isLandscape || !onscreenGamepadEnabled
			? ~~((verticalContainer - displayHeight) / 2)
			: 0;
		if (displayTop < 0) displayTop = 0;

		this.surface.setDisplaySize(displayWidth, displayHeight);
		this.surface.setDisplayPosition(displayLeft, displayTop);

		if (onscreenGamepadEnabled) {
			const handles = this.resolveOnscreenGamepadHandles();
			if (handles) {
				const { dpad, actionButtons } = handles;
				const referenceDimension = viewportWidth > viewportHeight ? viewportWidth : viewportHeight;
				const bottomInset = viewportBottomInset;
				const canvasRect = this.surface.measureDisplay();

				const updateScale = (control: typeof dpad, isRightSide: boolean): void => {
					let newScale = referenceDimension * 0.20 / 100;
					if (isLandscape && ONSCREEN_LAYOUT_MODE === 'gamepad') {
						let maxControlWidth: number;
						if (isRightSide) {
							maxControlWidth = viewportWidth - (canvasRect.left + canvasRect.width);
						} else {
							maxControlWidth = canvasRect.left;
						}
						if (maxControlWidth < 0) maxControlWidth = 0;
						const widthAttr = control.getNumericAttribute('width');
						if (widthAttr !== null && widthAttr > 0 && widthAttr * newScale > maxControlWidth) {
							newScale = maxControlWidth / widthAttr;
						}
					}
					const heightAttr = control.getNumericAttribute('height');
					if (heightAttr !== null && heightAttr > 0 && visibleViewportHeight > 0) {
						const maxScaleByHeight = visibleViewportHeight / heightAttr;
						if (maxScaleByHeight > 0 && newScale > maxScaleByHeight) {
							newScale = maxScaleByHeight;
						}
					}
					control.setScale(newScale);
				};

				updateScale(dpad, false);
				updateScale(actionButtons, true);
				const dpadSize = dpad.measure();
				const actionSize = actionButtons.measure();
				const centeredSpan = visibleViewportHeight;
				const clampBottom = (value: number): number => value > 0 ? Math.round(value) : 0;
				const updateBottomPosition = (control: typeof dpad, size: { height: number; }, isRightSide: boolean): void => {
					let newBottom: number;
					if (isLandscape) {
						const verticalRoom = Math.max(centeredSpan - size.height, 0);
						newBottom = bottomInset + verticalRoom / 2;
					} else if (isRightSide) {
						newBottom = bottomInset;
					} else {
						const referenceHeight = Math.max(actionSize.height, size.height);
						const verticalRoom = Math.max(referenceHeight - size.height, 0);
						newBottom = bottomInset + verticalRoom / 2;
					}
					control.setBottom(clampBottom(newBottom));
				};
				updateBottomPosition(dpad, dpadSize, false);
				updateBottomPosition(actionButtons, actionSize, true);
			}
		}
	}

	public onFocusChange(handler: (focused: boolean) => void): SubscriptionHandle {
		const focusListener = () => handler(true);
		const blurListener = () => handler(false);
		window.addEventListener('focus', focusListener);
		window.addEventListener('blur', blurListener);
		return createSubscriptionHandle(() => {
			window.removeEventListener('focus', focusListener);
			window.removeEventListener('blur', blurListener);
		});
	}

	public async createBackend() {
		return createBackend(this);
	}
}
const backendFactoryKey = '__bmsxCreateBackend';

type BackendFactory = (host: BrowserGameViewHost) => Promise<unknown>;
interface BackendFactoryHolder {
	__bmsxCreateBackend?: BackendFactory;
}

function resolveBackendFactory(): BackendFactory {
	const holder = globalThis as BackendFactoryHolder;
	const factory = holder[backendFactoryKey];
	if (typeof factory !== 'function') {
		throw new Error('[BrowserPlatform] GPU backend factory not installed. Make sure the engine registers one before requesting it.');
	}
	return factory;
}

export async function createBackend(host: BrowserGameViewHost): Promise<unknown> {
	ensureBrowserBackendFactory();
	const factory = resolveBackendFactory();
	return factory(host);
}
