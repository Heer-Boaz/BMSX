import {
	GameViewCanvas,
	GameViewHost,
	GamepadControlHandle,
	HostEventListenerTarget,
	HostEventOptions,
	HostWindowEventType,
	OnscreenGamepadHandles,
	OverlayHandle,
	ViewportDimensions,
	ViewportMetrics,
	SurfaceBounds,
} from './gameview_host';

class BrowserGameViewCanvas implements GameViewCanvas {
	public readonly handle: HTMLCanvasElement;

	public constructor(canvas: HTMLCanvasElement) {
		this.handle = canvas;
	}

	public isVisible(): boolean {
		return this.handle.style.visibility !== 'hidden';
	}

	public setRenderTargetSize(width: number, height: number): void {
		this.handle.width = width;
		this.handle.height = height;
	}

	public setDisplaySize(width: number, height: number): void {
		this.handle.style.width = `${width}px`;
		this.handle.style.height = `${height}px`;
	}

	public setDisplayPosition(left: number, top: number): void {
		this.handle.style.left = `${left}px`;
		this.handle.style.top = `${top}px`;
	}

	public measureDisplay(): SurfaceBounds {
		const rect = this.handle.getBoundingClientRect();
		return {
			width: rect.width,
			height: rect.height,
			left: rect.left,
			top: rect.top,
		};
	}

	public requestWebGL2Context(attributes: WebGLContextAttributes): WebGL2RenderingContext | null {
		return this.handle.getContext('webgl2', attributes) as WebGL2RenderingContext | null;
	}

	public requestWebGPUContext(): GPUCanvasContext | null {
		return this.handle.getContext('webgpu') as GPUCanvasContext | null;
	}
}

class BrowserGamepadControlHandle implements GamepadControlHandle {
	public constructor(public readonly id: string, private readonly element: HTMLElement) {}

	public getNumericAttribute(name: string): number | null {
		const value = this.element.getAttribute(name);
		return value ? parseInt(value, 10) : null;
	}

	public measure(): { width: number; height: number; } {
		const rect = this.element.getBoundingClientRect();
		return { width: rect.width, height: rect.height };
	}

	public setBottom(px: number): void {
		this.element.style.bottom = `${px}px`;
	}

	public setScale(scale: number): void {
		this.element.style.transform = `scale(${scale})`;
	}
}

class BrowserOverlayHandle implements OverlayHandle {
	public constructor(private readonly element: HTMLElement, private readonly dispose: () => void) {}

	public setText(text: string): void {
		this.element.textContent = text;
	}

	public addClass(className: string): void {
		this.element.classList.add(className);
	}

	public removeClass(className: string): void {
		this.element.classList.remove(className);
	}

	public onAnimationEnd(callback: () => void): void {
		const handler = (_event: AnimationEvent) => {
			this.element.removeEventListener('animationend', handler);
			callback();
		};
		this.element.addEventListener('animationend', handler, { once: true });
	}

	public forceReflow(): void {
		void this.element.offsetWidth;
	}

	public remove(): void {
		this.element.remove();
		this.dispose();
	}

	public get native(): HTMLElement {
		return this.element;
	}
}

function toDomOptions(options?: HostEventOptions): boolean | AddEventListenerOptions | undefined {
	if (options === undefined) return undefined;
	if (typeof options === 'boolean') return options;
	return options as AddEventListenerOptions;
}

export class BrowserGameViewHost implements GameViewHost {
	public static fromCanvasId(id: string): BrowserGameViewHost {
		const candidate = document.getElementById(id);
		if (!(candidate instanceof HTMLCanvasElement)) {
			throw new Error(`[BrowserGameViewHost] Element with id "${id}" not found or not a canvas.`);
		}
		return new BrowserGameViewHost(candidate);
	}

	public readonly surface: BrowserGameViewCanvas;
	private _isFullscreen = false;
	private readonly overlays = new Map<string, BrowserOverlayHandle>();
	private readonly listenerCache = new WeakMap<HostEventListenerTarget, EventListenerOrEventListenerObject>();

	public constructor(canvas: HTMLCanvasElement) {
		if (!(canvas instanceof HTMLCanvasElement)) {
			throw new Error('[BrowserGameViewHost] Provided canvas element was not an HTMLCanvasElement.');
		}
		this.surface = new BrowserGameViewCanvas(canvas);
	}

	private getDomListener(listener: HostEventListenerTarget): EventListenerOrEventListenerObject {
		let cached = this.listenerCache.get(listener);
		if (cached) {
			return cached;
		}
		if (typeof listener === 'function') {
			const fn: EventListener = (event: Event) => listener(event);
			this.listenerCache.set(listener, fn);
			return fn;
		}
		const obj: EventListenerOrEventListenerObject = {
			handleEvent: (event: Event) => listener.handleEvent(event),
		};
		this.listenerCache.set(listener, obj);
		return obj;
	}

	public getViewportMetrics(): ViewportMetrics {
		const documentElement = document.documentElement;
		const documentDimensions: ViewportDimensions = {
			width: documentElement ? documentElement.clientWidth : 0,
			height: documentElement ? documentElement.clientHeight : 0,
		};
		const windowDimensions: ViewportDimensions = {
			width: typeof window.innerWidth === 'number' ? window.innerWidth : 0,
			height: typeof window.innerHeight === 'number' ? window.innerHeight : 0,
		};
		const screenDimensions: ViewportDimensions = {
			width: typeof window.screen?.width === 'number' ? window.screen.width : 0,
			height: typeof window.screen?.height === 'number' ? window.screen.height : 0,
		};
		return {
			document: documentDimensions,
			windowInner: windowDimensions,
			screen: screenDimensions,
		};
	}

	public getOnscreenGamepadHandles(): OnscreenGamepadHandles | null {
		const dpad = document.querySelector<HTMLElement>('#d-pad-svg');
		const actionButtons = document.querySelector<HTMLElement>('#action-buttons-svg');
		if (!dpad || !actionButtons) {
			return null;
		}
		return {
			dpad: new BrowserGamepadControlHandle('d-pad-svg', dpad),
			actionButtons: new BrowserGamepadControlHandle('action-buttons-svg', actionButtons),
		};
	}

	public ensureOverlay(id: string): OverlayHandle {
		let overlay = this.overlays.get(id);
		if (!overlay) {
			const element = document.createElement('div');
			element.id = id;
			if (!document.body) {
				throw new Error('[BrowserGameViewHost] Document body not available while creating overlay element.');
			}
			document.body.appendChild(element);
			overlay = new BrowserOverlayHandle(element, () => this.overlays.delete(id));
			this.overlays.set(id, overlay);
		}
		return overlay;
	}

	public getOverlay(id: string): OverlayHandle | null {
		return this.overlays.get(id) ?? null;
	}

	public addWindowEventListener(type: HostWindowEventType, listener: HostEventListenerTarget, options?: HostEventOptions): void {
		window.addEventListener(type, this.getDomListener(listener), toDomOptions(options));
	}

	public removeWindowEventListener(type: HostWindowEventType, listener: HostEventListenerTarget, options?: HostEventOptions): void {
		window.removeEventListener(type, this.getDomListener(listener), toDomOptions(options));
	}

	public addDisplayModeChangeListener(listener: (isFullscreen: boolean) => void): void {
		const mediaQuery = window.matchMedia('(display-mode: fullscreen)');
		const handler = (event: MediaQueryListEvent) => {
			listener(event.matches);
		};
		mediaQuery.addEventListener('change', handler);
	}

	public updateFullscreenFlag(isFullscreen: boolean): void {
		this._isFullscreen = isFullscreen;
		(window as unknown as { isFullScreen?: boolean }).isFullScreen = isFullscreen;
	}

	public getFullscreenFlag(): boolean {
		return this._isFullscreen;
	}

	public fullscreenEnabled(): boolean {
		const doc = document as unknown as {
			webkitFullscreenEnabled?: boolean;
			webkitFullScreenEnabled?: boolean;
			mozFullScreenEnabled?: boolean;
		};
		if (document.fullscreenEnabled) return true;
		if (doc && doc.webkitFullscreenEnabled) return true;
		if (doc && doc.webkitFullScreenEnabled) return true;
		if (doc && doc.mozFullScreenEnabled) return true;
		return false;
	}

	public async requestFullscreen(): Promise<void> {
		const element = document.documentElement as unknown as {
			requestFullscreen?: () => Promise<void>;
			mozRequestFullScreen?: () => Promise<void>;
			webkitRequestFullScreen?: () => void;
			webkitRequestFullscreen?: () => void;
		};
		if (!element) {
			throw new Error('[BrowserGameViewHost] Document element not available while attempting to enter fullscreen.');
		}
		if (typeof element.requestFullscreen === 'function') {
			await element.requestFullscreen();
			return;
		}
		if (typeof element.mozRequestFullScreen === 'function') {
			await element.mozRequestFullScreen();
			return;
		}
		if (typeof element.webkitRequestFullScreen === 'function') {
			element.webkitRequestFullScreen();
			return;
		}
		if (typeof element.webkitRequestFullscreen === 'function') {
			element.webkitRequestFullscreen();
			return;
		}
		throw new Error('[BrowserGameViewHost] Fullscreen API is not supported on this platform.');
	}

	public async exitFullscreen(): Promise<void> {
		const doc = document as unknown as {
			exitFullscreen?: () => Promise<void>;
			webkitExitFullscreen?: () => void;
			mozExitFullScreen?: () => Promise<void>;
		};
		if (typeof doc.exitFullscreen === 'function') {
			await doc.exitFullscreen();
			return;
		}
		if (typeof doc.webkitExitFullscreen === 'function') {
			doc.webkitExitFullscreen();
			return;
		}
		if (typeof doc.mozExitFullScreen === 'function') {
			await doc.mozExitFullScreen();
			return;
		}
		throw new Error('[BrowserGameViewHost] Fullscreen exit is not supported on this platform.');
	}
}
