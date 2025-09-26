export type MonoTime = number;

export interface Clock { now(): MonoTime; }

export interface FrameLoop {
	start(tick: (t: MonoTime) => void): { stop(): void };
}

export type DeviceKind = 'keyboard' | 'gamepad' | 'pointer' | 'touch' | 'virtual';

export interface VibrationParams { effect: 'dual-rumble'; duration: number; intensity: number; }

export type InputEvt =
	| { type: 'button'; deviceId: string; code: string; down: boolean; value: number; timestamp: MonoTime; pressId: number | null }
	| { type: 'axis1'; deviceId: string; code: string; x: number; timestamp: MonoTime }
	| { type: 'axis2'; deviceId: string; code: string; x: number; y: number; timestamp: MonoTime }
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
