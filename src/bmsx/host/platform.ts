import { BrowserGameViewHost, BrowserPlatform } from './browser/platform_browser';

export interface Platform {
	clock: Clock;
	frames: FrameLoop;
	lifecycle: Lifecycle;
	input: InputHub;
	storage: StorageService;
	hid: HIDService;
	onscreenGamepad: OnscreenGamepadPlatform;
	audio: AudioService;
	rng: RngService;
	gameviewHost: GameViewHost;
}

export type MonoTime = number;

export interface Clock { now(): MonoTime; }

export interface FrameLoop {
	start(tick: (t: MonoTime) => void): { stop(): void };
}

// --------- AUDIO TYPES (platform-level, engine-agnostic) ---------

export interface AudioLoop {
	start: number;
	end?: number;
}

export interface AudioFilterParams {
	type: BiquadFilterType;
	frequency: number;
	q: number;
	gain: number;
}

export interface AudioPlaybackParams {
	offset: number;
	rate: number;
	gainLinear: number;
	loop: AudioLoop | null;
	filter: AudioFilterParams | null;
}

export interface AudioClipHandle {
	readonly duration: number;
	dispose(): void;
}

export interface VoiceEndedEvent {
	clippedAt: number;
}

export interface VoiceHandle {
	readonly startedAt: number;
	readonly startOffset: number;
	onEnded(cb: (e: VoiceEndedEvent) => void): () => void;
	setGainLinear(v: number): void;
	rampGainLinear(target: number, durationSec: number): void;
	setFilter(p: AudioFilterParams | null): void;
	setRate(v: number): void;
	stop(): void;
	disconnect(): void;
}

export interface AudioService {
	readonly available: boolean;
	currentTime(): number;
	resume(): Promise<void>;
	suspend(): Promise<void>;
	getMasterGain(): number;
	setMasterGain(v: number): void;
	decode(bytes: ArrayBuffer): Promise<AudioClipHandle>;
	createVoice(clip: AudioClipHandle, params: AudioPlaybackParams): VoiceHandle;
}

export interface RngService {
	next(): number;
	seed(value: number): void;
}

export type DeviceKind = 'keyboard' | 'gamepad' | 'pointer' | 'touch' | 'virtual';

export interface VibrationParams { effect: 'dual-rumble'; duration: number; intensity: number; }

export interface InputModifiers {
	ctrl: boolean;
	shift: boolean;
	alt: boolean;
}

export type InputEvt =
	| { type: 'button'; deviceId: string; code: string; down: boolean; value: number; timestamp: MonoTime; pressId: number | null; modifiers?: InputModifiers }
	| { type: 'axis1'; deviceId: string; code: string; x: number; timestamp: MonoTime; modifiers?: InputModifiers }
	| { type: 'axis2'; deviceId: string; code: string; x: number; y: number; timestamp: MonoTime; modifiers?: InputModifiers }
	| { type: 'connect'; device: InputDevice; timestamp: MonoTime }
	| { type: 'disconnect'; deviceId: string; timestamp: MonoTime };

export interface InputDevice {
	id: string;
	kind: DeviceKind;
	description: string;
	supportsVibration: boolean;
	setVibration(p: VibrationParams): void;
	poll(clock: Clock): void;
}

export interface InputHub {
	subscribe(fn: (e: InputEvt) => void): () => void;
	post(e: InputEvt): void;
	devices(): InputDevice[];
	setKeyboardCapture(handler: (code: string) => boolean): void;
}

export type OnscreenGamepadControlKind = 'dpad' | 'action';

export interface OnscreenPointerEvent {
	pointerId: number;
	clientX: number;
	clientY: number;
	pressure: number;
	buttons: number;
	capture(): void;
	release(): void;
}

export interface OnscreenGamepadPlatformHooks {
	pointerDown(kind: OnscreenGamepadControlKind, event: OnscreenPointerEvent): void;
	pointerMove(kind: OnscreenGamepadControlKind, event: OnscreenPointerEvent): void;
	pointerUp(kind: OnscreenGamepadControlKind, event: OnscreenPointerEvent): void;
	blur(): void;
	focus(): void;
	pointerOut(): void;
}

export interface OnscreenGamepadPlatformSession {
	dispose(): void;
}

export interface OnscreenGamepadPlatform {
	attach(hooks: OnscreenGamepadPlatformHooks): OnscreenGamepadPlatformSession;
	hideElements(elementIds: string[]): void;
	collectElementIds(x: number, y: number, kind: OnscreenGamepadControlKind): string[];
	setElementActive(elementId: string, active: boolean): void;
	resetElements(elementIds: string[]): void;
	updateDpadRing(activeElementIds: string[]): void;
	supportsVibration(): boolean;
	vibrate(durationMs: number): void;
}

export interface Lifecycle {
	onVisibilityChange(cb: (visible: boolean) => void): () => void;
	onWillExit(cb: (event: BeforeUnloadEvent) => void): () => void;
}

export interface StorageService {
	getItem(k: string): string | null;
	setItem(k: string, v: string): void;
	removeItem(k: string): void;
}

export interface HIDService {
	isSupported(): boolean;
	requestDevice(options: HIDDeviceRequestOptions): Promise<HIDDevice[]>;
	getDevices(): Promise<HIDDevice[]>;
}

export type GameViewHostHandle = unknown; // Represents a handle to the underlying platform-specific game view host (e.g., a canvas element in a browser).

export interface ViewportDimensions {
	width: number;
	height: number;
}

export interface ViewportMetrics {
	document: ViewportDimensions;
	windowInner: ViewportDimensions;
	screen: ViewportDimensions;
}

export type HostWindowEventType = 'resize' | 'orientationchange' | 'keyup' | 'keydown';

export type HostEventListener = (event: unknown) => void;

export interface HostEventListenerObject {
	handleEvent(event: unknown): void;
}

export type HostEventListenerTarget = HostEventListener | HostEventListenerObject;

export type HostEventOptions = boolean | {
	capture?: boolean;
	passive?: boolean;
	once?: boolean;
	[key: string]: unknown;
};

export interface SurfaceBounds {
	width: number;
	height: number;
	left: number;
	top: number;
}

export interface GameViewCanvas {
	readonly handle: GameViewHostHandle;
	isVisible(): boolean;
	setRenderTargetSize(width: number, height: number): void;
	setDisplaySize(width: number, height: number): void;
	setDisplayPosition(left: number, top: number): void;
	measureDisplay(): SurfaceBounds;
}

export interface GamepadControlHandle {
	readonly id: string;
	getNumericAttribute(name: string): number | null;
	measure(): { width: number; height: number; };
	setBottom(px: number): void;
	setScale(scale: number): void;
}

export interface OnscreenGamepadHandles {
	dpad: GamepadControlHandle;
	actionButtons: GamepadControlHandle;
}

export interface OverlayHandle {
	setText(text: string): void;
	addClass(className: string): void;
	removeClass(className: string): void;
	onAnimationEnd(callback: () => void): void;
	forceReflow(): void;
	remove(): void;
}

export interface GameViewHost {
	readonly surface: GameViewCanvas;

	getViewportMetrics(): ViewportMetrics;

	getOnscreenGamepadHandles(): OnscreenGamepadHandles | null;

	ensureOverlay(id: string): OverlayHandle;

	getOverlay(id: string): OverlayHandle | null;

	addWindowEventListener(type: HostWindowEventType, listener: HostEventListenerTarget, options?: HostEventOptions): void;

	removeWindowEventListener(type: HostWindowEventType, listener: HostEventListenerTarget, options?: HostEventOptions): void;

	addDisplayModeChangeListener(listener: (isFullscreen: boolean) => void): void;

	fullscreenAvailable(): boolean;

	get fullscreen(): boolean;
	setFullscreen(v: boolean): Promise<void>;

	createBackend(): Promise<unknown>; // Untyped to avoid circular dependency; should return GPUBackend
}

export function constructPlatformFromViewHostHandle(handle: GameViewHostHandle): Platform {
	if (typeof handle !== 'object' || handle === null || handle === undefined) {
		throw new Error(`[constructPlatformFromViewHostHandle] Invalid handle provided (${handle}); expected an object.`);
	}
	if (handle.constructor.name === 'HTMLCanvasElement') {
		// Special case for HTMLCanvasElement to use BrowserGameViewHost
		const viewHost = new BrowserGameViewHost(handle as HTMLCanvasElement) as BrowserGameViewHost;
		const platform = new BrowserPlatform(viewHost.surface.handle, handle as HTMLCanvasElement) as Platform;
		platform.gameviewHost = viewHost;
		return platform;
	}
	throw new Error('[constructPlatformFromViewHostHandle] Unsupported handle type; cannot construct Platform.');
}
