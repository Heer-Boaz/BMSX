export interface ViewportDimensions {
	width: number;
	height: number;
}

export interface ViewportMetrics {
	document: ViewportDimensions;
	windowInner: ViewportDimensions;
	screen: ViewportDimensions;
}

export type HostWindowEventType = 'resize' | 'orientationchange' | 'keyup' | 'keydown';

export type HostEventListener = (event: unknown) => void;

export interface HostEventListenerObject {
	handleEvent(event: unknown): void;
}

export type HostEventListenerTarget = HostEventListener | HostEventListenerObject;

export type HostEventOptions = boolean | {
	capture?: boolean;
	passive?: boolean;
	once?: boolean;
	[key: string]: unknown;
};

export interface SurfaceBounds {
	width: number;
	height: number;
	left: number;
	top: number;
}

export interface GameViewCanvas {
	readonly handle: unknown;
	isVisible(): boolean;
	setRenderTargetSize(width: number, height: number): void;
	setDisplaySize(width: number, height: number): void;
	setDisplayPosition(left: number, top: number): void;
	measureDisplay(): SurfaceBounds;
	requestWebGL2Context(attributes: WebGLContextAttributes): WebGL2RenderingContext | null;
	requestWebGPUContext(): GPUCanvasContext | null;
}

export interface GamepadControlHandle {
	readonly id: string;
	getNumericAttribute(name: string): number | null;
	measure(): { width: number; height: number; };
	setBottom(px: number): void;
	setScale(scale: number): void;
}

export interface OnscreenGamepadHandles {
	dpad: GamepadControlHandle;
	actionButtons: GamepadControlHandle;
}

export interface OverlayHandle {
	setText(text: string): void;
	addClass(className: string): void;
	removeClass(className: string): void;
	onAnimationEnd(callback: () => void): void;
	forceReflow(): void;
	remove(): void;
}

export interface GameViewHost {
	readonly surface: GameViewCanvas;

	getViewportMetrics(): ViewportMetrics;

	getOnscreenGamepadHandles(): OnscreenGamepadHandles | null;

	ensureOverlay(id: string): OverlayHandle;

	getOverlay(id: string): OverlayHandle | null;

	addWindowEventListener(type: HostWindowEventType, listener: HostEventListenerTarget, options?: HostEventOptions): void;

	removeWindowEventListener(type: HostWindowEventType, listener: HostEventListenerTarget, options?: HostEventOptions): void;

	addDisplayModeChangeListener(listener: (isFullscreen: boolean) => void): void;

	updateFullscreenFlag(isFullscreen: boolean): void;

	getFullscreenFlag(): boolean;

	fullscreenEnabled(): boolean;

	requestFullscreen(): Promise<void>;

	exitFullscreen(): Promise<void>;
}
