import { PlatformEventListener, PlatformEventService, PlatformHIDService, PlatformInputService, PlatformServices, PlatformTimingService } from './platform_services';

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

class BrowserInputService implements PlatformInputService {
	addEventListener(target: unknown, type: string, listener: PlatformEventListener, options?: boolean | AddEventListenerOptions): void {
		const eventTarget = target as EventTarget | undefined;
		if (eventTarget?.addEventListener) {
			eventTarget.addEventListener(type, listener as EventListener, options as any);
		}
	}

	removeEventListener(target: unknown, type: string, listener: PlatformEventListener, options?: boolean | EventListenerOptions): void {
		const eventTarget = target as EventTarget | undefined;
		if (eventTarget?.removeEventListener) {
			eventTarget.removeEventListener(type, listener as EventListener, options as any);
		}
	}
}

class BrowserHIDService implements PlatformHIDService {
	isSupported(): boolean {
		return typeof navigator !== 'undefined' && !!navigator.hid;
	}

	async getDevices(): Promise<HIDDevice[]> {
		if (!this.isSupported()) return [];
		return navigator.hid.getDevices();
	}

	async requestDevice(options: HIDDeviceRequestOptions): Promise<HIDDevice[]> {
		if (!this.isSupported()) throw new Error('[Platform] HID API is not available in this environment.');
		return navigator.hid.requestDevice(options);
	}
}

export class BrowserPlatformServices implements PlatformServices {
	public readonly timing: PlatformTimingService;
	public readonly events: PlatformEventService;
	public readonly input: PlatformInputService;
public readonly hid?: PlatformHIDService;

	constructor() {
		this.timing = new BrowserTimingService();
		this.events = new BrowserEventService();
		this.input = new BrowserInputService();
		this.hid = new BrowserHIDService();
	}
}
