export interface PlatformTimingService {
	requestAnimationFrame(callback: FrameRequestCallback): number;
	cancelAnimationFrame(handle: number): void;
	now(): number;
}

export interface PlatformEventService {
	addBeforeUnload(listener: (event: BeforeUnloadEvent) => void, options?: boolean | AddEventListenerOptions): void;
	removeBeforeUnload(listener: (event: BeforeUnloadEvent) => void, options?: boolean | EventListenerOptions): void;
	dispatchFrameEvent(): void;
}

export interface PlatformServices {
	readonly timing: PlatformTimingService;
	readonly events: PlatformEventService;
}

export class Platform {
	private static _instance: PlatformServices | null = null;

	public static initialize(services: PlatformServices): void {
		this._instance = services;
	}

	public static get instance(): PlatformServices {
		if (!this._instance) {
			throw new Error('[Platform] Platform services have not been initialized. Call Platform.initialize() before using engine systems.');
		}
		return this._instance;
	}

	public static get isInitialized(): boolean {
		return this._instance !== null;
	}
}
