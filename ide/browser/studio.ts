import {
	completeBrowserBoot,
	prepareBrowserStartup,
	showBrowserBootError,
} from '../../hosts/browser/boot';
import {
	prepareWorkbenchRuntime,
	startWorkbenchHostFrames,
} from '../workbench/machine_runtime';
import { bindBrowserFullscreenShortcut } from '../../hosts/browser/fullscreen';

declare const BMSX_BROWSER_DEBUG: boolean;

async function startBrowserStudio(): Promise<void> {
	const systemRomPath = `./bmsx-bios${BMSX_BROWSER_DEBUG ? '.debug' : ''}.rom`;
	try {
		const options = await prepareBrowserStartup(
			BMSX_BROWSER_DEBUG,
			systemRomPath,
			document.body.dataset.defaultRom,
		);
		const ide = await prepareWorkbenchRuntime(options);
		bindBrowserFullscreenShortcut();
		startWorkbenchHostFrames(ide);
		completeBrowserBoot();
	} catch (error) {
		showBrowserBootError(error);
	}
}

window.addEventListener('load', () => {
	void startBrowserStudio();
}, { once: true });
