import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { PNG } from 'pngjs';
import { createAssistantStudioFixture } from '../helpers/studio_assistant_fixture';

/** Explicit desktop test: requires an X11 display and xclip, not browser clipboard injection. */
test('Studio accepts external OS text and PNG on HTTP without Clipboard API access', { timeout: 120000 }, async t => {
	const xclip = process.env.BMSX_XCLIP || 'xclip';
	const f = await createAssistantStudioFixture(t, 'clipboard-external', {}, { headless: false, permissions: [] });
	const page = f.page;
	await page.goto(page.url().replace('127.0.0.1', '0.0.0.0'));
	assert.deepEqual(await page.evaluate(() => [isSecureContext, navigator.clipboard !== undefined]), [false, false]);
	await page.evaluate(async () => {
		const path = '/test.js', module = await import(path);
		(globalThis as any).clipboardUI = await module.startClipboardTest(document.querySelector('canvas'), (globalThis as any).capture);
		await (globalThis as any).clipboardUI.command('assistant');
	});
	await page.bringToFront();
	const text = 'External app → Studio\nUnicode: café, ó, é';
	execFileSync(xclip, ['-selection', 'clipboard', '-t', 'text/plain;charset=utf-8'], { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
	await page.keyboard.press('Control+v');
	assert.equal(await page.evaluate(() => (globalThis as any).clipboardUI.snapshot().text), text);
	assert.equal(await page.evaluate(() => (globalThis as any).clipboardUI.snapshot().canPaste), false,
		'only programmatic Paste is unavailable; native Paste remains independent');
	await page.evaluate(() => (globalThis as any).clipboardUI.capture('text'));

	const png = new PNG({ width: 160, height: 90 });
	for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
		const offset = (y * png.width + x) * 4;
		png.data[offset] = x < 80 ? 240 : 20;
		png.data[offset + 1] = y < 45 ? 180 : 40;
		png.data[offset + 2] = x < 80 ? 20 : 230;
		png.data[offset + 3] = 255;
	}
	execFileSync(xclip, ['-selection', 'clipboard', '-t', 'image/png'], { input: PNG.sync.write(png), stdio: ['pipe', 'ignore', 'ignore'] });
	await page.keyboard.press('Control+v');
	await page.waitForFunction(() => {
		const state = (globalThis as any).clipboardUI.snapshot();
		return state.images.length === 1 && state.imagesReady;
	});
	const state = await page.evaluate(() => (globalThis as any).clipboardUI.snapshot());
	assert.equal(state.text, text);
	assert.deepEqual(PNG.sync.read(Buffer.from(state.images[0].split(',')[1], 'base64')).data, png.data);
	await page.evaluate(() => (globalThis as any).clipboardUI.capture('image'));
	assert.deepEqual(f.observations.errors, []);
});
