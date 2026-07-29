import {
	AudioService,
	HostClock,
	FrameLoop,
	HIDService,
	InputHub,
	Lifecycle,
	LogLevel,
	OnscreenGamepadPlatform,
	Platform,
	RngService,
	StorageService,
	ClipboardService,
	VideoOutput,
	MicrotaskQueue,
	SubscriptionHandle,
	ViewportDimensions,
} from 'bmsx/platform';
import { HeadlessPlatformServices, HeadlessPlatformOptions } from '../headless/platform_headless';
import { HeadlessVideoOutput, type HeadlessPresentedFrameBuffer } from 'bmsx/render/headless/video_output';
import { new_vec2 } from 'bmsx/common/vector';
import { type vec2 } from 'bmsx/common/vector';

export class CLIVideoOutput implements VideoOutput {
	public readonly surface: HeadlessVideoOutput['surface'];
	private readonly delegate: HeadlessVideoOutput;

	constructor(initialSize = new_vec2(256, 212)) {
		this.delegate = new HeadlessVideoOutput(initialSize);
		this.surface = this.delegate.surface;
	}

	async createBackend(gxGpuVramBytes: number) {
		return this.delegate.createBackend(gxGpuVramBytes);
	}

	presentFrameBuffer(frame: HeadlessPresentedFrameBuffer): void {
		this.delegate.presentFrameBuffer(frame);
	}

	public getSize(viewportSize: vec2, canvasSize: vec2): ViewportDimensions {
		return this.delegate.getSize(viewportSize, canvasSize);
	}

	public onResize(handler: (size: ViewportDimensions) => void): SubscriptionHandle {
		return this.delegate.onResize(handler);
	}

}

export interface CLIPlatformOptions extends HeadlessPlatformOptions {
	viewportSize?: { x: number; y: number };
}

export class CLIPlatformServices implements Platform {
	readonly clock: HostClock;
	readonly frames: FrameLoop;
	readonly lifecycle: Lifecycle;
	readonly input: InputHub;
	readonly storage: StorageService;
	readonly microtasks: MicrotaskQueue;
	readonly ufpsScaled: number;
	requestShutdown(): void {
		process.exit(0);
	}
	log(level: LogLevel, message: string): void {
		switch (level) {
			case LogLevel.Debug: console.debug(message); break;
			case LogLevel.Info: console.info(message); break;
			case LogLevel.Warn: console.warn(message); break;
			case LogLevel.Error: console.error(message); break;
		}
	}
	readonly clipboard: ClipboardService;
	readonly hid: HIDService;
	readonly onscreenGamepad: OnscreenGamepadPlatform;
	readonly audio: AudioService;
	readonly rng: RngService;
	readonly videoOutput: VideoOutput;

	constructor(options: CLIPlatformOptions = {}) {
		const base = new HeadlessPlatformServices(options);
		this.clock = base.clock;
		this.frames = base.frames;
		this.lifecycle = base.lifecycle;
		this.input = base.input;
		this.storage = base.storage;
		this.microtasks = base.microtasks;
		this.ufpsScaled = base.ufpsScaled;
		this.clipboard = base.clipboard;
		this.hid = base.hid;
		this.onscreenGamepad = base.onscreenGamepad;
		this.audio = base.audio;
		this.rng = base.rng;
		const viewportSize = options.viewportSize ? new_vec2(options.viewportSize.x, options.viewportSize.y) : new_vec2(256, 212);
		this.videoOutput = new CLIVideoOutput(viewportSize);
	}
}
