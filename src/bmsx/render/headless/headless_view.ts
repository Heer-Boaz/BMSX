import type { vec2 } from '../../rompack/rompack';
import type {
	GameViewHost,
	GameViewCanvas,
	ViewportMetrics,
	OnscreenGamepadHandles,
	OverlayHandle,
	HostEventListenerTarget,
	HostEventOptions
} from 'bmsx/host/platform';
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

export class HeadlessGameViewHost implements GameViewHost {
	public readonly surface: HeadlessGameViewCanvas;
	private overlays = new Map<string, HeadlessOverlay>();

	constructor(initialSize: vec2) {
		this.surface = new HeadlessGameViewCanvas(initialSize);
	}

	getViewportMetrics(): ViewportMetrics {
		const bounds = this.surface.measureDisplay();
		return {
			document: { width: bounds.width, height: bounds.height },
			windowInner: { width: bounds.width, height: bounds.height },
			screen: { width: bounds.width, height: bounds.height },
		};
	}
	getOnscreenGamepadHandles(): OnscreenGamepadHandles | null { return null; }
	ensureOverlay(id: string): OverlayHandle {
		let overlay = this.overlays.get(id);
		if (!overlay) {
			overlay = new HeadlessOverlay();
			this.overlays.set(id, overlay);
		}
		return overlay;
	}
	getOverlay(id: string): OverlayHandle | null {
		const overlay = this.overlays.get(id);
		if (!overlay) return null;
		return overlay;
	}
	addWindowEventListener(_type: any, _listener: HostEventListenerTarget, _options?: HostEventOptions): void { }
	removeWindowEventListener(_type: any, _listener: HostEventListenerTarget, _options?: HostEventOptions): void { }
	addDisplayModeChangeListener(_listener: (isFullscreen: boolean) => void): void { }
	fullscreenAvailable(): boolean { return false; }
	public get fullscreen(): boolean { return false; }
	public async setFullscreen(_v: boolean): Promise<void> {
		console.warn('HeadlessGameViewHost: fullscreen mode not supported in headless mode');
	}

	async createBackend(): Promise<HeadlessGPUBackend> {
		return new HeadlessGPUBackend();
	}
}
