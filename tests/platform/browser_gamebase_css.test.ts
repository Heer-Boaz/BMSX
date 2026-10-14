import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { BROWSER_KEYBOARD_PAGES } from '../../hosts/browser/onscreen_keyboard_layout';
import { expandBrowserKeyboardTemplate } from '../../scripts/products/browser_keyboard';

// Like noVNC's display tests, assert effective geometry and retained presentation
// across owner transitions, not stylesheet order or selector implementation.
// https://github.com/novnc/noVNC/blob/b17d04c1a1a926a59f4a04bb866332b429f2ce37/tests/test.display.js

test('gamebase CSS preserves boot, control and keyboard presentation across player sizes', async t => {
	const template = expandBrowserKeyboardTemplate(await readFile('gamebase.html', 'utf8'))
		.replace('/*#css*/', await readFile('gamebase.css', 'utf8'))
		.replace('@@BMSX_LOGO@@', `data:image/png;base64,${(await readFile('rom/bmsx.png')).toString('base64')}`)
		.replace(/<link\b[^>]*>/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
		.replace(/@@BMSX_[A-Z_]+@@/g, '');
	const bundle = await build({
		stdin: { contents: `export { BrowserOnscreenKeyboard } from './hosts/browser/onscreen_keyboard';
export { BROWSER_KEYBOARD_PAGES } from './hosts/browser/onscreen_keyboard_layout';
export { OnScreenKeyboard } from './hosts/common/input/on_screen_keyboard';
export { ON_SCREEN_KEY_INDEX_BY_CODE } from './hosts/common/input/on_screen_keyboard_keys';
export { BrowserInputHub } from './hosts/browser/input';
export { BrowserInputTraceBuffer } from './hosts/browser/input_trace_buffer';
export { BrowserInputTraceView } from './hosts/browser/input_trace_view';
export { BrowserOnscreenGamepad } from './hosts/browser/onscreen_gamepad';
export { BrowserOnscreenGamepadView } from './hosts/browser/onscreen_gamepad_view';
export { BrowserVideoOutput } from './hosts/browser/video_output';
export { BrowserHostClock } from './hosts/browser/timing';
export { Input } from './hosts/common/input/manager';`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'cssFixture', write: false, tsconfig: 'tsconfig.base.json',
	});
	const browser = await chromium.launch();
	t.after(() => browser.close());
	for (const profile of [
		{ name: 'phone portrait', width: 393, height: 852, insets: [47, 0, 34, 0] },
		{ name: 'phone landscape', width: 852, height: 393, insets: [0, 47, 21, 47] },
		{ name: 'short landscape', width: 568, height: 239, insets: [0, 0, 0, 0] },
		{ name: 'tablet', width: 768, height: 1024, insets: [24, 0, 20, 0] },
		{ name: 'embedded player', width: 1024, height: 900, insets: [0, 0, 0, 0], embedded: true },
	]) await t.test(profile.name, async p => {
		const page = await browser.newPage({ viewport: { width: profile.width, height: profile.height }, isMobile: true, hasTouch: true });
		p.after(() => page.close());
		await page.setContent(template);
		assert.equal(await page.locator('#msx').isVisible(), false);
		assert.equal(await page.locator('#gamescreen').isVisible(), false);
		assert.equal(await page.locator('#bmsx-touch-keyboard').isVisible(), false);
		assert.equal(await page.locator('.control-surface:visible').count(), 0);
		const boot = await page.evaluate(() => {
			const image = document.getElementById('msx')!;
			image.className = 'enter'; image.hidden = false;
			const animation = image.getAnimations()[0]; animation.pause(); animation.currentTime = 500;
			const style = getComputedStyle(image);
			return { duration: animation.effect!.getTiming().duration, transform: style.transform,
				visible: style.display !== 'none', coverTop: document.getElementById('hidor')!.getBoundingClientRect().top };
		});
		assert.equal(boot.duration, 1000);
		assert.equal(boot.visible, true);
		assert.notEqual(boot.transform, 'none');
		assert.ok(Math.abs(boot.coverTop - profile.height * 0.6) < 0.02);
		await page.addScriptTag({ content: bundle.outputFiles[0].text });
		await page.evaluate(profile => {
			for (const id of ['msx', 'hidor', 'loading']) document.getElementById(id)!.remove();
			document.body.classList.add('game-started');
			const surface = document.getElementById('player-surface')!;
			surface.style.padding = profile.insets.map(value => `${value}px`).join(' ');
			if (profile.embedded) Object.assign(surface.style, { left: '60px', top: '35px', right: 'auto', bottom: 'auto', width: '360px', height: '620px' });
			const api = (globalThis as any).cssFixture;
			if (profile.name === 'short landscape') {
				new api.BrowserInputTraceView(document, new api.BrowserInputTraceBuffer());
				(document.getElementById('bmsx-input-trace') as HTMLDetailsElement).open = true;
			}
			const clock = new api.BrowserHostClock();
			const pad = new api.BrowserOnscreenGamepad(clock);
			const gamepadView = new api.BrowserOnscreenGamepadView(document, window, pad);
			const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
			canvas.width = 320; canvas.height = 240; canvas.hidden = false; canvas.style.display = 'block';
			const video = new api.BrowserVideoOutput(canvas, gamepadView, 'overscan');
			video.refreshLayout();
			const hub = new api.BrowserInputHub(canvas, surface, clock, pad, 'F2');
			const input = new api.Input(clock, hub, pad.gamepadIndex);
			const keyboard = new api.OnScreenKeyboard(input, api.BROWSER_KEYBOARD_PAGES);
			const keyboardView = new api.BrowserOnscreenKeyboard(document, keyboard, () => keyboard.close());
			hub.setOnscreenKeyboard(keyboardView);
			(globalThis as any).cssProbe = { pad, keyboard, video, input, key: api.ON_SCREEN_KEY_INDEX_BY_CODE, source: keyboard.allocateSource(),
				measure() { return [...document.querySelectorAll('#gamescreen, .control-surface')].map(element => {
					const bounds = element.getBoundingClientRect();
					return { id: element.id, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
				}); } };
		}, profile);
		const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
		await settle();
		const geometry = await page.evaluate(() => (globalThis as any).cssProbe.measure());
		const canvas = geometry.find((entry: { id: string }) => entry.id === 'gamescreen');
		assert.ok(Math.abs(canvas.width / canvas.height - 4 / 3) < 0.001);
		if (profile.width < profile.height || profile.embedded) {
			const visibleTop = await page.evaluate(() => (globalThis as any).cssProbe.video.visibleViewportBounds.top);
			assert.ok(Math.abs(canvas.y + visibleTop * canvas.height / 240 - (profile.embedded ? 35 : 0) - profile.insets[0]) < 0.02,
				'the clipped portrait image starts at the safe top, including permitted overscan');
		}
		const interaction = await page.evaluate(() => ({
			page: getComputedStyle(document.documentElement).touchAction,
			surface: getComputedStyle(document.getElementById('player-surface')!).touchAction,
			canvas: getComputedStyle(document.getElementById('gamescreen')!).touchAction,
			artwork: getComputedStyle(document.getElementById('action-buttons-svg')!).pointerEvents,
			selectedText: getComputedStyle(document.body).userSelect,
			pixelated: getComputedStyle(document.getElementById('gamescreen')!).imageRendering,
		}));
		assert.deepEqual(interaction, { page: 'manipulation', surface: 'none', canvas: 'none', artwork: 'none', selectedText: 'none', pixelated: 'pixelated' });
		const idle = await page.locator('#a_knop').evaluate(element => ({ stroke: getComputedStyle(element).stroke, width: getComputedStyle(element).strokeWidth }));
		await page.evaluate(() => {
			const a = document.getElementById('a_knop')!.getBoundingClientRect();
			(globalThis as any).cssProbe.pad.beginContact(1, a.x + a.width / 2, a.y + a.height / 2, 14, 14, true);
			const pad = document.getElementById('d-pad-svg')!.getBoundingClientRect();
			(globalThis as any).cssProbe.pad.beginContact(2, pad.x + pad.width / 2, pad.y + pad.height * 0.2, 14, 14, true);
		});
		await settle();
		const held = await page.locator('#a_knop').evaluate(element => ({ stroke: getComputedStyle(element).stroke, width: getComputedStyle(element).strokeWidth }));
		assert.notEqual(held.stroke, idle.stroke);
		assert.equal(await page.locator('#d-pad-u').getAttribute('data-touched'), 'true');
		assert.equal(await page.locator('#d-pad-u').evaluate(element => getComputedStyle(element).stroke), held.stroke);
		assert.ok(parseFloat(held.width) > parseFloat(idle.width));
		assert.deepEqual(await page.evaluate(() => (globalThis as any).cssProbe.measure()), geometry, 'acknowledgement paint must not move control geometry');
		await page.evaluate(() => { const probe = (globalThis as any).cssProbe; probe.pad.endContact(1); probe.pad.endContact(2); probe.keyboard.open(); });
		await settle();
		assert.equal(await page.locator('#controller-viewport').evaluate(element => getComputedStyle(element).visibility), 'hidden');
		assert.deepEqual(await page.evaluate(() => (globalThis as any).cssProbe.measure()), geometry, 'keyboard foreground does not rescale the underlying picture or controls');
		for (let selectedPage = 0; selectedPage < BROWSER_KEYBOARD_PAGES.length; selectedPage++) {
			await page.evaluate(index => (globalThis as any).cssProbe.keyboard.setPage(index), selectedPage);
			await settle();
			assert.equal(await page.locator('.bmsx-touch-keyboard-page:visible').count(), 1);
			assert.equal(await page.locator('.bmsx-touch-keyboard-page:not([hidden])').getAttribute('data-page'), String(selectedPage));
			const panel = await page.locator('#bmsx-touch-keyboard').boundingBox();
			assert.ok(panel!.y >= 0 && panel!.y + panel!.height <= profile.height);
			const selected = page.locator('.bmsx-touch-keyboard-page:not([hidden]) .bmsx-touch-key[data-selected="true"]');
			const keyIdle = await selected.evaluate(element => ({ color: getComputedStyle(element).backgroundColor, code: element.getAttribute('data-code'), bounds: element.getBoundingClientRect().toJSON() }));
			const topmost = await selected.evaluate(element => { const b = element.getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) === element; });
			assert.equal(topmost, true, 'keyboard keys own hit testing above canvas and control artwork');
			await page.evaluate(code => { const probe = (globalThis as any).cssProbe; probe.keyboard.pressKey(probe.source, probe.key.get(code)); }, keyIdle.code);
			await settle();
			const heldKey = await selected.evaluate(element => ({ color: getComputedStyle(element).backgroundColor, pressed: element.getAttribute('aria-pressed'), bounds: element.getBoundingClientRect().toJSON() }));
			assert.equal(heldKey.pressed, 'true'); assert.notEqual(heldKey.color, keyIdle.color); assert.deepEqual(heldKey.bounds, keyIdle.bounds);
			await page.evaluate(() => (globalThis as any).cssProbe.keyboard.releaseSource((globalThis as any).cssProbe.source));
			await settle();
			assert.equal(await selected.getAttribute('aria-pressed'), 'false');
			assert.equal(await selected.getAttribute('data-highlighted'), 'true', 'release feedback is visible without falsely holding the key');
			assert.equal(await selected.evaluate(element => getComputedStyle(element).backgroundColor), heldKey.color);
			await page.evaluate(time => (globalThis as any).cssProbe.keyboard.updateFeedback(time), (selectedPage + 1) * 1000);
			await settle();
			assert.equal(await selected.evaluate(element => getComputedStyle(element).backgroundColor), keyIdle.color);
		}
		await page.evaluate(() => (globalThis as any).cssProbe.keyboard.close()); await settle();
		assert.equal(await page.locator('#bmsx-touch-keyboard').isVisible(), false);
		assert.equal(await page.locator('#controller-viewport').evaluate(element => getComputedStyle(element).visibility), 'visible');
		if (profile.name === 'short landscape') assert.equal(await page.locator('#bmsx-input-trace summary').evaluate(element => {
			const bounds = element.getBoundingClientRect();
			return document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2) === element;
		}), true, 'closing the keyboard restores the body-level trace as the foreground hit target');
		assert.deepEqual(await page.evaluate(() => (globalThis as any).cssProbe.measure()), geometry);
		await page.evaluate(() => { const probe = (globalThis as any).cssProbe; probe.input.dispose(); probe.video.dispose(); });
	});
});
