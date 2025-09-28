import type { color_arr, RomImgAsset, RomPack } from '../../rompack/rompack';
import {
	AudioClipHandle,
	AudioPlaybackParams,
	AudioService,
	VoiceHandle,
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
	PlatformServices,
	StorageService,
	TextureSource,
	TextureSourceLoader,
	VibrationParams,
 	RngService,
} from '../../core/platform';
import type { GameViewCanvas } from '../../render/platform/gameview_host';
import type { BackendCreateResult } from '../../render/backend/backend_selector';
import { HeadlessGPUBackend } from '../../render/headless/headless_backend';

class HeadlessClock implements Clock {
	private readonly origin = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
	now(): MonoTime {
		const base = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
		return base - this.origin;
	}
}

class HeadlessFrameLoop implements FrameLoop {
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

class HeadlessLifecycle implements Lifecycle {
	onVisibilityChange(_cb: (visible: boolean) => void): () => void {
		return () => void 0;
	}
	onWillExit(_cb: (event: BeforeUnloadEvent) => void): () => void {
		return () => void 0;
	}
}

class MemoryStorage implements StorageService {
	private readonly store = new Map<string, string>();
	getItem(k: string): string | null {
		return this.store.has(k) ? this.store.get(k)! : null;
	}
	setItem(k: string, v: string): void {
		this.store.set(k, v);
	}
	removeItem(k: string): void {
		this.store.delete(k);
	}
}

class UnsupportedHID implements HIDService {
	isSupported(): boolean { return false; }
	async requestDevice(): Promise<HIDDevice[]> { throw new Error('HID not supported in headless mode'); }
	async getDevices(): Promise<HIDDevice[]> { return []; }
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
	private readonly devicesList: InputDevice[] = [new HeadlessInputDevice('virtual:0', 'virtual')];
	subscribe(fn: (e: InputEvt) => void): () => void {
		this.subscribers.add(fn);
		return () => { this.subscribers.delete(fn); };
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
	hideElements(): void { }
	collectElementIds(): string[] { return []; }
	setElementActive(): void { }
	resetElements(): void { }
	updateDpadRing(): void { }
	supportsVibration(): boolean { return false; }
	vibrate(_durationMs: number): void { }
}

class HeadlessTextureSourceLoader implements TextureSourceLoader {
	private async toImageBitmap(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<ImageBitmap> {
		if (typeof createImageBitmap !== 'function') {
			return { width: canvas.width, height: canvas.height } as unknown as ImageBitmap;
		}
		if ('convertToBlob' in canvas && typeof (canvas as OffscreenCanvas).convertToBlob === 'function') {
			const blob = await (canvas as OffscreenCanvas).convertToBlob();
			return await createImageBitmap(blob);
		}
		return await createImageBitmap(canvas as HTMLCanvasElement);
	}

	private makeCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
		if (typeof OffscreenCanvas !== 'undefined') {
			return new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
		}
		if (typeof document !== 'undefined') {
			const canvas = document.createElement('canvas');
			canvas.width = Math.max(1, width);
			canvas.height = Math.max(1, height);
			return canvas;
		}
		const fallback = { width: Math.max(1, width), height: Math.max(1, height) } as HTMLCanvasElement;
		return fallback;
	}

	private async makeSolidBitmap(size: number, color: color_arr = [0, 0, 0, 255]): Promise<ImageBitmap> {
		const canvas = this.makeCanvas(size, size);
		const ctx = (canvas as any).getContext ? (canvas as any).getContext('2d') : null;
		if (ctx) {
			const [r, g, b, a] = color;
			const rgba = `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a <= 1 ? a : Math.round(a) / 255})`;
			ctx.fillStyle = rgba;
			ctx.fillRect(0, 0, size, size);
		}
		return await this.toImageBitmap(canvas);
	}

	async fromUri(uri: string): Promise<TextureSource> {
		console.warn(`[HeadlessTextureSourceLoader] Substituting texture for URI '${uri}' in headless mode.`);
		return await this.makeSolidBitmap(2, [128, 128, 128, 255]);
	}

	async fromBytes(_bytes: ArrayBuffer): Promise<TextureSource> {
		return await this.makeSolidBitmap(2, [64, 64, 64, 255]);
	}

	async createSolid(size: number, color: color_arr): Promise<TextureSource> {
		return await this.makeSolidBitmap(Math.max(1, size), color);
	}

	async fromBuffer(_uri: string, _buffer?: ArrayBuffer): Promise<TextureSource> {
		return await this.makeSolidBitmap(2, [96, 96, 96, 255]);
	}

	async fromAsset(_romImgAsset: RomImgAsset, _rompack: RomPack): Promise<TextureSource> {
		return await this.makeSolidBitmap(2, [160, 160, 160, 255]);
	}
}

class SilentClip implements AudioClipHandle {
	duration = 0;
	dispose(): void { }
}

class SilentVoice implements VoiceHandle {
	readonly startedAt = 0;
	readonly startOffset = 0;
	private readonly endListeners = new Set<(e: { clippedAt: number; }) => void>();
	onEnded(cb: (e: { clippedAt: number; }) => void): () => void {
		this.endListeners.add(cb);
		return () => { this.endListeners.delete(cb); };
	}
	setGainLinear(_v: number): void { }
	rampGainLinear(_target: number, _durationSec: number): void { }
	setFilter(): void { }
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
	async resume(): Promise<void> { }
	async suspend(): Promise<void> { }
	getMasterGain(): number { return 0; }
	setMasterGain(_v: number): void { }
	async decode(_bytes: ArrayBuffer): Promise<AudioClipHandle> {
		return new SilentClip();
	}
	createVoice(_clip: AudioClipHandle, _params: AudioPlaybackParams): SilentVoice {
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
}

export class HeadlessPlatformServices implements PlatformServices {
	readonly clock: Clock;
	readonly frames: FrameLoop;
	readonly lifecycle: Lifecycle;
	readonly input: InputHub;
	readonly storage: StorageService;
	readonly hid: HIDService;
	readonly onscreenGamepad: OnscreenGamepadPlatform;
	readonly textureLoader: TextureSourceLoader;
	readonly audio: AudioService;
	readonly rng: RngService;

	constructor(options: HeadlessPlatformOptions = {}) {
		const step = options.frameIntervalMs ?? 20;
		this.clock = new HeadlessClock();
		this.frames = new HeadlessFrameLoop(this.clock, step);
		this.lifecycle = new HeadlessLifecycle();
		this.input = new HeadlessInputHub();
		this.storage = new MemoryStorage();
		this.hid = new UnsupportedHID();
		this.onscreenGamepad = new HeadlessOnscreenGamepadPlatform();
		this.textureLoader = new HeadlessTextureSourceLoader();
		this.audio = new SilentAudioService();
		this.rng = new SeededRng(options.rngSeed ?? Date.now());
	}

	async createBackendForSurface(_surface: GameViewCanvas): Promise<BackendCreateResult> {
		return { backend: new HeadlessGPUBackend(), nativeCtx: null };
	}
}
