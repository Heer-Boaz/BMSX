import type { vec2 } from '../../common/vector';
import type {
	VideoOutput,
	VideoSurface,
	SubscriptionHandle,
	ViewportDimensions,
} from '../../platform';
import { createSubscriptionHandle } from '../../platform';
import { HeadlessGPUBackend } from './backend';
import { HeadlessPresentSurface } from './present_surface';

export interface HeadlessPresentedFrameBuffer {
	pixels: Uint8Array;
	width: number;
	height: number;
}

export interface HeadlessPresentedFrame {
	frameIndex: number;
	width: number;
	height: number;
}

class HeadlessVideoSurface implements VideoSurface {
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
		throw new Error('[HeadlessVideoSurface] WebGL2 context is not available in headless mode.');
	}
}

export class HeadlessVideoOutput implements VideoOutput {
	public readonly surface: HeadlessVideoSurface;
	private readonly presentedFrameListeners = new Set<(frame: HeadlessPresentedFrame) => void>();
	public readonly presentSurface = new HeadlessPresentSurface();
	private readonly presentedFrameScratch: HeadlessPresentedFrame = { frameIndex: 0, width: 0, height: 0 };
	public presentedFrameCount = 0;

	constructor(initialSize: vec2) {
		this.surface = new HeadlessVideoSurface(initialSize);
	}

	async createBackend(): Promise<HeadlessGPUBackend> {
		return new HeadlessGPUBackend(this);
	}

	public presentFrameBuffer(frame: HeadlessPresentedFrameBuffer): void {
		this.presentSurface.present2D(frame.pixels, frame.width, frame.height);
		const presentedFrame = this.presentedFrameScratch;
		presentedFrame.frameIndex = this.presentedFrameCount;
		presentedFrame.width = frame.width;
		presentedFrame.height = frame.height;
		this.presentedFrameCount += 1;
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
		if (this.presentedFrameCount <= 0 || this.presentSurface.width <= 0 || this.presentSurface.height <= 0) {
			return null;
		}
		return {
			frameIndex: this.presentedFrameCount - 1,
			width: this.presentSurface.width,
			height: this.presentSurface.height,
		};
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

}
