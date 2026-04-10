import { new_vec2 } from 'bmsx/utils/vector_operations';
import {
	AudioClipHandle,
	AudioFilterParams,
	AudioPlaybackParams,
	AudioService,
	Clock,
	DeviceKind,
	FrameLoop,
	HIDService,
	InputDevice,
	InputEvt,
	InputHub,
	Lifecycle,
	MonoTime,
	OnscreenGamepadPlatform,
	OnscreenGamepadPlatformHooks,
	OnscreenGamepadPlatformSession,
	Platform,
	StorageService,
	MicrotaskQueue,
	defaultMicrotaskQueue,
	ClipboardService,
	ClipboardPermissionState,
	VibrationParams,
	RngService,
	PlatformExitEvent,
	PlatformHIDDevice,
	PlatformHIDDeviceRequestOptions,
	WindowEventHub,
	HostWindowEventType,
	HostEventListenerTarget,
	HostEventOptions,
	GameViewHostCapabilityId,
	GameViewHostCapabilityMap,
	SubscriptionHandle,
	VoiceHandle,
	createSubscriptionHandle,
	HZ_SCALE,
} from 'bmsx/platform';
import { HeadlessGameViewHost } from 'bmsx/render/headless/headless_view';

class RealtimeHeadlessClock implements Clock {
	private readonly origin = performance.now();
	public scheduleOnce(delayMs: number, cb: (t: MonoTime) => void) {
		let active = true;
		const handle = setTimeout(() => {
			if (!active) return;
			active = false;
			cb(this.now());
		}, delayMs);
		return {
			cancel: () => {
				if (!active) return;
				active = false;
				clearTimeout(handle);
			},
			isActive: () => active,
		};
	}
	now(): MonoTime {
		return performance.now() - this.origin;
	}

	perf_now(): MonoTime {
		return this.now();
	}

	dateNow(): number {
		return Date.now();
	}
}

type VirtualTimer = {
	dueMs: number;
	cb: (t: MonoTime) => void;
	active: boolean;
};

class VirtualHeadlessClock implements Clock {
	private currentMs = 0;
	private readonly epochMs = Date.now();
	private readonly timers: VirtualTimer[] = [];

	public scheduleOnce(delayMs: number, cb: (t: MonoTime) => void) {
		const timer: VirtualTimer = {
			dueMs: this.currentMs + delayMs,
			cb,
			active: true,
		};
		this.timers.push(timer);
		return {
			cancel: () => {
				timer.active = false;
			},
			isActive: () => timer.active,
		};
	}

	public advance(stepMs: number): void {
		this.currentMs += stepMs;
		for (;;) {
			let dueIndex = -1;
			let dueMs = Infinity;
			for (let i = 0; i < this.timers.length; i += 1) {
				const timer = this.timers[i]!;
				if (!timer.active || timer.dueMs > this.currentMs) {
					continue;
				}
				if (timer.dueMs < dueMs) {
					dueMs = timer.dueMs;
					dueIndex = i;
				}
			}
			if (dueIndex < 0) {
				break;
			}
			const [timer] = this.timers.splice(dueIndex, 1);
			if (!timer || !timer.active) {
				continue;
			}
			timer.active = false;
			timer.cb(this.currentMs);
		}
		if (this.timers.length > 0) {
			let writeIndex = 0;
			for (let readIndex = 0; readIndex < this.timers.length; readIndex += 1) {
				const timer = this.timers[readIndex]!;
				if (!timer.active) {
					continue;
				}
				this.timers[writeIndex] = timer;
				writeIndex += 1;
			}
			this.timers.length = writeIndex;
		}
	}

	now(): MonoTime {
		return this.currentMs;
	}

	perf_now(): MonoTime {
		return this.currentMs;
	}

	dateNow(): number {
		return this.epochMs + Math.round(this.currentMs);
	}
}

class RealtimeHeadlessFrameLoop implements FrameLoop {
	constructor(private readonly clock: Clock, private readonly stepMs: number) { }
	start(tick: (t: MonoTime) => void): { stop(): void } {
		let active = true;
		const handle = setInterval(() => {
			if (!active) return;
			tick(this.clock.now());
		}, this.stepMs);
		return {
			stop: () => {
				if (!active) return;
				active = false;
				clearInterval(handle);
			},
		};
	}
}

class UnpacedHeadlessFrameLoop implements FrameLoop {
	constructor(private readonly clock: VirtualHeadlessClock, private readonly stepMs: number) { }

	start(tick: (t: MonoTime) => void): { stop(): void } {
		let active = true;
		const pump = (): void => {
			if (!active) {
				return;
			}
			this.clock.advance(this.stepMs);
			tick(this.clock.now());
			setImmediate(pump);
		};
		setImmediate(pump);
		return {
			stop: () => {
				active = false;
			},
		};
	}
}

class HeadlessLifecycle implements Lifecycle {
	private readonly exitHandlers = new Set<(event: PlatformExitEvent) => void>();
	private exitHooksAttached = false;

	onVisibilityChange(_cb: (visible: boolean) => void): SubscriptionHandle {
		return createSubscriptionHandle(() => void 0);
	}

	onWillExit(cb: (event: PlatformExitEvent) => void): SubscriptionHandle {
		this.exitHandlers.add(cb);
		this.attachExitHooks();
		return createSubscriptionHandle(() => {
			this.exitHandlers.delete(cb);
		});
	}

	private attachExitHooks(): void {
		if (this.exitHooksAttached) {
			return;
		}
		this.exitHooksAttached = true;
		const dispatch = (_source: string): boolean => {
			if (this.exitHandlers.size === 0) {
				return false;
			}
			let prevented = false;
			const event: PlatformExitEvent = {
				preventDefault: () => { prevented = true; },
				setReturnMessage: () => { },
			};
			for (const handler of Array.from(this.exitHandlers)) {
				handler(event);
			}
			return prevented;
		};
		process.once('beforeExit', () => {
			dispatch('beforeExit');
		});
		process.once('SIGINT', () => {
			const prevented = dispatch('SIGINT');
			if (!prevented) {
				process.exit(130);
			}
		});
		process.once('SIGTERM', () => {
			const prevented = dispatch('SIGTERM');
			if (!prevented) {
				process.exit(143);
			}
		});
	}
}

class MemoryStorage implements StorageService {
	private readonly store = new Map<string, string>();
	getItem(k: string): string {
		return this.store.has(k) ? this.store.get(k)! : null;
	}
	setItem(k: string, v: string): void {
		this.store.set(k, v);
	}
	removeItem(k: string): void {
		this.store.delete(k);
	}
}

class HeadlessClipboardService implements ClipboardService {
	private readonly writeState: ClipboardPermissionState = ClipboardPermissionState.Granted;

	isSupported(): boolean {
		return true;
	}

	async writeText(text: string): Promise<void> {
		void text;
	}

	getWritePermissionState(): ClipboardPermissionState {
		return this.writeState;
	}

	async requestWritePermission(): Promise<ClipboardPermissionState> {
		return this.writeState;
	}
}

class UnsupportedHID implements HIDService {
	isSupported(): boolean { return false; }
	async requestDevice(_options: PlatformHIDDeviceRequestOptions): Promise<PlatformHIDDevice[]> { throw new Error('HID not supported in headless mode'); }
	async getDevices(): Promise<PlatformHIDDevice[]> { return []; }
}

class HeadlessInputDevice implements InputDevice {
	constructor(public readonly id: string, public readonly kind: DeviceKind) { }
	description = 'headless-input';
	supportsVibration = false;
	setVibration(_p: VibrationParams): void { }
	poll(_clock: Clock): void { }
}

class HeadlessInputHub implements InputHub {
	private readonly subscribers = new Set<(e: InputEvt) => void>();
	private readonly devicesList: InputDevice[] = [
		new HeadlessInputDevice('keyboard:0', 'keyboard'),
		new HeadlessInputDevice('virtual:0', 'virtual'),
	];
	subscribe(fn: (e: InputEvt) => void): SubscriptionHandle {
		this.subscribers.add(fn);
		return createSubscriptionHandle(() => { this.subscribers.delete(fn); });
	}
	post(e: InputEvt): void {
		for (const fn of this.subscribers) fn(e);
	}
	devices(): InputDevice[] {
		return this.devicesList;
	}
	setKeyboardCapture(_handler: (code: string) => boolean): void { }
}

class NullOnscreenSession implements OnscreenGamepadPlatformSession {
	dispose(): void { }
}

class HeadlessOnscreenGamepadPlatform implements OnscreenGamepadPlatform {
	attach(_hooks: OnscreenGamepadPlatformHooks): OnscreenGamepadPlatformSession {
		return new NullOnscreenSession();
	}
	hideElements(_elementIds: string[]): void { }
	collectElementIds(_x: number, _y: number, _kind: 'dpad' | 'action'): string[] { return []; }
	setElementActive(_elementId: string, _active: boolean): void { }
	resetElements(_elementIds: string[]): void { }
	updateDpadRing(_activeElementIds: string[]): void { }
	supportsVibration(): boolean { return false; }
	vibrate(_durationMs: number): void { }
}

class SilentClip implements AudioClipHandle {
	duration = 0;
	dispose(): void { }
}

class SilentVoice implements VoiceHandle {
	readonly startedAt = 0;
	readonly startOffset = 0;
	private readonly endListeners = new Set<(e: { clippedAt: number; }) => void>();
	onEnded(cb: (e: { clippedAt: number; }) => void): SubscriptionHandle {
		this.endListeners.add(cb);
		return createSubscriptionHandle(() => { this.endListeners.delete(cb); });
	}
	setGainLinear(_v: number): void { }
	rampGainLinear(_target: number, _durationSec: number): void { }
	setFilter(_p: AudioFilterParams): void { }
	setRate(_v: number): void { }
	stop(): void {
		for (const cb of this.endListeners) cb({ clippedAt: 0 });
		this.endListeners.clear();
	}
	disconnect(): void { }
}

class SilentAudioService implements AudioService {
	readonly available = false;
	currentTime(): number { return 0; }
	sampleRate(): number { return 44100; }
	coreQueuedFrames(): number { return 0; }
	setCoreNeedHandler(_handler: (() => void) | null): void { }
	clearCoreStream(): void { }
	async resume(): Promise<void> { }
	async suspend(): Promise<void> { }
	getMasterGain(): number { return 0; }
	setMasterGain(_v: number): void { }
	setFrameTimeSec(_seconds: number): void { }
	async createClipFromBytes(_bytes: ArrayBuffer): Promise<AudioClipHandle> {
		return new SilentClip();
	}
	pushCoreFrames(_samples: Int16Array, _channels: number, _sampleRate: number): void { }
	createClipFromPcm(_samples: Int16Array, _sampleRate: number, _channels: number): AudioClipHandle {
		return new SilentClip();
	}
	createVoice(_clip: AudioClipHandle, _params: AudioPlaybackParams): VoiceHandle {
		return new SilentVoice();
	}
}

class SeededRng implements RngService {
	private state: number;
	constructor(seed: number) {
		this.state = seed >>> 0 || 0x6d2b79f5;
	}
	next(): number {
		let x = this.state += 0x6d2b79f5;
		x = (x ^ (x >>> 15)) * (x | 1);
		x ^= x + ((x ^ (x >>> 7)) * (x | 61));
		return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
	}
	seed(value: number): void {
		this.state = value >>> 0 || 0x6d2b79f5;
	}
}

export interface HeadlessPlatformOptions {
	frameIntervalMs?: number;
	rngSeed?: number;
	unpaced?: boolean;
}

class NoopWindowEventHub implements WindowEventHub {
	subscribe(_type: HostWindowEventType, _listener: HostEventListenerTarget, _options?: HostEventOptions): SubscriptionHandle {
		return createSubscriptionHandle(() => void 0);
	}
}

class HeadlessGameViewHostWithWindowEvents extends HeadlessGameViewHost {
	private readonly windowEvents = new NoopWindowEventHub();

	override getCapability<T extends GameViewHostCapabilityId>(capability: T): GameViewHostCapabilityMap[T] {
		if (capability === 'window-events') {
			return this.windowEvents as GameViewHostCapabilityMap[T];
		}
		return super.getCapability(capability);
	}
}

export class HeadlessPlatformServices implements Platform {
	readonly clock: Clock;
	readonly frames: FrameLoop;
	readonly lifecycle: Lifecycle;
	readonly input: InputHub;
	readonly storage: StorageService;
	readonly microtasks: MicrotaskQueue;
	readonly ufpsScaled: number;
	requestShutdown(): void {
		process.exit(0);
	}
	readonly clipboard: ClipboardService;
	readonly hid: HIDService;
	readonly onscreenGamepad: OnscreenGamepadPlatform;
	readonly audio: AudioService;
	readonly rng: RngService;
	readonly gameviewHost: HeadlessGameViewHost;

	constructor(options: HeadlessPlatformOptions = {}) {
		const step = options.frameIntervalMs ?? 20;
		this.ufpsScaled = Math.round((1000 / step) * HZ_SCALE);
		if (options.unpaced) {
			const clock = new VirtualHeadlessClock();
			this.clock = clock;
			this.frames = new UnpacedHeadlessFrameLoop(clock, step);
		} else {
			this.clock = new RealtimeHeadlessClock();
			this.frames = new RealtimeHeadlessFrameLoop(this.clock, step);
		}
		this.lifecycle = new HeadlessLifecycle();
		this.input = new HeadlessInputHub();
		this.storage = new MemoryStorage();
		this.microtasks = defaultMicrotaskQueue;
		this.clipboard = new HeadlessClipboardService();
		this.hid = new UnsupportedHID();
		this.onscreenGamepad = new HeadlessOnscreenGamepadPlatform();
		this.audio = new SilentAudioService();
		this.rng = new SeededRng(options.rngSeed ?? this.clock.now());
		this.gameviewHost = new HeadlessGameViewHostWithWindowEvents(new_vec2(256, 212));
	}
}
