import { bootBrowserRom } from '../../scripts/bootrom/bootrom';

declare const __BMSX_BROWSER_DEBUG__: boolean;

window.addEventListener('load', () => {
	const systemRomPath = `./bmsx-bios${__BMSX_BROWSER_DEBUG__ ? '.debug' : ''}.rom`;
	void bootBrowserRom(
		__BMSX_BROWSER_DEBUG__,
		systemRomPath,
		document.body.dataset.defaultRom,
	);
}, { once: true });
