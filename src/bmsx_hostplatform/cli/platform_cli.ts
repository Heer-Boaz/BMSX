import {
	AudioService,
	Clock,
	FrameLoop,
	HIDService,
	InputHub,
	Lifecycle,
	OnscreenGamepadPlatform,
	Platform,
	RngService,
	StorageService,
	ClipboardService,
	GameViewHost,
	ViewportMetrics,
	ViewportMetricsProvider,
	OverlayManager,
	WindowEventHub,
	DisplayModeController,
	OnscreenGamepadHandleProvider,
	GameViewHostCapabilityId,
	GameViewHostCapabilityMap,
	OnscreenGamepadHandles,
	MicrotaskQueue,
	SubscriptionHandle,
	createSubscriptionHandle,
	ViewportDimensions,
} from 'bmsx/platform';
import { HeadlessPlatformServices, HeadlessPlatformOptions } from '../headless/platform_headless';
import { HeadlessGameViewHost } from 'bmsx/render/headless/headless_view';
import { new_vec2 } from 'bmsx/utils/vector_operations';
import { type vec2 } from 'bmsx/rompack/rompack';

interface TerminalDimensions {
	columns: number;
	rows: number;
	cellWidth: number;
	cellHeight: number;
}

function readTerminalDimensions(fallback: TerminalDimensions, override?: Partial<TerminalDimensions>): TerminalDimensions {
	const stdout = typeof process !== 'undefined' ? process.stdout : null;
	const columns = override?.columns ?? (stdout && stdout.columns ? stdout.columns : fallback.columns);
	const rows = override?.rows ?? (stdout && stdout.rows ? stdout.rows : fallback.rows);
	return {
		columns,
		rows,
		cellWidth: override?.cellWidth ?? fallback.cellWidth,
		cellHeight: override?.cellHeight ?? fallback.cellHeight,
	};
}

class CLIWindowEventHub implements WindowEventHub {
	subscribe(_type: any, _listener: any, _options?: any): SubscriptionHandle {
		return createSubscriptionHandle(() => void 0);
	}
}

class CLIDisplayModeController implements DisplayModeController {
	isSupported(): boolean { return false; }
	isFullscreen(): boolean { return false; }
	async setFullscreen(_enabled: boolean): Promise<void> { }
	onChange(_listener: (isFullscreen: boolean) => void): SubscriptionHandle {
		return createSubscriptionHandle(() => void 0);
	}
}

class CLIOnscreenGamepadProvider implements OnscreenGamepadHandleProvider {
	getHandles(): OnscreenGamepadHandles { return null; }
}

export class CLIGameViewHost implements GameViewHost {
	public readonly surface: HeadlessGameViewHost['surface'];
	private readonly delegate: HeadlessGameViewHost;
	private readonly terminalDefaults: TerminalDimensions;
	private readonly terminalOverrides?: Partial<TerminalDimensions>;
	private readonly viewportCapability: ViewportMetricsProvider;
	private readonly overlayCapability: OverlayManager;
	private readonly windowEventHub = new CLIWindowEventHub();
	private readonly displayMode = new CLIDisplayModeController();
	private readonly gamepadProvider = new CLIOnscreenGamepadProvider();

	constructor(initialSize = new_vec2(256, 212), overrideDimensions?: Partial<TerminalDimensions>) {
		this.delegate = new HeadlessGameViewHost(initialSize);
		this.surface = this.delegate.surface;
		this.terminalDefaults = { columns: 80, rows: 24, cellWidth: 8, cellHeight: 16 };
		this.terminalOverrides = overrideDimensions;
		this.viewportCapability = { getViewportMetrics: () => this.computeMetrics() };
		this.overlayCapability = this.delegate.getCapability('overlay');
	}

	async createBackend(): Promise<unknown> {
		return this.delegate.createBackend();
	}

	getCapability<T extends GameViewHostCapabilityId>(capability: T): GameViewHostCapabilityMap[T] {
		switch (capability) {
			case 'viewport-metrics':
				return this.viewportCapability as GameViewHostCapabilityMap[T];
			case 'overlay':
				return this.overlayCapability as GameViewHostCapabilityMap[T];
			case 'window-events':
				return this.windowEventHub as GameViewHostCapabilityMap[T];
			case 'display-mode':
				return this.displayMode as GameViewHostCapabilityMap[T];
			case 'onscreen-gamepad':
				return this.gamepadProvider as GameViewHostCapabilityMap[T];
			default:
				return null;
		}
	}

	private computeMetrics(): ViewportMetrics {
		const dims = readTerminalDimensions(this.terminalDefaults, this.terminalOverrides);
		const width = dims.columns * dims.cellWidth;
		const height = dims.rows * dims.cellHeight;
		return {
			document: { width, height },
			windowInner: { width, height },
			screen: { width, height },
			visible: { width, height, offsetTop: 0, offsetLeft: 0 },
		};
	}

	public getSize(viewportSize: vec2, canvasSize: vec2): ViewportDimensions {
		return this.delegate.getSize(viewportSize, canvasSize);
	}

	public onResize(handler: (size: ViewportDimensions) => void): SubscriptionHandle {
		return this.delegate.onResize(handler);
	}

	public onFocusChange(handler: (focused: boolean) => void): SubscriptionHandle {
		return this.delegate.onFocusChange(handler);
	}
}

export interface CLIPlatformOptions extends HeadlessPlatformOptions {
	terminal?: Partial<TerminalDimensions>;
	viewportSize?: { x: number; y: number };
}

export class CLIPlatformServices implements Platform {
	readonly clock: Clock;
	readonly frames: FrameLoop;
	readonly lifecycle: Lifecycle;
	readonly input: InputHub;
	readonly storage: StorageService;
	readonly microtasks: MicrotaskQueue;
	requestShutdown(): void {
		process.exit(0);
	}
	readonly clipboard: ClipboardService;
	readonly hid: HIDService;
	readonly onscreenGamepad: OnscreenGamepadPlatform;
	readonly audio: AudioService;
	readonly rng: RngService;
	readonly gameviewHost: GameViewHost;

	constructor(options: CLIPlatformOptions = {}) {
		const base = new HeadlessPlatformServices(options);
		this.clock = base.clock;
		this.frames = base.frames;
		this.lifecycle = base.lifecycle;
		this.input = base.input;
		this.storage = base.storage;
		this.microtasks = base.microtasks;
		this.clipboard = base.clipboard;
		this.hid = base.hid;
		this.onscreenGamepad = base.onscreenGamepad;
		this.audio = base.audio;
		this.rng = base.rng;
		const viewportSize = options.viewportSize ? new_vec2(options.viewportSize.x, options.viewportSize.y) : new_vec2(256, 212);
		this.gameviewHost = new CLIGameViewHost(viewportSize, options.terminal);
	}
}
