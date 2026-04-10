import type { vec2 } from '../../rompack/rompack';
import type {
	GameViewHost,
	GameViewCanvas,
	ViewportMetrics,
	OverlayHandle,
	ViewportMetricsProvider,
	OverlayManager,
	OnscreenGamepadHandleProvider,
	DisplayModeController,
	GameViewHostCapabilityId,
	GameViewHostCapabilityMap,
	WindowEventHub,
	HostWindowEventType,
	HostEventListenerTarget,
	HostEventOptions,
	SubscriptionHandle,
	ViewportDimensions,
} from '../../platform';
import { createSubscriptionHandle } from '../../platform';
import { HeadlessGPUBackend } from './headless_backend';
import { HeadlessPresentSurface } from './headless_present_surface';

export interface HeadlessPresentedFrameBuffer {
	pixels: Uint8Array;
	srcWidth: number;
	srcHeight: number;
	dstWidth: number;
	dstHeight: number;
}

export interface HeadlessPresentedFrame {
	frameIndex: number;
	width: number;
	height: number;
}

export interface HeadlessPresentHost {
	presentFrameBuffer(frame: HeadlessPresentedFrameBuffer): void;
}

class HeadlessOverlay implements OverlayHandle {
	private readonly classes = new Set<string>();

	setText(_text: string): void {
	}
	addClass(className: string): void {
		this.classes.add(className);
	}
	removeClass(className: string): void {
		this.classes.delete(className);
	}
	onAnimationEnd(callback: () => void): void {
		callback();
	}
	forceReflow(): void { }
	remove(): void { }
}

class HeadlessGameViewCanvas implements GameViewCanvas {
	public readonly handle: unknown = {};
	private renderWidth: number;
	private renderHeight: number;

	constructor(initialSize: vec2) {
		this.renderWidth = initialSize.x;
		this.renderHeight = initialSize.y;
	}

	isVisible(): boolean { return true; }
	setRenderTargetSize(width: number, height: number): void {
		this.renderWidth = width;
		this.renderHeight = height;
	}
	setDisplaySize(_width: number, _height: number): void { }
	setDisplayPosition(_left: number, _top: number): void { }
	measureDisplay(): { width: number; height: number; left: number; top: number; } {
		return { width: this.renderWidth, height: this.renderHeight, left: 0, top: 0 };
	}
	requestWebGL2Context(_attributes: WebGLContextAttributes): WebGL2RenderingContext {
		throw new Error('[HeadlessGameViewCanvas] WebGL2 context is not available in headless mode.');
	}
	requestWebGPUContext(): GPUCanvasContext {
		throw new Error('[HeadlessGameViewCanvas] WebGPU context is not available in headless mode.');
	}
}

class HeadlessWindowEventHub implements WindowEventHub {
	subscribe(_type: HostWindowEventType, _listener: HostEventListenerTarget, _options?: HostEventOptions): SubscriptionHandle {
		return createSubscriptionHandle(() => void 0);
	}
}

class HeadlessDisplayModeController implements DisplayModeController {
	isSupported(): boolean {
		return false;
	}

	isFullscreen(): boolean {
		return false;
	}

	async setFullscreen(_enabled: boolean): Promise<void> { }

	onChange(_listener: (isFullscreen: boolean) => void): SubscriptionHandle {
		return createSubscriptionHandle(() => void 0);
	}
}

export class HeadlessGameViewHost implements GameViewHost {
	public readonly surface: HeadlessGameViewCanvas;
	private readonly overlays = new Map<string, HeadlessOverlay>();
	private readonly presentedFrameListeners = new Set<(frame: HeadlessPresentedFrame) => void>();
	private readonly presentSurface = new HeadlessPresentSurface();
	private presentedFrameIndex = 0;
	private readonly viewportCapability: ViewportMetricsProvider;
	private readonly overlayCapability: OverlayManager;
	private readonly gamepadCapability: OnscreenGamepadHandleProvider;
	private readonly windowEventCapability: WindowEventHub;
	private readonly displayModeCapability: DisplayModeController;

	constructor(initialSize: vec2) {
		this.surface = new HeadlessGameViewCanvas(initialSize);
		this.viewportCapability = {
			getViewportMetrics: (): ViewportMetrics => {
				const bounds = this.surface.measureDisplay();
				return {
					document: { width: bounds.width, height: bounds.height },
					windowInner: { width: bounds.width, height: bounds.height },
					screen: { width: bounds.width, height: bounds.height },
					visible: { width: bounds.width, height: bounds.height, offsetTop: 0, offsetLeft: 0 },
				};
			},
		};
		this.overlayCapability = {
			ensureOverlay: (id: string): OverlayHandle => {
				let overlay = this.overlays.get(id);
				if (!overlay) {
					overlay = new HeadlessOverlay();
					this.overlays.set(id, overlay);
				}
				return overlay;
			},
			getOverlay: (id: string): OverlayHandle => this.overlays.get(id) as OverlayHandle,
		};
		this.gamepadCapability = {
			getHandles: () => null,
		};
		this.windowEventCapability = new HeadlessWindowEventHub();
		this.displayModeCapability = new HeadlessDisplayModeController();
	}

	getCapability<T extends GameViewHostCapabilityId>(capability: T): GameViewHostCapabilityMap[T] {
		switch (capability) {
			case 'viewport-metrics':
				return this.viewportCapability as GameViewHostCapabilityMap[T];
			case 'overlay':
				return this.overlayCapability as GameViewHostCapabilityMap[T];
			case 'onscreen-gamepad':
				return this.gamepadCapability as GameViewHostCapabilityMap[T];
			case 'window-events':
				return this.windowEventCapability as GameViewHostCapabilityMap[T];
			case 'display-mode':
				return this.displayModeCapability as GameViewHostCapabilityMap[T];
			default:
				throw new Error(`[HeadlessGameViewHost] Unknown capability '${String(capability)}'.`);
		}
	}

	async createBackend(): Promise<HeadlessGPUBackend> {
		return new HeadlessGPUBackend();
	}

	public presentFrameBuffer(frame: HeadlessPresentedFrameBuffer): void {
		this.presentSurface.present2D(frame.pixels, frame.srcWidth, frame.srcHeight, frame.dstWidth, frame.dstHeight);
		const presentedFrame: HeadlessPresentedFrame = {
			frameIndex: this.presentedFrameIndex,
			width: frame.dstWidth,
			height: frame.dstHeight,
		};
		this.presentedFrameIndex += 1;
		for (const listener of this.presentedFrameListeners) {
			listener(presentedFrame);
		}
	}

	public addPresentedFrameListener(listener: (frame: HeadlessPresentedFrame) => void): SubscriptionHandle {
		this.presentedFrameListeners.add(listener);
		return createSubscriptionHandle(() => {
			this.presentedFrameListeners.delete(listener);
		});
	}

	public getPresentedFrameSnapshot(): HeadlessPresentedFrame | null {
		if (this.presentedFrameIndex <= 0 || this.presentSurface.width <= 0 || this.presentSurface.height <= 0) {
			return null;
		}
		return {
			frameIndex: this.presentedFrameIndex - 1,
			width: this.presentSurface.width,
			height: this.presentSurface.height,
		};
	}

	public copyPresentedFramePixels(): Uint8Array {
		return this.presentSurface.copyPixels();
	}

	public get presentedFrameWidth(): number {
		return this.presentSurface.width;
	}

	public get presentedFrameHeight(): number {
		return this.presentSurface.height;
	}

	public getSize(viewportSize: vec2, canvasSize: vec2): ViewportDimensions {
		const bounds = this.surface.measureDisplay();
		return {
			width: bounds.width,
			height: bounds.height,
			viewportScale: Math.min(bounds.width / viewportSize.x, bounds.height / viewportSize.y),
			canvasScale: Math.min(bounds.width / canvasSize.x, bounds.height / canvasSize.y),
		};
	}

	public onResize(_handler: (size: ViewportDimensions) => void): SubscriptionHandle {
		return createSubscriptionHandle(() => void 0);
	}

	public onFocusChange(_handler: (focused: boolean) => void): SubscriptionHandle {
		return createSubscriptionHandle(() => void 0);
	}
}
