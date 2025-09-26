import { Platform } from '../../core/platform';
import { BrowserPlatformServices } from './platform_browser';
export interface BrowserBootstrapOptions {
	startingGamepadIndex?: number;
}

export interface BrowserBootstrapHandle {
	stop(): void;
	readonly startingGamepadIndex?: number;
}

export function bootstrapBrowserPlatform(surface: HTMLElement, options: BrowserBootstrapOptions = {}): BrowserBootstrapHandle {
	const services = new BrowserPlatformServices(surface);
	if (!Platform.isInitialized) Platform.initialize(services);

	const plat = Platform.instance;
	const deviceLoop = plat.frames.start(() => {
		const devices = plat.input.devices();
		for (let i = 0; i < devices.length; i++) devices[i].poll(plat.clock);
	});

	return {
		startingGamepadIndex: options.startingGamepadIndex,
		stop: () => {
			deviceLoop.stop();
		},
	};
}
