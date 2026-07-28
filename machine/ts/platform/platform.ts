import { type vec2 } from 'bmsx/rompack/format';
import type { MicrotaskQueue } from '../machine/scheduler/microtask_queue';
import type { GPUBackend } from '../render/backend/backend';

export type { MicrotaskQueue } from '../machine/scheduler/microtask_queue';
export type MonoTime = number;

export const enum LogLevel {
	Debug,
	Info,
	Warn,
	Error,
}

export interface LogOutput {
	log(level: LogLevel, message: string): void;
}

export interface StorageService {
	getItem(k: string): string;
	setItem(k: string, v: string): void;
	removeItem(k: string): void;
}

/**
 * Core platform contract.
 *
 * Every host environment (desktop shell, mobile wrapper, browser runtime, etc.) wires BMSX
 * to native services by implementing this interface. The properties deliberately mirror the systems
 * the host owns at runtime: host timing (`clock`/`frames`), persistence (`storage`), audio,
 * human input, onscreen controls, and the platform-owned video target.
 *
 * The onscreen gamepad is treated as a first-class surface here: when it is enabled the machine runtime
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

let defaultMicrotaskQueueTasks: Array<() => void> = [];
let defaultMicrotaskQueueDrainTasks: Array<() => void> = [];

export const defaultMicrotaskQueue: MicrotaskQueue = {
	queueMicrotask: (task: () => void) => {
		defaultMicrotaskQueueTasks.push(task);
	},
	flush: () => {
		while (defaultMicrotaskQueueTasks.length > 0) {
			const tasks = defaultMicrotaskQueueTasks;
			defaultMicrotaskQueueTasks = defaultMicrotaskQueueDrainTasks;
			defaultMicrotaskQueueDrainTasks = tasks;
			try {
				for (let index = 0; index < defaultMicrotaskQueueDrainTasks.length; index += 1) {
					defaultMicrotaskQueueDrainTasks[index]();
				}
			} finally {
				defaultMicrotaskQueueDrainTasks.length = 0;
			}
		}
	},
};

let activeMicrotaskQueue: MicrotaskQueue = defaultMicrotaskQueue;

export function setMicrotaskQueue(queue: MicrotaskQueue): void {
	activeMicrotaskQueue = queue;
}

// disable-next-line single_line_method_pattern -- callers schedule through the active queue selected by the host composition root.
export function scheduleMicrotask(task: () => void): void {
	activeMicrotaskQueue.queueMicrotask(task);
}

export interface TimerHandle {
	cancel(): void;
	isActive(): boolean;
}

export interface HostClock {
	now(): MonoTime;
	perf_now(): MonoTime;
	dateNow(): number;
	scheduleOnce: (delay_ms: number, cb: (t: MonoTime) => void) => TimerHandle;
}

export interface FrameLoop {
	start(tick: (t: MonoTime) => void): { stop(): void };
}

export interface Platform extends LogOutput {
	clock: HostClock;
	frames: FrameLoop;
	lifecycle: Lifecycle;
	input: InputHub;
	storage: StorageService;
	microtasks: MicrotaskQueue;
	requestShutdown(): void;
	clipboard: ClipboardService;
	hid: HIDService;
	onscreenGamepad: OnscreenGamepadPlatform;
	audio: AudioService;
	rng: RngService;
	videoOutput: VideoOutput;
}

export type AudioOutputPuller = (output: Int16Array, frameCount: number, sampleRate: number) => number;

export interface AudioService {
	readonly available: boolean;
	setRuntimeAudioPuller(puller: AudioOutputPuller | null): void;
	clearRuntimeAudioTransport(): void;
	pumpRuntimeAudio(): void;
	resume(): Promise<void>;
	suspend(): Promise<void>;
	getMasterGain(): number;
	setMasterGain(v: number): void;
	setFrameTimeSec(seconds: number): void;
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
	| { type: 'button'; deviceId: string; code: string; down: boolean; value?: number; timestamp: MonoTime; pressId?: number; modifiers?: InputModifiers }
	| { type: 'supervisor-request'; down: boolean; timestamp: MonoTime }
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
	poll(clock: HostClock): void;
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
 * When the onscreen gamepad feature flag is on, the machine runtime relies on this bridge to negotiate layout
 * and to keep pointer gestures synchronised with the gameplay input hub. The implementation is expected
 * to back the controls with whatever UI primitives the host provides (HTML, native widgets, gamepad
 * texture quads, etc.) while maintaining the canonical element IDs that the machine runtime references.
 */
export interface OnscreenGamepadPlatform {
	attach(hooks: OnscreenGamepadPlatformHooks): OnscreenGamepadPlatformSession;
	getLayoutHandles(): OnscreenGamepadHandles | null;
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
	onFocusChange(cb: (focused: boolean) => void): SubscriptionHandle;
	onWillExit(cb: (event: PlatformExitEvent) => void): SubscriptionHandle;
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

export type VideoSurfaceHandle = unknown;

export interface ViewportDimensions {
	width: number;
	height: number;
	viewportScale: number;
	canvasScale: number;
}

export interface SurfaceBounds {
	width: number;
	height: number;
	left: number;
	top: number;
}

export interface VideoSurface {
	readonly handle: VideoSurfaceHandle;
	isVisible(): boolean;
	setRenderTargetSize(width: number, height: number): void;
	setDisplaySize(width: number, height: number): void;
	setDisplayPosition(left: number, top: number): void;
	measureDisplay(): SurfaceBounds;
}

/** Host-native layout controls owned by the onscreen-gamepad platform. */
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

/** Platform-owned render target and backend. */
export interface VideoOutput {
	readonly surface: VideoSurface;
	createBackend(): Promise<GPUBackend>;
	getSize(viewportSize: vec2, canvasSize: vec2): ViewportDimensions;
	onResize(handler: (size: ViewportDimensions) => void): SubscriptionHandle;
}

export type HttpResponse = {
	ok: boolean;
	status: number;
	statusText: string;
	text(): Promise<string>;
	json(): Promise<unknown>;
};
