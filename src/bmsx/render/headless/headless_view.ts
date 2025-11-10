import type { vec2 } from '../../rompack/rompack';
import type {
	GameViewHost,
	GameViewCanvas,
	ViewportMetrics,
	OverlayHandle,
	ViewportMetricsProvider,
	OverlayManager,
	OnscreenGamepadHandleProvider,
	GameViewHostCapabilityId,
	GameViewHostCapabilityMap,
	WindowEventHub,
} from '../../platform';
import { HeadlessGPUBackend } from './headless_backend';

class HeadlessOverlay implements OverlayHandle {
	setText(_text: string): void { }
	addClass(_className: string): void { }
	removeClass(_className: string): void { }
	onAnimationEnd(_callback: () => void): void { }
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
	requestWebGL2Context(_attributes: WebGLContextAttributes): WebGL2RenderingContext | null { return null; }
	requestWebGPUContext(): GPUCanvasContext | null { return null; }
}

class HeadlessWindowEventHub implements WindowEventHub {
	subscribe(): () => void {
		return () => void 0;
	}
}

export class HeadlessGameViewHost implements GameViewHost {
	public readonly surface: HeadlessGameViewCanvas;
	private readonly overlays = new Map<string, HeadlessOverlay>();
	private readonly viewportCapability: ViewportMetricsProvider;
	private readonly overlayCapability: OverlayManager;
	private readonly gamepadCapability: OnscreenGamepadHandleProvider;
	private readonly windowEventCapability: WindowEventHub;

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
			getOverlay: (id: string): OverlayHandle | null => this.overlays.get(id) ?? null,
		};
		this.gamepadCapability = {
			getHandles: () => null,
		};
		this.windowEventCapability = new HeadlessWindowEventHub();
	}

	getCapability<T extends GameViewHostCapabilityId>(capability: T): GameViewHostCapabilityMap[T] | null {
		switch (capability) {
			case 'viewport-metrics':
				return this.viewportCapability as GameViewHostCapabilityMap[T];
			case 'overlay':
				return this.overlayCapability as GameViewHostCapabilityMap[T];
			case 'onscreen-gamepad':
				return this.gamepadCapability as GameViewHostCapabilityMap[T];
			case 'window-events':
				return this.windowEventCapability as GameViewHostCapabilityMap[T];
			default:
				return null;
		}
	}

	async createBackend(): Promise<HeadlessGPUBackend> {
		return new HeadlessGPUBackend();
	}
}
