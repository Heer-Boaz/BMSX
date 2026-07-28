import { prepareMachineRuntime, startMachineHostFrames } from '../../runtime/machine_runtime';
import {
	completeBrowserBoot,
	loadBrowserMachine,
	showBrowserBootError,
} from './boot';

declare const BMSX_BROWSER_DEBUG: boolean;

async function startBrowserPlayer(): Promise<void> {
	const systemRomPath = `./bmsx-bios${BMSX_BROWSER_DEBUG ? '.debug' : ''}.rom`;
	try {
		const options = await loadBrowserMachine(
			BMSX_BROWSER_DEBUG,
			systemRomPath,
			document.body.dataset.defaultRom,
		);
		const runtime = await prepareMachineRuntime(options);
		startMachineHostFrames(runtime);
		completeBrowserBoot();
	} catch (error) {
		showBrowserBootError(error);
	}
}

window.addEventListener('load', () => {
	void startBrowserPlayer();
}, { once: true });
