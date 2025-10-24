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
	ViewportMetricsProvider,
	OverlayManager,
	WindowEventHub,
	DisplayModeController,
	OnscreenGamepadHandleProvider,
	GameViewHostCapabilityId,
	GameViewHostCapabilityMap,
} from '../platform';
import { WebAudioService } from './web_audio';
import type { GamepadControlHandle, GameViewCanvas, GameViewHost, HostEventListenerTarget, HostEventOptions, HostWindowEventType, OnscreenGamepadHandles, OverlayHandle, SurfaceBounds, ViewportDimensions } from '../platform';

export class BrowserPlatform implements Platform {
	clock: Clock;
	frames: FrameLoop;
	lifecycle: Lifecycle;
	input: InputHub;
	storage: StorageService;
	clipboard: ClipboardService;
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

	onWillExit(cb: (event: PlatformExitEvent) => void): () => void {
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

type ClipboardPermissionName = 'clipboard-write';

type ClipboardAvailability = 'unknown' | 'allowed' | 'blocked';

class BrowserClipboardService implements ClipboardService {
	private writeStatus: ClipboardAvailability = 'unknown';

	constructor(_focusTarget?: HTMLElement) { }

	isSupported(): boolean {
		return this.systemClipboard() !== null;
	}

	async writeText(text: string): Promise<void> {
		const clipboard = this.systemClipboard();
		if (!clipboard || typeof clipboard.writeText !== 'function') {
			this.writeStatus = 'blocked';
			throw new Error('[BrowserClipboardService] Clipboard write is unavailable in this context.');
		}
		try {
			await clipboard.writeText(text);
			this.writeStatus = 'allowed';
		}
		catch (error) {
			this.writeStatus = 'blocked';
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
		return this.toPermissionState(this.writeStatus);
	}

	private systemClipboard(): Clipboard | null {
		if (typeof navigator === 'undefined' || !navigator.clipboard) {
			return null;
		}
		if (typeof window !== 'undefined' && window.isSecureContext !== true) {
			return null;
		}
		return navigator.clipboard;
	}

	private async queryPermission(name: ClipboardPermissionName): Promise<ClipboardPermissionState> {
		if (typeof navigator === 'undefined') {
			return 'unknown';
		}
		const permissions = (navigator as Navigator & { permissions?: Permissions }).permissions;
		if (!permissions || typeof permissions.query !== 'function') {
			return 'unknown';
		}
		try {
			const status = await permissions.query({ name: name as PermissionName });
			if (status.state === 'granted') {
				return 'granted';
			}
			if (status.state === 'denied') {
				return 'denied';
			}
			return 'prompt';
		}
		catch (error) {
			if (this.detectClipboardBlock(error)) {
				return 'denied';
			}
			return 'unknown';
		}
	}

	private detectClipboardBlock(error: unknown): boolean {
		const name = this.resolveErrorName(error);
		if (name) {
			const loweredName = name.toLowerCase();
			if (this.isClipboardBlockedIndicator(loweredName)) {
				return true;
			}
		}
		const message = this.resolveErrorMessage(error);
		if (message) {
			const loweredMessage = message.toLowerCase();
			if (this.isClipboardBlockedIndicator(loweredMessage)) {
				return true;
			}
		}
		return false;
	}

	private resolveErrorName(error: unknown): string | null {
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

	private resolveErrorMessage(error: unknown): string | null {
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
		if (status === 'allowed') {
			return 'granted';
		}
		if (status === 'blocked') {
			return 'denied';
		}
		return 'unknown';
	}

	private fromPermissionState(state: ClipboardPermissionState, current: ClipboardAvailability): ClipboardAvailability {
		if (state === 'granted') {
			return 'allowed';
		}
		if (state === 'denied') {
			return 'blocked';
		}
		return current === 'allowed' ? 'allowed' : 'unknown';
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

interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface Vec2 {
	x: number;
	y: number;
}

interface ControlVisualState {
	active: boolean;
	hidden: boolean;
}

interface ActionButtonDefinition {
	readonly id: string;
	readonly label: string;
	readonly baseX: number;
	readonly baseY: number;
	readonly radius: number;
	readonly color: string;
	readonly activeColor: string;
}

interface ActionButtonLayout {
	center: Vec2;
	radius: number;
	label: string;
	color: string;
	activeColor: string;
}

const DPAD_BASE_SIZE = 100;
const ACTION_BASE_WIDTH = 100;
const ACTION_BASE_HEIGHT = 220;
const MIN_OVERLAY_MARGIN = 12;

const DPAD_SEGMENT_DEFINITIONS = [
	{ id: 'd-pad-u', startDeg: 67.5, endDeg: 112.5 },
	{ id: 'd-pad-ru', startDeg: 22.5, endDeg: 67.5 },
	{ id: 'd-pad-r', startDeg: 337.5, endDeg: 382.5 },
	{ id: 'd-pad-rd', startDeg: 292.5, endDeg: 337.5 },
	{ id: 'd-pad-d', startDeg: 247.5, endDeg: 292.5 },
	{ id: 'd-pad-ld', startDeg: 202.5, endDeg: 247.5 },
	{ id: 'd-pad-l', startDeg: 157.5, endDeg: 202.5 },
	{ id: 'd-pad-lu', startDeg: 112.5, endDeg: 157.5 },
];

const ACTION_BUTTON_DEFINITIONS: ActionButtonDefinition[] = [
	{ id: 'start_knop', label: 'ST', baseX: 50, baseY: 200, radius: 20, color: '#00bfff', activeColor: '#1c9ed8' },
	{ id: 'select_knop', label: 'SE', baseX: 20, baseY: 170, radius: 20, color: '#ffd200', activeColor: '#d6ad00' },
	{ id: 'ls_knop', label: 'LS', baseX: 50, baseY: 20, radius: 20, color: '#ffa500', activeColor: '#e08c00' },
	{ id: 'rs_knop', label: 'RS', baseX: 80, baseY: 50, radius: 20, color: '#8000ff', activeColor: '#661ad6' },
	{ id: 'a_knop', label: 'A', baseX: 50, baseY: 140, radius: 20, color: '#0066ff', activeColor: '#1a84ff' },
	{ id: 'b_knop', label: 'B', baseX: 80, baseY: 110, radius: 20, color: '#ff0000', activeColor: '#ff3333' },
	{ id: 'x_knop', label: 'X', baseX: 20, baseY: 110, radius: 20, color: '#ff00ff', activeColor: '#ff33ff' },
	{ id: 'y_knop', label: 'Y', baseX: 50, baseY: 80, radius: 20, color: '#00c000', activeColor: '#33d633' },
	{ id: 'lt_knop', label: 'LT', baseX: 20, baseY: 50, radius: 18, color: '#555555', activeColor: '#787878' },
	{ id: 'rt_knop', label: 'RT', baseX: 80, baseY: 20, radius: 18, color: '#444444', activeColor: '#676767' },
];

const DEFAULT_THEME = {
	dpadBaseFill: '#1a1a1a',
	dpadBaseStroke: '#2d2d2d',
	dpadSegmentFill: '#323232',
	dpadSegmentActiveFill: '#4a8dff',
	dpadSegmentStroke: '#0f0f0f',
	dpadRingActive: '#7dc9ff',
	buttonStroke: '#0f0f0f',
	buttonLabelColor: '#ffffff',
	buttonFontFamily: "'Press Start 2P', sans-serif",
};

interface DpadLayout {
	type: 'dpad';
	width: number;
	height: number;
	center: Vec2;
	outerRadius: number;
	innerRadius: number;
	strokeWidth: number;
	bounds: Rect;
	scale: number;
	pixelRatio: number;
}

interface ActionLayout {
	type: 'action';
	width: number;
	height: number;
	strokeWidth: number;
	fontSize: number;
	buttons: Record<string, ActionButtonLayout>;
	bounds: Rect;
	scale: number;
	pixelRatio: number;
}

type SurfaceLayout = DpadLayout | ActionLayout;

interface SurfaceMetrics {
	bounds: Rect;
	scale: number;
}

function degToRad(value: number): number {
	return value * Math.PI / 180;
}

function clampScale(scale: number, min: number, max: number): number {
	if (scale < min) {
		return min;
	}
	if (scale > max) {
		return max;
	}
	return scale;
}

abstract class CanvasControl {
	readonly id: string;
	protected path = new Path2D();

	protected constructor(id: string) {
		this.id = id;
	}

	contains(ctx: CanvasRenderingContext2D, x: number, y: number): boolean {
		return ctx.isPointInPath(this.path, x, y);
	}
}

class DpadSegmentControl extends CanvasControl {
	private readonly startDeg: number;
	private readonly endDeg: number;
	private startRad = 0;
	private endRad = 0;

	constructor(id: string, startDeg: number, endDeg: number) {
		super(id);
		this.startDeg = startDeg;
		this.endDeg = endDeg;
	}

	configure(layout: DpadLayout): void {
		let start = degToRad(this.startDeg);
		let end = degToRad(this.endDeg);
		if (end <= start) {
			end += Math.PI * 2;
		}
		this.startRad = start;
		this.endRad = end;
		const path = new Path2D();
		const center = layout.center;
		const outer = layout.outerRadius;
		const inner = layout.innerRadius;
		path.moveTo(center.x + inner * Math.cos(start), center.y + inner * Math.sin(start));
		path.lineTo(center.x + outer * Math.cos(start), center.y + outer * Math.sin(start));
		path.arc(center.x, center.y, outer, start, end);
		path.lineTo(center.x + inner * Math.cos(end), center.y + inner * Math.sin(end));
		path.arc(center.x, center.y, inner, end, start, true);
		path.closePath();
		this.path = path;
	}

	render(ctx: CanvasRenderingContext2D, layout: DpadLayout, state: ControlVisualState): void {
		ctx.save();
		ctx.fillStyle = state.active ? DEFAULT_THEME.dpadSegmentActiveFill : DEFAULT_THEME.dpadSegmentFill;
		ctx.strokeStyle = DEFAULT_THEME.dpadSegmentStroke;
		ctx.lineWidth = layout.strokeWidth;
		ctx.fill(this.path);
		ctx.stroke(this.path);
		ctx.restore();
	}

	getAngles(): { start: number; end: number } {
		return { start: this.startRad, end: this.endRad };
	}
}

class ActionButtonControl extends CanvasControl {
	private readonly definition: ActionButtonDefinition;

	constructor(definition: ActionButtonDefinition) {
		super(definition.id);
		this.definition = definition;
	}

	configure(layout: ActionLayout): void {
		const config = layout.buttons[this.definition.id];
		const path = new Path2D();
		path.arc(config.center.x, config.center.y, config.radius, 0, Math.PI * 2);
		this.path = path;
	}

	render(ctx: CanvasRenderingContext2D, layout: ActionLayout, state: ControlVisualState): void {
		const config = layout.buttons[this.definition.id];
		const fill = state.active ? config.activeColor : config.color;
		ctx.save();
		ctx.fillStyle = fill;
		ctx.strokeStyle = DEFAULT_THEME.buttonStroke;
		ctx.lineWidth = layout.strokeWidth;
		ctx.fill(this.path);
		ctx.stroke(this.path);
		ctx.fillStyle = DEFAULT_THEME.buttonLabelColor;
		ctx.font = `${layout.fontSize}px ${DEFAULT_THEME.buttonFontFamily}`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(config.label, config.center.x, config.center.y);
		ctx.restore();
	}
}

class BrowserOnscreenGamepadSurface {
	private readonly element: HTMLCanvasElement;
	private readonly ctx: CanvasRenderingContext2D;
	private readonly kind: OnscreenGamepadControlKind;
	private readonly publishMetricsFn: (kind: OnscreenGamepadControlKind, metrics: SurfaceMetrics | null) => void;
	private readonly controls = new Map<string, CanvasControl>();
	private readonly states = new Map<string, ControlVisualState>();
	private readonly supportedIds = new Set<string>();
	private readonly dpadRing = new Set<string>();
	private layout: SurfaceLayout | null = null;
	private frameHandle = 0;
	private drawPending = false;

	constructor(doc: Document, id: string, kind: OnscreenGamepadControlKind, publishMetricsFn: (kind: OnscreenGamepadControlKind, metrics: SurfaceMetrics | null) => void) {
		this.kind = kind;
		this.publishMetricsFn = publishMetricsFn;
		const existing = doc.getElementById(id);
		if (!(existing instanceof HTMLCanvasElement)) {
			throw new Error(`[BrowserOnscreenGamepadPlatform] Expected onscreen canvas '#${id}' to exist in the document.`);
		}
		const canvas = existing;
		canvas.classList.add('onscreen-surface');
		canvas.hidden = true;
		if (kind === 'dpad') {
			canvas.style.left = '0';
			canvas.style.right = 'auto';
		} else {
			canvas.style.right = '0';
			canvas.style.left = 'auto';
		}
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			throw new Error('[BrowserOnscreenGamepadPlatform] Unable to initialize onscreen gamepad surface context.');
		}
		this.element = canvas;
		this.ctx = ctx;
		this.initializeControls();
	}

	attach(hooks: OnscreenGamepadPlatformHooks): CanvasSurfaceSession {
		this.element.hidden = false;
		this.element.removeAttribute('hidden');
		this.updateLayout();
		this.requestDraw();
		return new CanvasSurfaceSession(this, hooks, this.kind);
	}

	dispose(): void {
		this.cancelDraw();
		this.element.hidden = true;
		this.element.setAttribute('hidden', 'true');
		this.layout = null;
		this.publishMetricsFn(this.kind, null);
	}

	collectElementIds(clientX: number, clientY: number): string[] {
		if (!this.layout) {
			return [];
		}
		const rect = this.element.getBoundingClientRect();
		const localX = clientX - rect.left;
		const localY = clientY - rect.top;
		this.ctx.save();
		this.ctx.setTransform(1, 0, 0, 1, 0, 0);
		try {
			const result: string[] = [];
			for (const [id, control] of this.controls) {
				const state = this.states.get(id);
				if (!state || state.hidden) {
					continue;
				}
				if (control.contains(this.ctx, localX, localY)) {
					result.push(id);
				}
			}
			return result;
		} finally {
			this.ctx.restore();
		}
	}

	setElementActive(id: string, active: boolean): void {
		const state = this.states.get(id);
		if (!state) {
			throw new Error(`[BrowserOnscreenGamepadPlatform] Unknown control id '${id}'.`);
		}
		if (state.active === active) {
			return;
		}
		state.active = active;
		this.requestDraw();
	}

	resetElements(ids: string[]): void {
		let changed = false;
		for (let i = 0; i < ids.length; i++) {
			const id = ids[i];
			const state = this.states.get(id);
			if (!state) {
				continue;
			}
			if (state.hidden || state.active) {
				state.hidden = false;
				state.active = false;
				changed = true;
			}
		}
		if (changed) {
			this.requestDraw();
		}
	}

	hideElements(ids: string[]): void {
		let changed = false;
		for (let i = 0; i < ids.length; i++) {
			const id = ids[i];
			const state = this.states.get(id);
			if (!state) {
				continue;
			}
			if (!state.hidden || state.active) {
				state.hidden = true;
				state.active = false;
				changed = true;
			}
		}
		if (changed) {
			this.requestDraw();
		}
	}

	updateDpadRing(active: string[]): void {
		if (this.kind !== 'dpad') {
			return;
		}
		this.dpadRing.clear();
		for (let i = 0; i < active.length; i++) {
			if (this.states.has(active[i])) {
				this.dpadRing.add(active[i]);
			}
		}
		this.requestDraw();
	}

	makePointerEvent(event: PointerEvent): OnscreenPointerEvent {
		const pointerId = event.pointerId;
		return {
			pointerId,
			clientX: event.clientX,
			clientY: event.clientY,
			pressure: event.pressure,
			buttons: event.buttons,
			capture: () => {
				try {
					this.element.setPointerCapture(pointerId);
				} catch {
					/* ignore */
				}
			},
			release: () => {
				if (this.element.hasPointerCapture(pointerId)) {
					this.element.releasePointerCapture(pointerId);
				}
			},
		};
	}

	updateLayout(): void {
		if (typeof window === 'undefined') {
			return;
		}
		const viewportWidth = Math.max(1, window.innerWidth);
		const viewportHeight = Math.max(1, window.innerHeight);
		const pixelRatio = typeof window.devicePixelRatio === 'number' ? window.devicePixelRatio : 1;
		const limitedDimension = Math.max(1, Math.min(viewportWidth, viewportHeight));
		const margin = Math.max(MIN_OVERLAY_MARGIN, Math.round(limitedDimension * 0.05));
		let scale: number;
		let bounds: Rect;
		if (this.kind === 'dpad') {
			scale = clampScale(limitedDimension * 0.20 / DPAD_BASE_SIZE, 0.4, 4);
			const width = DPAD_BASE_SIZE * scale;
			const height = width;
			const left = margin;
			const bottom = margin;
			this.element.style.left = `${left}px`;
			this.element.style.right = 'auto';
			this.element.style.bottom = `${bottom}px`;
			this.element.style.width = `${width}px`;
			this.element.style.height = `${height}px`;
			this.resizeCanvas(width, height, pixelRatio);
			bounds = {
				x: left,
				y: viewportHeight - bottom - height,
				width,
				height,
			};
			const layout: DpadLayout = {
				type: 'dpad',
				width,
				height,
				center: { x: width / 2, y: height / 2 },
				outerRadius: width / 2,
				innerRadius: width * 0.35,
				strokeWidth: Math.max(1.5, scale * 1.2),
				bounds,
				scale,
				pixelRatio,
			};
			this.layout = layout;
			for (const control of this.controls.values()) {
				(control as DpadSegmentControl).configure(layout);
			}
		} else {
			scale = clampScale(limitedDimension * 0.20 / ACTION_BASE_WIDTH, 0.4, 4);
			const width = ACTION_BASE_WIDTH * scale;
			const height = ACTION_BASE_HEIGHT * scale;
			const right = margin;
			const bottom = margin;
			const left = viewportWidth - width - right;
			this.element.style.right = `${right}px`;
			this.element.style.left = 'auto';
			this.element.style.bottom = `${bottom}px`;
			this.element.style.width = `${width}px`;
			this.element.style.height = `${height}px`;
			this.resizeCanvas(width, height, pixelRatio);
			bounds = {
				x: left,
				y: viewportHeight - bottom - height,
				width,
				height,
			};
			const buttonLayouts = this.buildActionLayout(scale);
			const layout: ActionLayout = {
				type: 'action',
				width,
				height,
				strokeWidth: Math.max(1.5, scale * 1.2),
				fontSize: Math.max(8, scale * 7),
				buttons: buttonLayouts,
				bounds,
				scale,
				pixelRatio,
			};
			this.layout = layout;
			for (const control of this.controls.values()) {
				(control as ActionButtonControl).configure(layout);
			}
		}
		this.publishMetricsFn(this.kind, { bounds, scale });
		this.requestDraw();
	}

	getElement(): HTMLCanvasElement {
		return this.element;
	}

	hasControl(id: string): boolean {
		return this.supportedIds.has(id);
	}

	private resizeCanvas(width: number, height: number, pixelRatio: number): void {
		this.element.width = Math.max(1, Math.round(width * pixelRatio));
		this.element.height = Math.max(1, Math.round(height * pixelRatio));
		this.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
	}

	private requestDraw(): void {
		if (this.drawPending) {
			return;
		}
		this.drawPending = true;
		this.frameHandle = window.requestAnimationFrame(() => this.draw());
	}

	private cancelDraw(): void {
		if (!this.drawPending) {
			return;
		}
		window.cancelAnimationFrame(this.frameHandle);
		this.frameHandle = 0;
		this.drawPending = false;
	}

	private draw(): void {
		this.drawPending = false;
		if (!this.layout) {
			return;
		}
		const layout = this.layout;
		this.ctx.save();
		this.ctx.setTransform(1, 0, 0, 1, 0, 0);
		this.ctx.clearRect(0, 0, this.element.width, this.element.height);
		this.ctx.restore();
		this.ctx.save();
		this.ctx.setTransform(layout.pixelRatio, 0, 0, layout.pixelRatio, 0, 0);
		if (layout.type === 'dpad') {
			this.drawDpadBase(layout);
			for (const [id, control] of this.controls) {
				const state = this.states.get(id);
				if (!state || state.hidden) {
					continue;
				}
				(control as DpadSegmentControl).render(this.ctx, layout, state);
			}
			this.drawDpadRing(layout);
		} else {
			for (const [id, control] of this.controls) {
				const state = this.states.get(id);
				if (!state || state.hidden) {
					continue;
				}
				(control as ActionButtonControl).render(this.ctx, layout, state);
			}
		}
		this.ctx.restore();
	}

	private drawDpadBase(layout: DpadLayout): void {
		this.ctx.save();
		this.ctx.fillStyle = DEFAULT_THEME.dpadBaseFill;
		this.ctx.strokeStyle = DEFAULT_THEME.dpadBaseStroke;
		this.ctx.lineWidth = layout.strokeWidth;
		this.ctx.beginPath();
		this.ctx.arc(layout.center.x, layout.center.y, layout.outerRadius, 0, Math.PI * 2);
		this.ctx.fill();
		this.ctx.stroke();
		this.ctx.restore();
	}

	private drawDpadRing(layout: DpadLayout): void {
		if (this.dpadRing.size === 0) {
			return;
		}
		this.ctx.save();
		this.ctx.lineWidth = layout.strokeWidth * 1.6;
		this.ctx.strokeStyle = DEFAULT_THEME.dpadRingActive;
		const radius = layout.outerRadius - layout.strokeWidth * 0.6;
		for (const id of this.dpadRing.values()) {
			const control = this.controls.get(id);
			if (!(control instanceof DpadSegmentControl)) {
				continue;
			}
			const { start, end } = control.getAngles();
			this.ctx.beginPath();
			this.ctx.arc(layout.center.x, layout.center.y, radius, start, end);
			this.ctx.stroke();
		}
		this.ctx.restore();
	}

	private initializeControls(): void {
		if (this.kind === 'dpad') {
			for (const def of DPAD_SEGMENT_DEFINITIONS) {
				const control = new DpadSegmentControl(def.id, def.startDeg, def.endDeg);
				this.controls.set(control.id, control);
				this.states.set(control.id, { active: false, hidden: false });
				this.supportedIds.add(control.id);
			}
		} else {
			for (const def of ACTION_BUTTON_DEFINITIONS) {
				const control = new ActionButtonControl(def);
				this.controls.set(control.id, control);
				this.states.set(control.id, { active: false, hidden: false });
				this.supportedIds.add(control.id);
			}
		}
	}

	private buildActionLayout(scale: number): Record<string, ActionButtonLayout> {
		const layout: Record<string, ActionButtonLayout> = {};
		for (const def of ACTION_BUTTON_DEFINITIONS) {
			layout[def.id] = {
				center: {
					x: def.baseX * scale,
					y: def.baseY * scale,
				},
				radius: def.radius * scale,
				label: def.label,
				color: def.color,
				activeColor: def.activeColor,
			};
		}
		return layout;
	}
}

class CanvasSurfaceSession implements OnscreenGamepadPlatformSession {
	private readonly controller = new AbortController();
	private readonly activePointers = new Set<number>();

	constructor(private readonly surface: BrowserOnscreenGamepadSurface, private readonly hooks: OnscreenGamepadPlatformHooks, private readonly kind: OnscreenGamepadControlKind) {
		const signal = this.controller.signal;
		const element = this.surface.getElement();
		const listenerOptions: AddEventListenerOptions = { signal, passive: false };
		element.addEventListener('pointerdown', this.onPointerDown, listenerOptions);
		element.addEventListener('pointermove', this.onPointerMove, listenerOptions);
		element.addEventListener('pointerup', this.onPointerUp, listenerOptions);
		element.addEventListener('pointercancel', this.onPointerCancel, listenerOptions);
		element.addEventListener('lostpointercapture', this.onPointerCancel, { signal });
		window.addEventListener('resize', this.onResize, { signal });
		window.addEventListener('blur', this.onBlur, { signal });
		window.addEventListener('focus', this.onFocus, { signal });
	}

	dispose(): void {
		this.controller.abort();
		this.activePointers.clear();
		this.surface.dispose();
	}

	private readonly onPointerDown = (event: PointerEvent) => {
		const ids = this.surface.collectElementIds(event.clientX, event.clientY);
		if (ids.length === 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		const adapter = this.surface.makePointerEvent(event);
		adapter.capture();
		this.activePointers.add(event.pointerId);
		this.hooks.pointerDown(this.kind, adapter);
	};

	private readonly onPointerMove = (event: PointerEvent) => {
		if (!this.activePointers.has(event.pointerId)) {
			return;
		}
		if (event.buttons === 0 && event.pressure === 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		const adapter = this.surface.makePointerEvent(event);
		this.hooks.pointerMove(this.kind, adapter);
	};

	private readonly onPointerUp = (event: PointerEvent) => {
		if (!this.activePointers.has(event.pointerId)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		const adapter = this.surface.makePointerEvent(event);
		adapter.release();
		this.hooks.pointerUp(this.kind, adapter);
		this.activePointers.delete(event.pointerId);
	};

	private readonly onPointerCancel = (event: PointerEvent) => {
		if (!this.activePointers.has(event.pointerId)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		const adapter = this.surface.makePointerEvent(event);
		adapter.release();
		this.hooks.pointerUp(this.kind, adapter);
		this.activePointers.delete(event.pointerId);
	};

	private readonly onResize = () => {
		this.surface.updateLayout();
	};

	private readonly onBlur = () => {
		this.activePointers.clear();
		this.hooks.blur();
	};

	private readonly onFocus = () => {
		this.activePointers.clear();
		this.hooks.focus();
	};
}

class CompositeGamepadSession implements OnscreenGamepadPlatformSession {
	private readonly sessions: OnscreenGamepadPlatformSession[];

	constructor(...sessions: OnscreenGamepadPlatformSession[]) {
		this.sessions = sessions;
	}

	dispose(): void {
		for (const session of this.sessions) {
			session.dispose();
		}
	}
}

interface GamepadOverlayMetrics {
	dpad: SurfaceMetrics | null;
	action: SurfaceMetrics | null;
}

export class BrowserOnscreenGamepadPlatform implements OnscreenGamepadPlatform {
	private readonly document: Document;
	private readonly dpadSurface: BrowserOnscreenGamepadSurface;
	private readonly actionSurface: BrowserOnscreenGamepadSurface;

	constructor(doc?: Document) {
		if (typeof window === 'undefined') {
			throw new Error('[BrowserOnscreenGamepadPlatform] Global window is not available.');
		}
		if (doc) {
			this.document = doc;
		} else {
			if (typeof document === 'undefined') {
				throw new Error('[BrowserOnscreenGamepadPlatform] Global document is not available.');
			}
			this.document = document;
		}
		this.dpadSurface = new BrowserOnscreenGamepadSurface(this.document, 'bmsx-dpad-canvas', 'dpad', (kind, metrics) => this.publishMetrics(kind, metrics));
		this.actionSurface = new BrowserOnscreenGamepadSurface(this.document, 'bmsx-action-canvas', 'action', (kind, metrics) => this.publishMetrics(kind, metrics));
	}

	attach(hooks: OnscreenGamepadPlatformHooks): OnscreenGamepadPlatformSession {
		const dpadSession = this.dpadSurface.attach(hooks);
		const actionSession = this.actionSurface.attach(hooks);
		return new CompositeGamepadSession(dpadSession, actionSession);
	}

	hideElements(elementIds: string[]): void {
		this.dpadSurface.hideElements(elementIds);
		this.actionSurface.hideElements(elementIds);
	}

	collectElementIds(x: number, y: number, kind: OnscreenGamepadControlKind): string[] {
		return kind === 'dpad' ? this.dpadSurface.collectElementIds(x, y) : this.actionSurface.collectElementIds(x, y);
	}

	setElementActive(elementId: string, active: boolean): void {
		if (this.dpadSurface.hasControl(elementId)) {
			this.dpadSurface.setElementActive(elementId, active);
			return;
		}
		if (this.actionSurface.hasControl(elementId)) {
			this.actionSurface.setElementActive(elementId, active);
			return;
		}
		throw new Error(`[BrowserOnscreenGamepadPlatform] Unknown control id '${elementId}'.`);
	}

	resetElements(elementIds: string[]): void {
		this.dpadSurface.resetElements(elementIds);
		this.actionSurface.resetElements(elementIds);
	}

	updateDpadRing(activeElementIds: string[]): void {
		this.dpadSurface.updateDpadRing(activeElementIds);
	}

	supportsVibration(): boolean {
		return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
	}

	vibrate(durationMs: number): void {
		if (!this.supportsVibration()) {
			throw new Error('[BrowserOnscreenGamepadPlatform] Vibration is not supported.');
		}
		navigator.vibrate(durationMs);
	}

	private publishMetrics(kind: OnscreenGamepadControlKind, metrics: SurfaceMetrics | null): void {
		const holder = globalThis as { __bmsxOnscreenGamepadMetrics?: GamepadOverlayMetrics };
		const current: GamepadOverlayMetrics = holder.__bmsxOnscreenGamepadMetrics ?? { dpad: null, action: null };
		if (kind === 'dpad') {
			current.dpad = metrics;
		} else {
			current.action = metrics;
		}
		holder.__bmsxOnscreenGamepadMetrics = current;
	}
}

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

class CanvasGamepadControlHandle implements GamepadControlHandle {
	public constructor(public readonly id: string, private readonly element: HTMLElement, private readonly metrics: SurfaceMetrics) { }

	public getNumericAttribute(name: string): number | null {
		if (name === 'width') {
			return Math.round(this.metrics.bounds.width);
		}
		if (name === 'height') {
			return Math.round(this.metrics.bounds.height);
		}
		return null;
	}

	public measure(): { width: number; height: number; } {
		const rect = this.element.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0) {
			return { width: rect.width, height: rect.height };
		}
		return { width: this.metrics.bounds.width, height: this.metrics.bounds.height };
	}

	public setBottom(px: number): void {
		this.element.style.bottom = `${px}px`;
	}

	public setScale(scale: number): void {
		this.element.style.transformOrigin = 'center bottom';
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
		this.viewportCapability = {
			getViewportMetrics: () => this.computeViewportMetrics(),
		};
		this.overlayCapability = {
			ensureOverlay: (id: string) => this.ensureOverlayInternal(id),
			getOverlay: (id: string) => this.getOverlayInternal(id),
		};
		this.windowEventsCapability = {
			subscribe: (type: HostWindowEventType, listener: HostEventListenerTarget, options?: HostEventOptions) => {
				const domListener = this.getDomListener(listener);
				const domOptions = toDomOptions(options);
				window.addEventListener(type, domListener, domOptions);
				return () => window.removeEventListener(type, domListener, domOptions);
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
			onChange: (listener: (isFullscreen: boolean) => void) => {
				const handler = () => listener(document.fullscreenElement === document.documentElement);
				document.addEventListener('fullscreenchange', handler);
				return () => document.removeEventListener('fullscreenchange', handler);
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

	private resolveOnscreenGamepadHandles(): OnscreenGamepadHandles | null {
		const holder = globalThis as { __bmsxOnscreenGamepadMetrics?: GamepadOverlayMetrics };
		const metrics = holder.__bmsxOnscreenGamepadMetrics;
		if (!metrics || !metrics.dpad || !metrics.action) {
			return null;
		}
		const dpadElement = document.querySelector<HTMLElement>('#bmsx-dpad-canvas');
		const actionElement = document.querySelector<HTMLElement>('#bmsx-action-canvas');
		if (!(dpadElement instanceof HTMLElement) || !(actionElement instanceof HTMLElement)) {
			return null;
		}
		return {
			dpad: new CanvasGamepadControlHandle('d-pad-surface', dpadElement, metrics.dpad),
			actionButtons: new CanvasGamepadControlHandle('action-surface', actionElement, metrics.action),
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

	private getOverlayInternal(id: string): OverlayHandle | null {
		return this.overlays.get(id) ?? null;
	}

	public getCapability<T extends GameViewHostCapabilityId>(capability: T): GameViewHostCapabilityMap[T] | null {
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
	const factory = resolveBackendFactory();
	return factory(host);
}
