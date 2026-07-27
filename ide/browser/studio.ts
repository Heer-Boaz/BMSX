import {
	completeBrowserBoot,
	loadBrowserMachine,
	showBrowserBootError,
} from '../../hosts/browser/boot';
import {
	prepareWorkbenchRuntime,
	startWorkbenchHostFrames,
} from '../workbench/machine_runtime';

declare const BMSX_BROWSER_DEBUG: boolean;

async function startBrowserStudio(): Promise<void> {
	const systemRomPath = `./bmsx-bios${BMSX_BROWSER_DEBUG ? '.debug' : ''}.rom`;
	try {
		const options = await loadBrowserMachine(
			BMSX_BROWSER_DEBUG,
			systemRomPath,
			document.body.dataset.defaultRom,
		);
		const ide = await prepareWorkbenchRuntime(options);
		startWorkbenchHostFrames(ide);
		completeBrowserBoot();
	} catch (error) {
		showBrowserBootError(error);
	}
}

window.addEventListener('load', () => {
	void startBrowserStudio();
}, { once: true });
