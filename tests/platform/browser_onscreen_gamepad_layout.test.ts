import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('control geometry follows CSS player layout independently of framebuffer resolution', async t => {
	const template = await readFile('gamebase.html', 'utf8');
	const controls = template.slice(template.indexOf('<div id="d-pad-controls"'), template.indexOf('<div id="gameContainer">'));
	const bundle = await build({
		stdin: { contents: `export { BrowserOnscreenGamepad } from './hosts/browser/onscreen_gamepad';
export { BrowserOnscreenGamepadView } from './hosts/browser/onscreen_gamepad_view';
export { BrowserVideoOutput } from './hosts/browser/video_output';
export { BrowserHostClock } from './hosts/browser/timing';`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'layoutFixture', write: false, tsconfig: 'tsconfig.base.json',
	});
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 852, height: 393 }, isMobile: true, hasTouch: true });
	await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${await readFile('gamebase.css', 'utf8')}</style><div id="player-surface">${controls}<canvas id="gamescreen" width="320" height="240" style="display:block"></canvas></div>`);
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	await page.evaluate(() => {
		const api = (globalThis as any).layoutFixture;
		const pad = new api.BrowserOnscreenGamepad(new api.BrowserHostClock());
		pad.subscribe({ inputButton() {} });
		const view = new api.BrowserOnscreenGamepadView(document, window, pad);
		const video = new api.BrowserVideoOutput(document.getElementById('gamescreen'), view);
		video.refreshLayout();
		(globalThis as any).layoutProbe = {
			pad, view, video,
			measure() {
				return ['gamescreen', 'd-pad-controls', 'button-controls', 'd-pad-svg', 'a_knop', 'b_knop'].map(id => {
					const bounds = document.getElementById(id)!.getBoundingClientRect();
					return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
				});
			},
		};
	});
	const measure = () => page.evaluate(() => (globalThis as any).layoutProbe.measure());
	const nemesis = await measure();
	assert.equal(nemesis[0].width, 480);
	assert.equal(nemesis[0].height, 360);
	await page.evaluate(() => {
		(globalThis as any).layoutProbe.video.setDisplaySize(256, 192);
		(globalThis as any).layoutProbe.video.refreshLayout();
	});
	const pietsona = await measure();
	assert.equal(pietsona[0].width, 512);
	assert.equal(pietsona[0].height, 384);
	assert.deepEqual(pietsona.slice(1), nemesis.slice(1), 'control geometry is not derived from ROM framebuffer size');
	for (const [renderWidth, expectedWidth, expectedHeight] of [[321, 481.5, 361.125], [257, 514, 385.5]]) {
		await page.evaluate(width => {
			(globalThis as any).layoutProbe.video.setDisplaySize(width, 240);
			(globalThis as any).layoutProbe.video.refreshLayout();
		}, renderWidth);
		const odd = await measure();
		assert.equal(odd[0].width, expectedWidth);
		assert.equal(odd[0].height, expectedHeight);
		assert.deepEqual(odd.slice(1), nemesis.slice(1), 'odd framebuffer width does not alter control geometry');
	}

	for (const [width, height, expectedWidth, expectedHeight] of [
		[640, 480, 640, 480], [480, 360, 480, 360], [320, 240, 320, 240], [319, 239, 160, 120],
	]) {
		await page.setViewportSize({ width, height });
		await page.evaluate(() => {
			(globalThis as any).layoutProbe.video.setDisplaySize(320, 240);
			(globalThis as any).layoutProbe.video.refreshLayout();
		});
		const bounds = await measure();
		assert.equal(bounds[0].width, expectedWidth, `canvas width at ${width}x${height}`);
		assert.equal(bounds[0].height, expectedHeight, `canvas height at ${width}x${height}`);
		assert.ok(bounds[1].left >= 0 && bounds[1].top >= 0);
		assert.ok(bounds[2].left >= 0 && bounds[2].top >= 0);
		assert.ok(bounds[1].left + bounds[1].width <= width);
		assert.ok(bounds[2].left + bounds[2].width <= width);
	}

	await page.evaluate(() => {
		(globalThis as any).layoutProbe.video.setDisplaySize(321, 240);
		(globalThis as any).layoutProbe.video.refreshLayout();
	});
	const halfInteger = await measure();
	assert.equal(halfInteger[0].width, 160.5);
	assert.equal(halfInteger[0].height, 120.375);
	await page.setViewportSize({ width: 852, height: 393 });
	await page.evaluate(() => {
		const probe = (globalThis as any).layoutProbe;
		probe.video.setDisplaySize(320, 240);
		probe.video.refreshLayout();
		const a = document.getElementById('a_knop')!.getBoundingClientRect();
		probe.pad.beginContact(1, a.left + a.width / 2, a.top + a.height / 2, 14, 14, true);
	});
	await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
	const before = await measure();
	await page.setViewportSize({ width: 393, height: 852 });
	await page.evaluate(() => (globalThis as any).layoutProbe.video.refreshLayout());
	assert.equal(await page.evaluate(() => (globalThis as any).layoutProbe.pad.buttons), 0, 'a stationary contact follows moved geometry rather than its initial action label');
	const after = await measure();
	assert.notDeepEqual(after[4], before[4], 'orientation updates nominal action geometry');
	await page.evaluate(() => {
		const probe = (globalThis as any).layoutProbe;
		const b = document.getElementById('b_knop')!.getBoundingClientRect();
		probe.pad.moveContact(1, b.left + b.width / 2, b.top + b.height / 2, 14, 14, true);
		const a = document.getElementById('a_knop')!.getBoundingClientRect();
		probe.pad.beginContact(2, a.left + a.width / 2, a.top + a.height / 2, 14, 14, true);
	});
	assert.equal(await page.evaluate(() => (globalThis as any).layoutProbe.pad.buttons), 3);
	await page.evaluate(() => {
		(globalThis as any).layoutProbe.pad.cancelContacts();
		(globalThis as any).layoutProbe.view.dispose();
	});
});
