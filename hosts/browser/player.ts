import { prepareMachineHost, startMachineHostFrames } from '../../runtime/machine_runtime';
import {
	completeBrowserBoot,
	prepareBrowserStartup,
	showBrowserBootError,
} from './boot';
import { bindBrowserFullscreenShortcut } from './fullscreen';

declare const BMSX_BROWSER_DEBUG: boolean;

async function startBrowserPlayer(): Promise<void> {
	const systemRomPath = `./bmsx-bios${BMSX_BROWSER_DEBUG ? '.debug' : ''}.rom`;
	try {
		const options = await prepareBrowserStartup(
			BMSX_BROWSER_DEBUG,
			systemRomPath,
			document.body.dataset.defaultRom,
		);
		const host = await prepareMachineHost(options);
		bindBrowserFullscreenShortcut(host);
		startMachineHostFrames(host);
		completeBrowserBoot();
	} catch (error) {
		showBrowserBootError(error);
	}
}

window.addEventListener('load', () => {
	void startBrowserPlayer();
}, { once: true });
