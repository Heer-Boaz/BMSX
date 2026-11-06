import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright';
import { PNG } from 'pngjs';
import type { RectBounds } from '../../machine/ts/common/rect';

type Rect = { left: number; top: number; width: number; height: number };
type Presentation = {
	dpr: number;
	selected: 'fit' | 'overscan';
	canvas: Rect;
	style: Rect;
	clip: string;
	backing: [number, number];
	logical: [number, number];
	frame: Rect;
	controls: Rect[];
	revision: number;
	model: number;
	portrait: boolean;
	visibleViewport: Readonly<RectBounds>;
	visibleIsRetained: boolean;
};

const DPR_PROFILES = [1, 1.25, 2, 2.625, 3];
const FRAMEBUFFERS = [256, 257, 320, 321];
const cssTolerance = 1 / 32;

const fixture = (async () => {
	const template = await readFile('gamebase.html', 'utf8');
	const controls = template.slice(template.indexOf('<div id="controller-viewport"'), template.indexOf('<div id="gameContainer">'));
	const bundle = await build({
		stdin: { contents: `export { BrowserOnscreenGamepad } from './hosts/browser/onscreen_gamepad';
export { BrowserOnscreenGamepadView } from './hosts/browser/onscreen_gamepad_view';
export { BrowserVideoOutput } from './hosts/browser/video_output';
export { BrowserTextInput } from './hosts/browser/text_input';
export { BrowserInputHub } from './hosts/browser/input';
export { BrowserHostClock } from './hosts/browser/timing';
export { BrowserFrameLoop } from './hosts/browser/frame_loop';
export { Input } from './hosts/common/input/manager';
export { createInputControllerSnapshot } from './machine/ts/machine/devices/input/contracts';
export { workbenchPixelsPerUnit } from './ide/workbench/common/display_scale';
export { mapDisplayPointToViewport } from './machine/ts/render/video_output';`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'videoFixture', write: false, tsconfig: 'tsconfig.base.json',
	});
	return { controls, css: await readFile('gamebase.css', 'utf8'), script: bundle.outputFiles[0].text };
})();

async function openFixture(browser: Browser, dpr: number, viewport: { width: number; height: number }, controls: boolean, insets: number[], screenFit: 'fit' | 'overscan', observeResolution = false): Promise<Page> {
	const resources = await fixture;
	const page = await browser.newPage({ viewport, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
	await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${resources.css}</style><body class="game-started"><div id="player-surface" style="padding:${insets.map(inset => `${inset}px`).join(' ')}">${controls ? resources.controls : ''}<canvas id="gamescreen" width="320" height="240" style="display:block"></canvas></div></body>`);
	await page.addScriptTag({ content: resources.script });
	await page.evaluate(({ controls, screenFit, observeResolution }) => {
		const api = (globalThis as any).videoFixture;
		const resolutionQueries: MediaQueryList[] = [];
		if (observeResolution) {
			const browserMatchMedia = window.matchMedia;
			const observer = { query(query: string) {
				const source = browserMatchMedia.call(window, query);
				resolutionQueries.push(source);
				return source;
			} };
			window.matchMedia = observer.query;
		}
		const clock = new api.BrowserHostClock();
		const model = controls ? new api.BrowserOnscreenGamepad(clock) : null;
		const view = controls ? new api.BrowserOnscreenGamepadView(document, window, model) : null;
		const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
		const video = new api.BrowserVideoOutput(canvas, view, screenFit);
		video.refreshLayout();
		const frames = new api.BrowserFrameLoop(video).start(() => {});
		const retainedVisibleViewport = video.visibleViewportBounds;
		const hub = new api.BrowserInputHub(canvas, document.getElementById('player-surface'), clock, model, 'F2');
		const input = new api.Input(clock, hub, controls ? model.gamepadIndex : 0);
		const snapshot = api.createInputControllerSnapshot();
		const native: Array<{ type: string; target: string; trusted: boolean; x: number; y: number }> = [];
		for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) window.addEventListener(type, event => {
			const pointer = event as PointerEvent;
			native.push({ type, target: (pointer.target as HTMLElement).id, trusted: pointer.isTrusted, x: pointer.clientX, y: pointer.clientY });
		}, { capture: true, passive: true });
		const read = { rect(element: Element) {
			const bounds = element.getBoundingClientRect();
			return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
		} };
		(globalThis as any).videoProbe = {
			video, view, model, native,
			resolutionQueries() { return resolutionQueries.map(source => ({ media: source.media, matches: source.matches })); },
			notifyResolution(index: number) {
				const source = resolutionQueries[index];
				source.dispatchEvent(new MediaQueryListEvent('change', { matches: source.matches, media: source.media }));
			},
			measure() {
				const player = read.rect(document.getElementById('player-surface')!);
				const css = getComputedStyle(document.getElementById('player-surface')!);
				const visual = visualViewport!;
				const left = Math.max(player.left, visual.offsetLeft + parseFloat(css.paddingLeft));
				const top = Math.max(player.top, visual.offsetTop + parseFloat(css.paddingTop));
				const right = Math.min(player.left + player.width, visual.offsetLeft + visual.width - parseFloat(css.paddingRight));
				const bottom = Math.min(player.top + player.height, visual.offsetTop + visual.height - parseFloat(css.paddingBottom));
				const visible = video.visibleViewportBounds;
				return {
					dpr: devicePixelRatio, selected: video.screenFit, canvas: read.rect(canvas),
					style: { left: parseFloat(canvas.style.left), top: parseFloat(canvas.style.top), width: parseFloat(canvas.style.width), height: parseFloat(canvas.style.height) },
					clip: canvas.style.clipPath, backing: [canvas.width, canvas.height],
					logical: [video.geometry.viewportWidth, video.geometry.viewportHeight],
					frame: { left, top, width: right - left, height: Math.min(bottom, view?.portraitDeckTop ?? bottom) - top },
					controls: controls ? ['d-pad-svg', 'a_knop', 'b_knop', 'x_knop', 'y_knop', 'select_knop', 'start_knop', 'ls_knop', 'rs_knop', 'lb_knop', 'rb_knop', 'lt_knop', 'rt_knop'].map(id => read.rect(document.getElementById(id)!)) : [],
					revision: controls ? model.geometryRevision : 0, model: controls ? model.buttons : 0, portrait: controls && view.portraitDeckTop !== null,
					visibleViewport: { left: visible.left, top: visible.top, right: visible.right, bottom: visible.bottom },
					visibleIsRetained: visible === retainedVisibleViewport,
				};
			},
			poll() {
				input.pollInput();
				input.sampleInputControllerSnapshot(snapshot, 0);
				const state = input.getPlayerInput(1).inputHandlers.pointer.getButtonState('pointer_position');
				const mapped = { x: 0, y: 0 };
				const mapping = api.mapDisplayPointToViewport(video.measureDisplay(), 320, 240, state.value2d[0], state.value2d[1], mapped);
				return { buttons: snapshot.pointerButtons, position: [state.value2d[0], state.value2d[1]], mapping, mapped, native: native.slice() };
			},
			dispose() { frames.stop(); input.dispose(); video.dispose(); },
		};
	}, { controls, screenFit, observeResolution });
	return page;
}

const settle = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const measure = (page: Page): Promise<Presentation> => page.evaluate(() => (globalThis as any).videoProbe.measure());

function assertPresentation(presentation: Presentation, nativeWidth: number, overscan: boolean): void {
	const { style: image, frame, dpr } = presentation;
	const factor = image.width * dpr / nativeWidth;
	assert.ok(image.width > 0 && image.height > 0, 'the selected composition always gives the game a positive picture');
	// CSSOM serializes authored fractional lengths with finite decimal
	// precision; the DOM additionally quantizes layout to 1/64 CSS pixels.
	assert.ok(Math.abs(factor * 2 - Math.round(factor * 2)) < 1e-5, `scale is an integer/half step in physical display pixels: ${JSON.stringify({ factor, dpr, width: image.width, nativeWidth })}`);
	assert.ok(Math.abs(image.width / image.height - 4 / 3) < 1e-5, 'hardware display aspect remains 4:3 through CSSOM serialization');
	const cropLeft = Math.max(0, frame.left - image.left);
	const cropTop = Math.max(0, frame.top - image.top);
	const cropRight = Math.max(0, image.left + image.width - frame.left - frame.width);
	const cropBottom = Math.max(0, image.top + image.height - frame.top - frame.height);
	const limit = overscan ? 0.05 : 0;
	for (const crop of [cropLeft, cropRight]) assert.ok(crop <= limit * image.width + cssTolerance, 'horizontal crop is bounded per full image edge');
	for (const crop of [cropTop, cropBottom]) assert.ok(crop <= limit * image.height + cssTolerance, 'vertical crop is bounded per full image edge');
	assert.ok(Math.abs(image.left + image.width / 2 - frame.left - frame.width / 2) < cssTolerance, 'image is horizontally centred');
	if (!presentation.portrait || image.height > frame.height + cssTolerance) assert.ok(Math.abs(image.top + image.height / 2 - frame.top - frame.height / 2) < cssTolerance, 'landscape and height-overflow cropping are vertically centred');
	else assert.equal(image.top, frame.top, 'portrait begins at the safe top whenever the complete image height fits');
	// Independent maximality oracle: the next half step exceeds at least one
	// allowed axis. Do not duplicate the production truncation expression.
	const nextWidth = nativeWidth * (factor + 0.5) / dpr;
	const nextHeight = nextWidth * 3 / 4;
	const visibleFraction = overscan ? 0.9 : 1;
	assert.ok(nextWidth * visibleFraction > frame.width || nextHeight * visibleFraction > frame.height, 'the largest permitted half step was selected');
	for (const field of ['left', 'top', 'width', 'height'] as const) assert.ok(Math.abs(presentation.canvas[field] - image[field]) <= cssTolerance, `painted ${field} follows authored presentation`);
	if (!overscan) assert.equal(presentation.clip, 'none');
	else {
		const match = presentation.clip.match(/^inset\((.*)\)$/);
		assert.ok(match, 'overscan uses the actual native CSS clip shape');
		const lengths = match[1].split(' ').map(value => parseFloat(value));
		const inset = lengths.length === 1 ? [lengths[0], lengths[0], lengths[0], lengths[0]]
			: lengths.length === 2 ? [lengths[0], lengths[1], lengths[0], lengths[1]]
				: lengths.length === 3 ? [lengths[0], lengths[1], lengths[2], lengths[1]] : lengths;
		assert.equal(inset.length, 4);
		for (let index = 0; index < 4; index++) assert.ok(Math.abs(inset[index] - [cropTop, cropRight, cropBottom, cropLeft][index]) < cssTolerance, 'CSS clip matches safe frame and deck intersection');
	}
}

function assertVisibleViewport(presentation: Presentation, nativeWidth: number, nativeHeight: number): void {
	const { style: image, frame, visibleViewport } = presentation;
	const expected = {
		left: Math.max(0, frame.left - image.left) / image.width * nativeWidth,
		top: Math.max(0, frame.top - image.top) / image.height * nativeHeight,
		right: (Math.min(frame.left + frame.width, image.left + image.width) - image.left) / image.width * nativeWidth,
		bottom: (Math.min(frame.top + frame.height, image.top + image.height) - image.top) / image.height * nativeHeight,
	};
	for (const side of ['left', 'top', 'right', 'bottom'] as const) assert.ok(Math.abs(visibleViewport[side] - expected[side]) < cssTolerance,
		`${side} is the actual clipped region projected into full raw logical target dimensions`);
	assert.equal(presentation.visibleIsRetained, true, 'layout publication retains one central rectangle object across all changes');
}

test('browser video fitting uses physical half steps, bounded selected policy and independent controller geometry', async t => {
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const errors: string[] = [];
	for (const dpr of DPR_PROFILES) for (const orientation of ['portrait', 'landscape'] as const) await t.test(`${orientation} at native DPR ${dpr}`, async () => {
		const page = await openFixture(browser, dpr, orientation === 'portrait' ? { width: 393, height: 852 } : { width: 852, height: 393 }, true,
			orientation === 'portrait' ? [47, 0, 34, 0] : [0, 47, 21, 43], 'fit');
		page.on('pageerror', error => errors.push(error.message));
		try {
			const initial = await measure(page);
			assert.equal(initial.dpr, dpr, 'native browser DPR is not simulated with a JS property');
			assert.equal(initial.selected, 'fit', 'fixture explicitly selects uncropped presentation');
			assertVisibleViewport(initial, 320, 240);
			for (const width of FRAMEBUFFERS) {
				await page.evaluate(width => {
					const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
					canvas.width = width;
					canvas.height = 239;
					const video = (globalThis as any).videoProbe.video;
					video.setDisplaySize(width, 239, width, 239);
					video.setScreenFit('fit');
					video.refreshLayout();
				}, width);
				const fitted = await measure(page);
				assertPresentation(fitted, width, false);
				assertVisibleViewport(fitted, width, 239);
				assert.deepEqual(fitted.backing, [width, 239], 'presentation does not reinterpret or resize raw backing dimensions');
				assert.deepEqual(fitted.controls, initial.controls, 'scanout widths never resize or move touch targets');
				await page.evaluate(() => (globalThis as any).videoProbe.video.setScreenFit('overscan'));
				const enlarged = await measure(page);
				assertPresentation(enlarged, width, true);
				assertVisibleViewport(enlarged, width, 239);
				assert.equal(enlarged.selected, 'overscan');
				assert.ok(enlarged.style.width >= fitted.style.width);
				assert.deepEqual(enlarged.controls, initial.controls, 'presentation policy never resamples authored controller geometry');
				assert.equal(enlarged.revision, initial.revision);
				assert.deepEqual(enlarged.backing, fitted.backing);
				await page.evaluate(() => (globalThis as any).videoProbe.video.refreshLayout());
				const retained = await measure(page);
				assert.equal(retained.selected, 'overscan', 'ordinary layout refresh does not reinterpret the chosen picture policy');
				assert.deepEqual(retained.style, enlarged.style);
				assert.deepEqual(retained.visibleViewport, enlarged.visibleViewport);
				assert.equal(retained.visibleIsRetained, true);
				await page.evaluate(() => (globalThis as any).videoProbe.video.setScreenFit('fit'));
				const restored = await measure(page);
				assert.deepEqual(restored.style, fitted.style, 'explicit Fit selection restores the full image');
				assertVisibleViewport(restored, width, 239);
			}
		} finally { await page.evaluate(() => (globalThis as any).videoProbe.dispose()); await page.close(); }
	});
	assert.deepEqual(errors, []);
});

test('short portrait players retain a full-frame quantized picture rather than an impossible reserved deck', async t => {
	const browser = await chromium.launch();
	t.after(() => browser.close());
	for (const viewport of [{ width: 320, height: 321 }, { width: 320, height: 360 }, { width: 393, height: 394 }, { width: 600, height: 601 }]) {
		for (const dpr of [1, 2.625]) await t.test(`${viewport.width}x${viewport.height} at DPR ${dpr}`, async () => {
			const page = await openFixture(browser, dpr, viewport, true, [0, 0, 0, 0], 'fit');
			try {
				const initial = await measure(page);
				assert.equal(await page.evaluate(() => (globalThis as any).videoProbe.view.layoutProfile), 'compact-overlay');
				assert.equal(initial.portrait, false, 'portrait orientation alone does not reserve an unusable deck');
				assert.deepEqual(initial.frame, { left: 0, top: 0, ...viewport }, 'the composition owner gives the picture the whole usable player');
				for (const width of FRAMEBUFFERS) for (const policy of ['fit', 'overscan'] as const) {
					await page.evaluate(({ width, policy }) => {
						const video = (globalThis as any).videoProbe.video;
						video.setDisplaySize(width, 239, width, 239);
						video.setScreenFit(policy);
						video.refreshLayout();
					}, { width, policy });
					const current = await measure(page);
					assertPresentation(current, width, policy === 'overscan');
					assertVisibleViewport(current, width, 239);
					assert.deepEqual(current.controls, initial.controls, 'changing picture policy or odd scanout dimensions never rearranges controls');
					assert.equal(current.revision, initial.revision);
				}
			} finally { await page.evaluate(() => (globalThis as any).videoProbe.dispose()); await page.close(); }
		});
	}
});

test('explicit Overscan construction preserves the selected picture policy independently of viewport publication', async t => {
	const browser = await chromium.launch();
	t.after(() => browser.close());
	for (const orientation of ['portrait', 'landscape'] as const) await t.test(orientation, async () => {
		const page = await openFixture(browser, 3, orientation === 'portrait' ? { width: 393, height: 852 } : { width: 852, height: 393 }, true,
			orientation === 'portrait' ? [47, 0, 34, 0] : [19, 47, 21, 43], 'overscan');
		try {
			const initial = await measure(page);
			assert.equal(initial.selected, 'overscan', 'the required constructor argument selects presentation from the first layout');
			assertPresentation(initial, 320, true);
			assertVisibleViewport(initial, 320, 240);
			await page.evaluate(() => (globalThis as any).videoProbe.video.refreshLayout());
			const repeated = await measure(page);
			assert.equal(repeated.selected, 'overscan');
			assert.deepEqual(repeated.style, initial.style);
			assert.deepEqual(repeated.visibleViewport, initial.visibleViewport);
			assert.equal(repeated.visibleIsRetained, true);
			await page.evaluate(() => (globalThis as any).videoProbe.video.setScreenFit('fit'));
			const fitted = await measure(page);
			assert.equal(fitted.selected, 'fit', 'only the explicit policy operation chooses an uncropped image');
			assertPresentation(fitted, 320, false);
			assertVisibleViewport(fitted, 320, 240);
			assert.deepEqual(fitted.visibleViewport, { left: 0, top: 0, right: 320, bottom: 240 });
			assert.deepEqual(fitted.controls, initial.controls);
			await page.evaluate(() => (globalThis as any).videoProbe.video.setScreenFit('overscan'));
			const restored = await measure(page);
			assert.deepEqual(restored.style, initial.style);
			assert.deepEqual(restored.visibleViewport, initial.visibleViewport);
			assert.equal(restored.visibleIsRetained, true);
			const synchronousResize = await page.evaluate(() => {
				const probe = (globalThis as any).videoProbe;
				const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
				const before = probe.measure();
				const visible = probe.video.visibleViewportBounds;
				canvas.width = 257;
				canvas.height = 239;
				probe.video.setDisplaySize(257, 239, 257, 239);
				return {
					before,
					visible: { left: visible.left, top: visible.top, right: visible.right, bottom: visible.bottom },
					retained: visible === probe.video.visibleViewportBounds,
					css: { width: parseFloat(canvas.style.width), height: parseFloat(canvas.style.height) },
				};
			});
			for (const side of ['left', 'right'] as const) assert.ok(Math.abs(synchronousResize.visible[side] - synchronousResize.before.visibleViewport[side] / 320 * 257) < 1e-10,
				'target width changes synchronously rebase the retained visible fractions before queued CSS layout');
			for (const side of ['top', 'bottom'] as const) assert.ok(Math.abs(synchronousResize.visible[side] - synchronousResize.before.visibleViewport[side] / 240 * 239) < 1e-10,
				'target height changes synchronously use raw logical height, never synthetic 4:3 height');
			assert.equal(synchronousResize.retained, true);
			assert.deepEqual(synchronousResize.css, { width: initial.style.width, height: initial.style.height }, 'logical clip publication precedes the queued CSS transform change');
			await settle(page);
			assertVisibleViewport(await measure(page), 257, 239);
		} finally { await page.evaluate(() => (globalThis as any).videoProbe.dispose()); await page.close(); }
	});
});

test('portrait overscan uses spare vertical space without cropping source top or bottom HUD rows', async t => {
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await openFixture(browser, 3, { width: 393, height: 852 }, true, [47, 0, 34, 0], 'fit');
	const fitted = await measure(page);
	assertPresentation(fitted, 320, false);
	assertVisibleViewport(fitted, 320, 240);
	await page.evaluate(() => (globalThis as any).videoProbe.video.setScreenFit('overscan'));
	const enlarged = await measure(page);
	assertPresentation(enlarged, 320, true);
	assertVisibleViewport(enlarged, 320, 240);
	assert.ok(Math.abs(enlarged.style.width - 1280 / 3) < 0.001, 'the next physical integer scale is 426.667 CSS pixels, not the excessive 480 CSS step');
	assert.equal(enlarged.style.height, 320);
	assert.ok(enlarged.frame.height >= enlarged.style.height, 'portrait video allocation reserves legitimate spare height before positioning the deck');
	assert.equal(enlarged.style.top, enlarged.frame.top);
	assert.ok(enlarged.style.top + enlarged.style.height <= enlarged.frame.top + enlarged.frame.height);
	assert.deepEqual(enlarged.frame, fitted.frame, 'Fit and Overscan share one stable authored video slot');
	assert.deepEqual(enlarged.controls, fitted.controls);
	for (const width of [256, 257, 321, 320]) {
		await page.evaluate(width => {
			const video = (globalThis as any).videoProbe.video;
			video.setDisplaySize(width, 240, width, 240);
			video.refreshLayout();
		}, width);
		const changed = await measure(page);
		assertVisibleViewport(changed, width, 240);
		assert.deepEqual(changed.frame, enlarged.frame, 'scanout resolution cannot move the allocated deck');
		assert.deepEqual(changed.controls, enlarged.controls);
	}
	await page.evaluate(() => {
		const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
		const context = canvas.getContext('2d')!;
		context.fillStyle = '#20a0c0';
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.fillStyle = '#40b040';
		context.fillRect(0, 0, canvas.width, 1);
		context.fillStyle = '#d030b0';
		context.fillRect(0, canvas.height - 1, canvas.width, 1);
	});
	await mkdir('.bmsx/hosting/display-spatial-reference-evidence', { recursive: true });
	const screenshot = PNG.sync.read(await page.screenshot({ path: '.bmsx/hosting/display-spatial-reference-evidence/portrait-source-edges-visible.png' }));
	const sourceRowHeight = enlarged.style.height / enlarged.backing[1];
	for (const [y, expected] of [
		[enlarged.style.top + sourceRowHeight / 2, [0x40, 0xb0, 0x40, 0xff]],
		[enlarged.style.top + enlarged.style.height - sourceRowHeight / 2, [0xd0, 0x30, 0xb0, 0xff]],
	] as const) {
		const pixel = (Math.trunc(y * enlarged.dpr) * screenshot.width + Math.trunc((enlarged.frame.left + enlarged.frame.width / 2) * enlarged.dpr)) * 4;
		assert.deepEqual([...screenshot.data.subarray(pixel, pixel + 4)], expected, 'the actual first and last source rows remain painted, including the bottom HUD edge');
	}
	await page.evaluate(() => (globalThis as any).videoProbe.dispose());
});

test('resolution observer rearms after native DPR samples and explicitly test-generated media-query notifications', async t => {
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await openFixture(browser, 1, { width: 393, height: 852 }, true, [47, 0, 34, 0], 'fit', true);
	const cdp = await page.context().newCDPSession(page);
	const initial = await measure(page);
	assert.deepEqual(await page.evaluate(() => (globalThis as any).videoProbe.resolutionQueries()), [{ media: '(resolution: 1dppx)', matches: true }]);
	let queryIndex = 0;
	// Chromium's CDP metrics override changes devicePixelRatio and query.matches
	// without emitting a resolution change event. Notify the captured native
	// MediaQueryList explicitly: this proves the owner's subscription contract,
	// not operating-system monitor changes or Safari notification delivery.
	for (const dpr of [3, 1.25, 2.625, 1]) {
		await cdp.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: dpr, mobile: true });
		await page.evaluate(index => (globalThis as any).videoProbe.notifyResolution(index), queryIndex);
		queryIndex++;
		await settle(page);
		const changed = await measure(page);
		assert.equal(changed.dpr, dpr);
		assertPresentation(changed, 320, false);
		assertVisibleViewport(changed, 320, 240);
		assert.deepEqual(changed.frame, initial.frame, 'CSS video slot does not follow physical pixel density');
		assert.deepEqual(changed.controls, initial.controls);
		assert.equal(changed.revision, initial.revision);
		assert.deepEqual(changed.backing, initial.backing);
		const queries = await page.evaluate(() => (globalThis as any).videoProbe.resolutionQueries());
		assert.equal(queries.length, queryIndex + 1);
		assert.deepEqual(queries.at(-1), { media: `(resolution: ${dpr}dppx)`, matches: true }, 'subscription was rearmed for the current native DPR');
		await page.evaluate(index => (globalThis as any).videoProbe.notifyResolution(index), queryIndex - 1);
		assert.equal((await page.evaluate(() => (globalThis as any).videoProbe.resolutionQueries())).length, queryIndex + 1, 'old resolution source was unsubscribed');
	}
	await page.evaluate(() => (globalThis as any).videoProbe.dispose());
	await page.evaluate(index => (globalThis as any).videoProbe.notifyResolution(index), queryIndex);
	assert.equal((await page.evaluate(() => (globalThis as any).videoProbe.resolutionQueries())).length, queryIndex + 1, 'teardown unsubscribes the last resolution source');
});

test('native clip hit testing excludes hidden pixels but preserves visible pointer mapping and captured source lifetime', async t => {
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await openFixture(browser, 3, { width: 852, height: 393 }, false, [19, 47, 21, 43], 'fit');
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.evaluate(() => (globalThis as any).videoProbe.video.setScreenFit('overscan'));
	await page.evaluate(() => {
		const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
		const context = canvas.getContext('2d')!;
		context.fillStyle = '#20a0c0';
		context.fillRect(0, 0, canvas.width, canvas.height);
	});
	const image = await measure(page);
	assertPresentation(image, 320, true);
	assertVisibleViewport(image, 320, 240);
	assert.ok(image.canvas.top < image.frame.top, 'profile genuinely clips visible viewport pixels above the safe image frame');
	const hidden = { id: 1, x: image.canvas.left + image.canvas.width / 2, y: (image.canvas.top + image.frame.top) / 2, radiusX: 1, radiusY: 1 };
	const visible = { ...hidden, x: image.frame.left + image.frame.width / 2 + 37, y: image.frame.top + 71 };
	const cdp = await page.context().newCDPSession(page);
	const poll = () => page.evaluate(() => (globalThis as any).videoProbe.poll());
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [hidden] });
	let state = await poll();
	assert.equal(state.buttons, 0, 'native touch over clipped-away canvas pixels cannot acquire a canvas lease');
	assert.equal(state.native.at(-1).target, 'player-surface');
	assert.equal(state.native.at(-1).trusted, true);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await poll();
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [visible] });
	state = await poll();
	assert.equal(state.buttons, 1);
	assert.equal(state.native.at(-1).target, 'gamescreen');
	assert.equal(state.mapping, 2);
	assert.deepEqual(state.mapped, { x: ((visible.x - image.canvas.left) / image.canvas.width * 320) | 0, y: ((visible.y - image.canvas.top) / image.canvas.height * 240) | 0 }, 'visible coordinates map through the complete image, not a stretched clipped rectangle');
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [hidden] });
	state = await poll();
	assert.equal(state.buttons, 1, 'a visible acquisition retains ordinary pointer capture when its finger crosses the clip boundary');
	assert.equal(state.native.at(-1).target, 'gamescreen');
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	assert.equal((await poll()).buttons, 0, 'only the real native up ends the captured source');
	await mkdir('.bmsx/hosting/display-spatial-reference-evidence', { recursive: true });
	const screenshot = PNG.sync.read(await page.screenshot({ path: '.bmsx/hosting/display-spatial-reference-evidence/native-overscan-clip.png' }));
	for (const [point, expected] of [[hidden, [0x10, 0x10, 0x10, 0xff]], [visible, [0x20, 0xa0, 0xc0, 0xff]]] as const) {
		const pixel = (Math.trunc(point.y * image.dpr) * screenshot.width + Math.trunc(point.x * image.dpr)) * 4;
		assert.deepEqual([...screenshot.data.subarray(pixel, pixel + 4)], expected, 'native clipping agrees with actual canvas painting, not only numeric bounds');
	}
	await page.evaluate(() => (globalThis as any).videoProbe.dispose());
	assert.deepEqual(errors, []);
});

for (const viewport of [{ width: 1920, height: 1080, logicalWidth: 640 }, { width: 3840, height: 2160, logicalWidth: 1280 },
	{ width: 390, height: 844, logicalWidth: 384 }])
	test(`adaptive workspace uses the host area at ${viewport.width}x${viewport.height}, without changing game fitting`, async t => {
		const browser = await chromium.launch(); t.after(() => browser.close());
		for (const dpr of [1, 3]) {
			const page = await openFixture(browser, dpr, viewport, false, [0, 0, 0, 0], 'overscan');
			try {
				const game = await measure(page);
				await page.evaluate(() => {
					const { video } = (globalThis as any).videoProbe;
					const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
					const probe = (globalThis as any).videoProbe;
					probe.uiScale = 1;
					video.workspace.open(({ width: availableWidth, height: availableHeight, pixelWidth, pixelHeight }) => {
						const scale = (globalThis as any).videoFixture.workbenchPixelsPerUnit(availableWidth, probe.uiScale);
						canvas.width = pixelWidth; canvas.height = pixelHeight;
						video.setDisplaySize(pixelWidth, pixelHeight, Math.trunc(availableWidth / scale), Math.trunc(availableHeight / scale));
					});
					video.setPointerCursor('col-resize');
				});
				await settle(page);
				const workspace = await measure(page);
				assert.equal(workspace.clip, 'none', 'game overscan must not crop editor chrome');
				assert.ok(Math.abs(workspace.style.width - viewport.width) < 3);
				assert.ok(Math.abs(workspace.style.height - viewport.height) < 3);
				assert.equal(workspace.logical[0], viewport.logicalWidth,
					'DPR does not change logical UI size; larger desktop areas add working space');
				assert.deepEqual(workspace.backing, [viewport.width * dpr, viewport.height * dpr], 'the raster fills the physical display');
				const cursor = await page.evaluate(() => getComputedStyle(document.getElementById('gamescreen')!).cursor);
				assert.equal(cursor, 'col-resize', 'the host publishes the shared input owner cursor');
				await page.evaluate(() => { const probe = (globalThis as any).videoProbe; probe.uiScale = 1.25; probe.video.workspace.refresh(); });
				await settle(page);
				const scaled = await measure(page);
				assert.ok(scaled.logical[0] < workspace.logical[0]);
				assert.deepEqual(scaled.backing, workspace.backing, 'UI scale does not resize the physical buffer');
				assert.ok(Math.abs(scaled.style.width - viewport.width) < 4);
				await page.setViewportSize({ width: viewport.width - 80, height: viewport.height - 60 });
				await settle(page);
				const resized = await measure(page);
				assert.ok(Math.abs(resized.style.width - (viewport.width - 80)) < 4,
					'the real resize observer updates workspace allocation and display transform');
				await page.setViewportSize(viewport); await settle(page);
				await page.evaluate(() => {
					const { video } = (globalThis as any).videoProbe;
					video.workspace.close(); video.setPointerCursor('default');
					const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
					canvas.width = 320; canvas.height = 240;
					video.setDisplaySize(320, 240, 320, 240); video.refreshLayout();
				});
				const resumed = await measure(page);
				assert.deepEqual(resumed.style, game.style, 'game aspect, fit policy and target return unchanged');
				assert.deepEqual(resumed.visibleViewport, game.visibleViewport);
			} finally { await page.evaluate(() => (globalThis as any).videoProbe.dispose()); await page.close(); }
		}
	});


test('native text composition follows the published canvas transform even when logical workspace size does not change', async t => {
	const browser = await chromium.launch(); t.after(() => browser.close());
	const page = await openFixture(browser, 2, { width: 800, height: 600 }, false, [0, 0, 0, 0], 'fit');
	await page.evaluate(() => {
		const api = (globalThis as any).videoFixture, probe = (globalThis as any).videoProbe;
		const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
		probe.uiScale = 1;
		probe.video.workspace.open(({ width, height, pixelWidth, pixelHeight }) => {
			const scale = api.workbenchPixelsPerUnit(width, probe.uiScale);
			canvas.width = pixelWidth; canvas.height = pixelHeight;
			probe.video.setDisplaySize(pixelWidth, pixelHeight, Math.trunc(width / scale), Math.trunc(height / scale));
		});
		const caret = { x: 32, y: 24, width: 1, height: 8 }, edits: string[] = [];
		let text = '';
		const target = { revision: 0, readOnly: false, caretRect() { return caret; },
			readText() { return { text, selectionStart: text.length, selectionEnd: text.length, offset: 0 }; },
			setSelection() {}, replaceText(from: number, to: number, value: string) {
				text = text.slice(0, from) + value + text.slice(to); edits.push(value); target.revision++; return true;
			} };
		const input = new api.BrowserTextInput(canvas, probe.video.geometry, { textTarget: target, dispatchKey() { return false; },
			cancelInput() {}, cancelPointerInput() {}, onDidChangeTarget() { return () => {}; } });
		(globalThis as any).nativeTransform = { input, caret, edits, textarea: document.querySelector('textarea'),
			dispose() { input.dispose(); probe.dispose(); } };
	});
	try {
		await settle(page);
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Input.imeSetComposition', { text: '日本', selectionStart: 2, selectionEnd: 2 });
		const before = await measure(page);
		await page.setViewportSize({ width: 400, height: 300 }); await settle(page);
		const after = await measure(page);
		assert.deepEqual(after.logical, before.logical, 'this compact host resize preserves logical workspace size');
		assert.deepEqual(after.backing, [800, 600]);
		assert.notDeepEqual(after.backing, before.backing);
		await page.evaluate(() => {
			const probe = (globalThis as any).videoProbe;
			probe.uiScale = 1.25; probe.video.workspace.refresh();
		});
		await settle(page);
		const scaled = await measure(page);
		assert.deepEqual(scaled.backing, after.backing, 'UI-only scaling keeps the physical raster allocation');
		assert.notDeepEqual(scaled.logical, after.logical);
		const anchor = await page.evaluate(() => {
			const context = (globalThis as any).nativeTransform;
			context.input.refresh(); // Ordinary Studio frame refresh cannot depend on a document/caret change.
			const canvas = document.getElementById('gamescreen') as HTMLCanvasElement, rect = canvas.getBoundingClientRect();
			const textarea = document.querySelector('textarea')!, box = textarea.getBoundingClientRect(), caret = context.caret;
			const { viewportWidth, viewportHeight } = (globalThis as any).videoProbe.video.geometry;
			return { actual: [box.left, box.top, box.height],
				expected: [rect.left + caret.x * rect.width / viewportWidth, rect.top + caret.y * rect.height / viewportHeight,
					caret.height * rect.height / viewportHeight], same: context.textarea === textarea,
				focused: document.activeElement === textarea, pending: textarea.value, edits: context.edits };
		});
		// This geometry is the IME candidate anchor contract, not a UI screenshot oracle.
		for (let index = 0; index < anchor.actual.length; index++) assert.ok(Math.abs(anchor.actual[index] - anchor.expected[index]) < cssTolerance,
			'native IME geometry must follow the final canvas transform, not the earlier window resize event');
		assert.ok(anchor.same && anchor.focused, 'layout must not retire the focused native composition');
		assert.equal(anchor.pending, '日本'); assert.deepEqual(anchor.edits, []);
		await cdp.send('Input.insertText', { text: '日本' });
		assert.deepEqual(await page.evaluate(() => (globalThis as any).nativeTransform.edits), ['日本']);
		const translated = await page.evaluate(() => {
			const context = (globalThis as any).nativeTransform, probe = (globalThis as any).videoProbe;
			const canvas = document.getElementById('gamescreen') as HTMLCanvasElement, measureCanvas = canvas.getBoundingClientRect.bind(canvas);
			const published = probe.video.measureDisplay();
			let reads = 0;
			canvas.getBoundingClientRect = () => { reads++; return measureCanvas(); };
			canvas.style.transform = 'translate(17.25px, 9.5px)';
			probe.video.refreshLayout();
			for (let i = 0; i < 10; i++) { context.input.refresh(); probe.video.measureDisplay(); }
			const actual = measureCanvas(), caret = context.caret, textarea = context.textarea.getBoundingClientRect();
			const point = { x: 0, y: 0 }, api = (globalThis as any).videoFixture;
			const { viewportWidth, viewportHeight } = probe.video.geometry;
			api.mapDisplayPointToViewport(probe.video.measureDisplay(), viewportWidth, viewportHeight,
				actual.left + actual.width / 2, actual.top + actual.height / 2, point);
			canvas.getBoundingClientRect = measureCanvas;
			return { reads, retained: published === probe.video.measureDisplay(),
				anchor: [textarea.left, textarea.top], expected: [actual.left + caret.x * actual.width / viewportWidth,
					actual.top + caret.y * actual.height / viewportHeight], point, midpoint: { x: Math.trunc(viewportWidth / 2), y: Math.trunc(viewportHeight / 2) },
				focused: document.activeElement === context.textarea, edits: context.edits };
		});
		assert.equal(translated.reads, 1, 'only the output measures canvas geometry; native text and pointer consumers read the retained publication');
		assert.equal(translated.retained, true);
		assert.deepEqual(translated.point, translated.midpoint);
		for (let axis = 0; axis < 2; axis++) assert.ok(Math.abs(translated.anchor[axis] - translated.expected[axis]) < cssTolerance);
		assert.equal(translated.focused, true); assert.deepEqual(translated.edits, ['日本']);
	} finally { await page.evaluate(() => (globalThis as any).nativeTransform.dispose()); await page.close(); }
});
