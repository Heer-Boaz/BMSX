import { Platform } from '../../core/platform';
import { BrowserPlatformServices } from './platform_browser';
// NO ENGINE TYPES ARE ALLOWED TO BE IMPORTED HERE!! OTHERWISE, IT WILL CREATE ENGINE CYCLES AND OTHER DEPENDENCY PROBLEMS!!!!!!!!!

export interface BrowserBootstrapOptions {
	startingGamepadIndex?: number;
}

export interface BrowserBootstrapHandle {
	stop(): void;
	readonly startingGamepadIndex?: number;
}

/**
 * THIS MUST BE A PURE PLATFORM INITIALIZER!! DON'T DO ANY ENGINE STUFF HERE!! OTHERWISE YOU'LL CREATE CYCLES AND OTHER DEPENDENCY PROBLEMS!!!!!!!!! I'M LOOKING AT YOU, CODEX!!!!!
 * @param surface
 * @param options
 * @returns
 */
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
