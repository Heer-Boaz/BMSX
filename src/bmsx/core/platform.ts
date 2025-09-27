import type { color_arr, RomImgAsset, RomPack } from '../../bmsx/rompack/rompack';

export type MonoTime = number;

export interface Clock { now(): MonoTime; }

export interface FrameLoop {
	start(tick: (t: MonoTime) => void): { stop(): void };
}

export type TextureSource = any;

export interface TextureSourceLoader {
	fromUri(uri: string): Promise<TextureSource>;
	fromBytes(bytes: ArrayBuffer): Promise<TextureSource>;
	createSolid(size: number, color: color_arr): Promise<TextureSource>;
	fromBuffer(uri: string, buffer?: ArrayBuffer): Promise<TextureSource>;
	fromAsset(romImgAsset: RomImgAsset, rompack: RomPack, options?: { flipY?: boolean; }): Promise<TextureSource>;
}

// --------- AUDIO TYPES (platform-level, engine-agnostic) ---------

export type AudioChannel = 'sfx' | 'music' | 'ui';

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

export interface PlatformServices {
	clock: Clock;
	frames: FrameLoop;
	lifecycle: Lifecycle;
	input: InputHub;
	storage: StorageService;
	hid: HIDService;
	onscreenGamepad: OnscreenGamepadPlatform;
	textureLoader: TextureSourceLoader;
	audio: AudioService;
	rng: RngService;
}

export class Platform {
	private static svc: PlatformServices | null = null;

	static initialize(services: PlatformServices): void {
		if (Platform.svc) throw new Error('Platform already initialized');
		Platform.svc = services;
	}

	static get instance(): PlatformServices {
		if (!Platform.svc) throw new Error('Platform not initialized');
		return Platform.svc;
	}

	static get isInitialized(): boolean {
		return !!Platform.svc;
	}
}
