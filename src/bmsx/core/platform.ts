import type { TextureSourceLoader } from '../render/texturesource';

export type MonoTime = number;

export interface Clock { now(): MonoTime; }

export interface FrameLoop {
	start(tick: (t: MonoTime) => void): { stop(): void };
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

export interface PlatformServices {
	clock: Clock;
	frames: FrameLoop;
	lifecycle: Lifecycle;
	input: InputHub;
	storage: StorageService;
	hid: HIDService;
	onscreenGamepad: OnscreenGamepadPlatform;
	textureLoader: TextureSourceLoader;
}

export class Platform {
	private static svc: PlatformServices | null = null;

	static initialize(services: PlatformServices): void {
		if (Platform.svc !== null) throw new Error('Platform already initialized');
		Platform.svc = services;
	}

	static get instance(): PlatformServices {
		if (Platform.svc === null) throw new Error('Platform not initialized');
		return Platform.svc;
	}

	static get isInitialized(): boolean {
		return Platform.svc !== null;
	}
}
