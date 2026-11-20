import { after, type TestContext } from 'node:test';
import { chromium, type Browser, type BrowserContextOptions } from 'playwright';
import { afterTest } from './test_cleanup';

const profiles = {
	paced: {},
	// These tests assert events and paint, not display refresh timing.
	unpaced: { args: ['--disable-frame-rate-limit'] },
};
type Profile = keyof typeof profiles;
const browsers = new Map<Profile, Promise<Browser>>();

after(async () => {
	await Promise.all(Array.from(browsers.values(), async pending => (await pending).close()));
});

// Share the Chromium process, not its cookies, document, input or emulation.
// Playwright's browser.newPage gives each page its own context and closes
// that context with the page.
export async function openBrowserTestPage(t: TestContext, options?: BrowserContextOptions, profile: Profile = 'paced') {
	let pending = browsers.get(profile);
	if (pending === undefined) {
		pending = chromium.launch(profiles[profile]);
		browsers.set(profile, pending);
	}
	const page = await (await pending).newPage(options);
	afterTest(t, () => page.close());
	return page;
}
