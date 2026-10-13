import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Real VisualViewport changes in desktop Chromium prove the browser-owner
// boundary, not Safari toolbar animation or physical iPhone touch delivery.
test('visual-only viewport changes fit the canvas without relocating held controls or deferring input edges', async t => {
	const template = await readFile('gamebase.html', 'utf8');
	let controls = template.slice(template.indexOf('<div id="controller-viewport"'), template.indexOf('<div id="gameContainer">'));
	for (const name of ['neutral', 'u', 'ru', 'r', 'rd', 'd', 'ld', 'l', 'lu']) {
		controls = controls.replace(`@@DPAD_${name.toUpperCase()}@@`, `data:image/png;base64,${(await readFile(`rom/d-pad-${name}.png`)).toString('base64')}`);
	}
	const bundle = await build({
		stdin: { contents: `export { BrowserOnscreenGamepad } from './hosts/browser/onscreen_gamepad';
export { BrowserOnscreenGamepadView } from './hosts/browser/onscreen_gamepad_view';
export { BrowserVideoOutput } from './hosts/browser/video_output';
export { BrowserInputHub } from './hosts/browser/input';
export { BrowserHostClock } from './hosts/browser/timing';
export { Input } from './hosts/common/input/manager';
export { createInputControllerSnapshot } from './machine/ts/machine/devices/input/contracts';`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'viewportFixture', write: false, tsconfig: 'tsconfig.base.json',
	});
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 852, height: 393 }, isMobile: true, hasTouch: true });
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${await readFile('gamebase.css', 'utf8')}</style><body class="game-started"><div id="player-surface">${controls}<canvas id="gamescreen" width="320" height="240" style="display:block"></canvas></div></body>`);
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	await page.evaluate(() => {
		const api = (globalThis as any).viewportFixture;
		const clock = new api.BrowserHostClock();
		const model = new api.BrowserOnscreenGamepad(clock);
		const view = new api.BrowserOnscreenGamepadView(document, window, model);
		const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
		const video = new api.BrowserVideoOutput(canvas, view);
		video.refreshLayout();
		const hub = new api.BrowserInputHub(canvas, document.getElementById('player-surface'), clock, model, 'F2');
		const snapshot = api.createInputControllerSnapshot();
		const native: Array<{ type: string; x: number; y: number; trusted: boolean }> = [];
		for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
			window.addEventListener(type, event => {
				const pointer = event as PointerEvent;
				native.push({ type, x: pointer.clientX, y: pointer.clientY, trusted: pointer.isTrusted });
			}, { capture: true, passive: true });
		}
		const input = new api.Input(clock, hub, model.gamepadIndex);
		const read = {
			bounds(id: string) {
				const rect = document.getElementById(id)!.getBoundingClientRect();
				return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
			},
		};
		(globalThis as any).viewportProbe = {
			model, video, input, native,
			measure() {
				input.pollInput();
				input.sampleInputControllerSnapshot(snapshot, 0);
				return {
					controller: read.bounds('controller-viewport'),
					controls: ['d-pad-svg', 'a_knop', 'b_knop', 'x_knop', 'y_knop', 'select_knop', 'start_knop', 'ls_knop', 'rs_knop'].map(id => read.bounds(id)),
					canvas: read.bounds('gamescreen'),
					visual: { width: visualViewport!.width, height: visualViewport!.height, scale: visualViewport!.scale },
					layout: { width: innerWidth, height: innerHeight },
					revision: model.geometryRevision, model: model.buttons,
					common: input.getPlayerInput(1).inputHandlers.gamepad.physicalGamepadButtonsWord(), sampled: snapshot.pads[0].buttons,
					native: native.slice(),
				};
			},
		};
	});
	const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
	const measure = () => page.evaluate(() => (globalThis as any).viewportProbe.measure());
	await settle();
	const initial = await measure();
	const a = initial.controls[1];
	const pad = initial.controls[0];
	const fingers = [
		{ id: 1, x: a.left + a.width / 2, y: a.top + a.height / 2, radiusX: 14, radiusY: 14 },
		{ id: 2, x: pad.left + pad.width / 2 + 70, y: pad.top + pad.height / 2, radiusX: 14, radiusY: 14 },
	];
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [fingers[0]] });
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers });
	await settle();
	const held = await measure();
	assert.deepEqual([held.model, held.common, held.sampled], [0x8001, 0x8001, 0x8001]);
	await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.1 });
	await settle();
	const resized = await measure();
	assert.deepEqual(resized.layout, initial.layout, 'the document viewport did not resize');
	assert.notDeepEqual(resized.visual, initial.visual, 'the actual browser VisualViewport did resize');
	assert.deepEqual(resized.controller, initial.controller, 'the authored small-viewport controller frame remains stable');
	assert.deepEqual(resized.controls, initial.controls, 'presentation and interaction retain the same client-space transform');
	assert.equal(resized.revision, held.revision, 'a visual-only change does not manufacture new controller geometry');
	assert.equal(resized.native.length, held.native.length, 'no native pointer sample was emitted by the visual-only change');
	assert.deepEqual([resized.model, resized.common, resized.sampled], [0x8001, 0x8001, 0x8001]);
	assert.notDeepEqual(resized.canvas, initial.canvas, 'canvas presentation still fits the dynamic visible space');
	assert.equal(resized.canvas.width / resized.canvas.height, 4 / 3);
	assert.equal(resized.canvas.width / 320 * 2 % 1, 0, 'canvas fitting retains integer/half-integer scaling');
	for (const finger of fingers) finger.x += 1;
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers });
	await settle();
	const jitter = await measure();
	assert.deepEqual([jitter.model, jitter.common, jitter.sampled], [0x8001, 0x8001, 0x8001], 'one-pixel native jitter cannot reveal a postponed layout release or direction switch');
	assert.deepEqual(jitter.controls, initial.controls);
	assert.ok(jitter.native.slice(held.native.length).every((event: any) => event.type === 'pointermove' && event.trusted));
	assert.equal(jitter.native.length - held.native.length, 2);
	const evidence = '.bmsx/hosting/touch-professional-audit';
	await mkdir(evidence, { recursive: true });
	await page.screenshot({ path: `${evidence}/stable-visual-viewport-held-jitter.png` });
	await writeFile(`${evidence}/stable-visual-viewport-held-jitter.json`, JSON.stringify({ initial, held, resized, jitter }, null, 2));
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	assert.deepEqual(await page.evaluate(() => {
		const probe = (globalThis as any).viewportProbe;
		const state = probe.measure();
		probe.input.dispose();
		probe.video.dispose();
		return [state.model, state.common, state.sampled];
	}), [0, 0, 0]);
	assert.deepEqual(errors, []);
});
