import { PlatformEventService, PlatformServices, PlatformTimingService } from './platform_services';

class BrowserTimingService implements PlatformTimingService {
	requestAnimationFrame(callback: FrameRequestCallback): number {
		return window.requestAnimationFrame(callback);
	}

	cancelAnimationFrame(handle: number): void {
		window.cancelAnimationFrame(handle);
	}

	now(): number {
		return performance.now();
	}
}

class BrowserEventService implements PlatformEventService {
	addBeforeUnload(listener: (event: BeforeUnloadEvent) => void, options: boolean | AddEventListenerOptions = true): void {
		window.addEventListener('beforeunload', listener, options);
	}

	removeBeforeUnload(listener: (event: BeforeUnloadEvent) => void, options: boolean | EventListenerOptions = true): void {
		window.removeEventListener('beforeunload', listener, options);
	}

	dispatchFrameEvent(): void {
		window.dispatchEvent(new Event('frame'));
	}
}

export class BrowserPlatformServices implements PlatformServices {
	public readonly timing: PlatformTimingService;
	public readonly events: PlatformEventService;

	constructor() {
		this.timing = new BrowserTimingService();
		this.events = new BrowserEventService();
	}
}
