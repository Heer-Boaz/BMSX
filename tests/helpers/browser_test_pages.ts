import { after, type TestContext } from 'node:test';
import { addAbortListener } from 'node:events';
import { chromium, type Browser, type BrowserContextOptions, type Page } from 'playwright';
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
	let closing: Promise<void> | undefined;
	const close = () => closing ??= page.close();
	const cancel = addAbortListener(t.signal, () => {
		void close().catch(error => t.diagnostic(`Closing cancelled browser page: ${String(error)}`));
	});
	afterTest(t, () => { cancel[Symbol.dispose](); return close(); });
	return page;
}

export function waitForBrowserFrame(page: Page): Promise<void> {
	return page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** The Studio host polls input per frame. Hold each chord long enough for its
 * modifiers to reach that owner, then wait for release before the next input. */
export async function pressStudioChord(page: Page, keys: string): Promise<void> {
	const chord = keys.split('+');
	for (const key of chord) await page.keyboard.down(key);
	await waitForBrowserFrame(page);
	for (let index = chord.length - 1; index >= 0; index--) await page.keyboard.up(chord[index]);
	await waitForBrowserFrame(page);
}
