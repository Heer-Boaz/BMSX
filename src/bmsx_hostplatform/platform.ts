import { BrowserGameViewHost, BrowserPlatform } from './browser/platform_browser';
import type { GameViewHostHandle, Platform } from 'bmsx/platform';

export * from 'bmsx/platform';
export { BrowserGameViewHost, BrowserPlatform, type BrowserPlatformOptions } from './browser/platform_browser';
export { CLIPlatformServices, CLIGameViewHost, CLIPlatformOptions } from './cli/platform_cli';

export interface ConstructPlatformOptions {
	audioContext: AudioContext;
	ufpsScaled?: number;
}

export function constructPlatformFromViewHostHandle(handle: GameViewHostHandle, options: ConstructPlatformOptions): Platform {
	if (typeof handle !== 'object' || handle === null) {
		throw new Error(`[constructPlatformFromViewHostHandle] Invalid handle provided (${handle}); expected an object.`);
	}
	if ((handle as { constructor?: { name?: string } }).constructor?.name === 'HTMLCanvasElement') {
		const viewHost = new BrowserGameViewHost(handle as HTMLCanvasElement);
		const platform = new BrowserPlatform(viewHost.surface.handle, handle as HTMLCanvasElement, options);
		platform.gameviewHost = viewHost;
		return platform;
	}
	throw new Error('[constructPlatformFromViewHostHandle] Unsupported handle type; cannot construct Platform.');
}
