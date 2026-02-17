import { type vec2 } from 'bmsx/rompack/rompack';

/**
 * Core platform contract.
 *
 * Every host environment (desktop shell, mobile wrapper, browser runtime, etc.) wires the engine
 * to native services by implementing this interface. The properties deliberately mirror the systems
 * the engine expects to exist at runtime: timing (`clock`/`frames`), persistence (`storage`), audio,
 * human input, onscreen controls, and the high-level `gameviewHost` bridge that couples rendering
 * to the platform's windowing model.
 *
 * The onscreen gamepad is treated as a first-class surface here: when it is enabled the engine
 * expects the platform to expose a concrete implementation capable of delivering pointer events,
 * tracking focus/blur transitions, and mapping host-specific hit testing to canonical control IDs.
 * This is fundamental for layout — the renderer explicitly negotiates canvas space with these controls.
 *
 * Design note: This interface is deliberately C++-portable. Patterns like SubscriptionHandle (instead
 * of closure returns) and optional sync methods alongside async ones facilitate a future libretro port.
 */

/**
 * Handle returned by subscription-based APIs. Unlike closure-based unsubscribe patterns,
 * this object model maps cleanly to C++ (where closures require heap allocation).
 *
 * C++ equivalent:
 * ```cpp
 * struct SubscriptionHandle {
 *     uint32_t id;
 *     bool active;
 *     void unsubscribe();
 * };
 * ```
 */
export interface SubscriptionHandle {
	/** Unique identifier for this subscription within its parent hub. */
	readonly id: number;
	/** True if the subscription is still active (not yet unsubscribed). */
	readonly active: boolean;
	/** Remove the subscription. Safe to call multiple times. */
	unsubscribe(): void;
}

let nextSubscriptionId = 1;

/**
 * Creates a SubscriptionHandle that wraps a simple cleanup function.
 * Utility for platform implementations transitioning from closure-based patterns.
 */
export function createSubscriptionHandle(cleanup: () => void): SubscriptionHandle {
	const id = nextSubscriptionId++;
	let active = true;
	return {
		id,
		get active() { return active; },
		unsubscribe() {
			if (!active) return;
			active = false;
			cleanup();
		},
	};
}

export interface MicrotaskQueue {
	schedule(task: () => void): void;
}

export const defaultMicrotaskQueue: MicrotaskQueue = {
	schedule: (task: () => void) => {
		queueMicrotask(task);
	},
};

let activeMicrotaskQueue: MicrotaskQueue = defaultMicrotaskQueue;

export function setMicrotaskQueue(queue: MicrotaskQueue): void {
	activeMicrotaskQueue = queue;
}

export function scheduleMicrotask(task: () => void): void {
	activeMicrotaskQueue.schedule(task);
}

export interface Platform {
	clock: Clock;
	frames: FrameLoop;
	lifecycle: Lifecycle;
	input: InputHub;
	storage: StorageService;
	microtasks: MicrotaskQueue;
	/**
	 * Runtime tick rate expressed in scaled Hz (micro-Hz).
	 * The scale factor is {@link HZ_SCALE}.
	 */
	ufpsScaled: number;
	requestShutdown(): void;
	clipboard: ClipboardService;
	hid: HIDService;
	onscreenGamepad: OnscreenGamepadPlatform;
	audio: AudioService;
	rng: RngService;
	gameviewHost: GameViewHost;
}

export type MonoTime = number;

/**
 * Scale factor for representing Hz as integers (micro-Hz).
 * Example: 59.94 Hz => 59_940_000.
 */
export const HZ_SCALE = 1_000_000;

/**
 * Generic handle returned by the platform when scheduling a delayed callback.
 * Intentionally minimal and non-browser-like (no IDs or global timer names).
 */
export interface TimerHandle {
	/**
	 * Cancel the scheduled callback if it hasn't fired yet. Safe to call multiple times.
	 */
	cancel(): void;

	/**
	 * Returns true if the timer is still active (not yet fired or cancelled).
	 */
	isActive(): boolean;
}

/**
 * Clock provides monotonic time and optional scheduling helpers. Implementations may
 * provide `scheduleOnce` to request a single delayed callback. The method is optional
 * to avoid forcing all Clock implementers to adopt platforms that don't support timers
 * (for example, some headless or test harnesses).
 */
export interface Clock {
	now(): MonoTime;
	perf_now(): MonoTime;
	dateNow(): number;
	scheduleOnce: (delay_ms: number, cb: (t: MonoTime) => void) => TimerHandle;
}

export interface FrameLoop {
	start(tick: (t: MonoTime) => void): { stop(): void };
}

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
	loop: AudioLoop;
	filter: AudioFilterParams;
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
	onEnded(cb: (e: VoiceEndedEvent) => void): SubscriptionHandle;
	setGainLinear(v: number): void;
	rampGainLinear(target: number, durationSec: number): void;
	setFilter(p: AudioFilterParams): void;
	setRate(v: number): void;
	stop(): void;
	disconnect(): void;
}

export interface AudioService {
	readonly available: boolean;
	currentTime(): number;
	sampleRate(): number;
	coreQueuedFrames(): number;
	setCoreNeedHandler(handler: (() => void) | null): void;
	clearCoreStream(): void;
	resume(): Promise<void>;
	suspend(): Promise<void>;
	getMasterGain(): number;
	setMasterGain(v: number): void;
	setFrameTimeSec(seconds: number): void;
	decode(bytes: ArrayBuffer): Promise<AudioClipHandle>;
	pushCoreFrames(samples: Int16Array, channels: number, sampleRate: number): void;
	createClipFromPcm(samples: Int16Array, sampleRate: number, channels: number): AudioClipHandle;
	createVoice(clip: AudioClipHandle, params: AudioPlaybackParams): VoiceHandle;
}

export interface RngService {
	next(): number;
	seed(value: number): void;
}

export type DeviceKind = 'keyboard' | 'gamepad' | 'pointer' | 'touch' | 'virtual';

export interface VibrationParams {
	effect: 'dual-rumble';
	duration: number;
	intensity: number;
}

export interface InputModifiers {
	ctrl: boolean;
	shift: boolean;
	alt: boolean;
}

export type InputEvt =
	| { type: 'button'; deviceId: string; code: string; down: boolean; value: number; timestamp: MonoTime; pressId: number; modifiers?: InputModifiers }
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
	subscribe(fn: (e: InputEvt) => void): SubscriptionHandle;
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

/**
 * Platform responsibility for rendering and routing events to the virtual controls.
 *
 * When the onscreen gamepad feature flag is on, the engine relies on this bridge to negotiate layout
 * and to keep pointer gestures synchronised with the gameplay input hub. The implementation is expected
 * to back the controls with whatever UI primitives the host provides (HTML, native widgets, gamepad
 * texture quads, etc.) while maintaining the canonical element IDs that the engine references.
 */
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

export interface PlatformExitEvent {
	preventDefault(): void;
	setReturnMessage(message: string): void;
}

export interface Lifecycle {
	onVisibilityChange(cb: (visible: boolean) => void): SubscriptionHandle;
	onWillExit(cb: (event: PlatformExitEvent) => void): SubscriptionHandle;
}

export interface StorageService {
	getItem(k: string): string;
	setItem(k: string, v: string): void;
	removeItem(k: string): void;
}

export const enum ClipboardPermissionState {
	Unknown = -1,
	Prompt = 0,
	Granted = 1,
	Denied = 2,
}

export interface ClipboardService {
	isSupported(): boolean;
	writeText(text: string): Promise<void>;
	getWritePermissionState(): ClipboardPermissionState;
	requestWritePermission(): Promise<ClipboardPermissionState>;
}

export interface PlatformHIDDeviceFilter {
	vendorId?: number;
	productId?: number;
	usage?: number;
	usagePage?: number;
}

export interface PlatformHIDDeviceRequestOptions {
	filters: ReadonlyArray<PlatformHIDDeviceFilter>;
}

export interface PlatformHIDReportInfo { reportId?: number; }

export interface PlatformHIDCollectionInfo {
	outputReports?: ReadonlyArray<PlatformHIDReportInfo>;
}

export interface PlatformHIDInputReportEvent {
	device: PlatformHIDDevice;
	reportId: number;
	data: DataView;
}

export interface PlatformHIDDevice {
	vendorId: number;
	productId: number;
	productName?: string;
	opened: boolean;
	collections: ReadonlyArray<PlatformHIDCollectionInfo>;
	open(): Promise<void>;
	close(): Promise<void>;
	sendReport(reportId: number, data: BufferSource): Promise<void> | void;
	addEventListener?(type: 'inputreport', listener: (event: PlatformHIDInputReportEvent) => void): void;
	removeEventListener?(type: 'inputreport', listener: (event: PlatformHIDInputReportEvent) => void): void;
}

export interface HIDService {
	isSupported(): boolean;
	requestDevice(options: PlatformHIDDeviceRequestOptions): Promise<PlatformHIDDevice[]>;
	getDevices(): Promise<PlatformHIDDevice[]>;
}

export type GameViewHostHandle = unknown;

export interface ViewportDimensions {
	width: number;
	height: number;
	viewportScale: number;
	canvasScale: number;
}

export interface VisibleViewportMetrics {
	width: number;
	height: number;
	offsetTop: number;
	offsetLeft: number;
}

/**
 * Aggregated sizing data that the active platform reports to the renderer.
 *
 * The `document`, `windowInner`, and `screen` entries represent the platform's best knowledge of
 * total available space. `visible` captures the interactive sub-rectangle that remains once transient
 * chrome (virtual keyboards, system bars, gesture zones) reduces the actual presentation area.
 *
 * Implementations are free to approximate values when a concept does not exist natively (for instance,
 * a headless renderer can alias all fields to the backing surface bounds). The renderer treats these
 * numbers as authoritative when positioning the main canvas and the onscreen gamepad.
 */
export interface ViewportMetrics {
	document: { width: number; height: number; };
	windowInner: { width: number; height: number; };
	screen: { width: number; height: number; };
	visible: VisibleViewportMetrics;
}

export type HostWindowEventType = 'resize' | 'orientationchange' | 'keyup' | 'keydown' | 'focus' | 'blur';

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

/**
 * Lightweight facade that lets the renderer manipulate the onscreen control visuals without coupling
 * to platform-native widget APIs. Measurements and mutations are expressed in abstract units so the
 * GameView can reason about scale and positioning uniformly across targets.
 */
export interface GamepadControlHandle {
	readonly id: string;
	getNumericAttribute(name: string): number | null;
	measure(): { width: number; height: number; };
	setBottom(px: number): void;
	setScale(scale: number): void;
}

/**
 * Binds the two primary control clusters (directional and action) so the renderer can adjust them
 * together. Additional clusters can be introduced in the future by extending this contract; the current
 * implementation concentrates on the core gameplay experience where these two areas dominate the layout.
 */
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

export interface ViewportMetricsProvider {
	getViewportMetrics(): ViewportMetrics;
}

export interface OverlayManager {
	ensureOverlay(id: string): OverlayHandle;
	getOverlay(id: string): OverlayHandle;
}

export interface WindowEventHub {
	subscribe(type: HostWindowEventType, listener: HostEventListenerTarget, options?: HostEventOptions): SubscriptionHandle;
}

export interface DisplayModeController {
	isSupported(): boolean;
	isFullscreen(): boolean;
	setFullscreen(enabled: boolean): Promise<void>;
	onChange(listener: (isFullscreen: boolean) => void): SubscriptionHandle;
}

export interface OnscreenGamepadHandleProvider {
	getHandles(): OnscreenGamepadHandles;
}

export type GameViewHostCapabilityId =
	| 'viewport-metrics'
	| 'overlay'
	| 'window-events'
	| 'display-mode'
	| 'onscreen-gamepad';

export interface GameViewHostCapabilityMap {
	'viewport-metrics': ViewportMetricsProvider;
	'overlay': OverlayManager;
	'window-events': WindowEventHub;
	'display-mode': DisplayModeController;
	'onscreen-gamepad': OnscreenGamepadHandleProvider;
}

/**
 * Platform-specific delegate that surfaces rendering and window-management affordances to the engine.
 *
 * The GameView queries this host for capabilities rather than accessing global APIs directly. That
 * indirection keeps the renderer agnostic of how the host projects surfaces (DOM, native window, offscreen
 * framebuffer) while still allowing us to lean on specialised behaviour, such as onscreen gamepad handles
 * or fullscreen transitions, when the platform provides them.
 */
export interface GameViewHost {
	readonly surface: GameViewCanvas;
	createBackend(): Promise<unknown>;
	getCapability<T extends GameViewHostCapabilityId>(capability: T): GameViewHostCapabilityMap[T];
	getSize(viewportSize: vec2, canvasSize: vec2): ViewportDimensions;
	onResize(handler: (size: ViewportDimensions) => void): SubscriptionHandle;
	onFocusChange(handler: (focused: boolean) => void): SubscriptionHandle;
}

export type HttpResponse = {
	ok: boolean;
	status: number;
	statusText: string;
	text(): Promise<string>;
	json(): Promise<unknown>;
};
