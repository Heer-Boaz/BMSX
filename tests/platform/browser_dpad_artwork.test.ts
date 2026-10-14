import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const run = promisify(execFile);
const directionIds = ['d-pad-u', 'd-pad-d', 'd-pad-l', 'd-pad-r'] as const;

test('transparent digital D-pad stays passive and preserves every raw direction bit in browser products', async t => {
	const repository = process.cwd();
	const tsxLoader = createRequire(join(repository, 'package.json')).resolve('tsx');
	const fixture = await mkdtemp(join(tmpdir(), 'bmsx-dpad-artwork-'));
	t.after(() => rm(fixture, { recursive: true, force: true }));
	await mkdir(join(fixture, 'rom'));
	// Packaging must not need any of the retired opaque D-pad PNGs.
	for (const path of ['gamebase.html', 'gamebase.css', 'rom/bmsx.png', 'rom/manifest.json']) {
		await copyFile(join(repository, path), join(fixture, path));
	}
	const buildModule = pathToFileURL(join(repository, 'scripts/products/browser_build.ts')).href;
	const packageScript = `import { buildBrowserPlayerPackage, buildBrowserStudioPackage } from ${JSON.stringify(buildModule)};
for (const debug of [false, true]) {
	await buildBrowserPlayerPackage({ debug, romName: 'nemesis_s', title: 'Nemesis', shortName: 'Nemesis' });
	await buildBrowserStudioPackage(debug);
}`;
	// Run the real page producer in an isolated cwd; do not race release dist files.
	await run(process.execPath, ['--import', tsxLoader, '--input-type=module', '--eval', packageScript], { cwd: fixture });
	const pages = ['index.html', 'player.template.html', 'player.input-trace.template.html', 'player.debug.template.html',
		'player.input-trace.debug.template.html', 'studio.html', 'studio.template.html', 'studio.debug.html', 'studio.debug.template.html'];
	for (const filename of pages) {
		await t.test(`transparent digital artwork is authored directly in ${filename}`, async () => {
			const html = await readFile(join(fixture, 'dist', filename), 'utf8');
			const artwork = html.slice(html.indexOf('<svg id="d-pad-svg"'), html.indexOf('</svg>', html.indexOf('<svg id="d-pad-svg"')));
			assert.ok(artwork.includes('viewBox="0 0 100 100"'), 'the established frame is retained');
			assert.ok(!artwork.includes('id="d-pad-contour"'), 'the digital cross has no unnecessary outer circle');
			assert.ok(artwork.includes('id="d-pad-cross"'), 'the physical cross has a static outline');
			assert.ok(artwork.includes('id="d-pad-artwork"'), 'digital artwork has its own passive mode group');
			assert.match(artwork, /<g id="left-stick-artwork"[^>]* visibility="hidden"/,
				'the optional analog unit starts hidden rather than drawing a circle around the D-pad');
			assert.ok(artwork.includes('id="left-stick-tip"'), 'every product includes the independently projected analog tip');
			assert.equal([...artwork.matchAll(/class="d-pad-direction"/g)].length, 4);
			assert.ok(!artwork.includes('<image'), 'no opaque raster background is embedded or requested');
			assert.ok(!html.includes('@@DPAD_'), 'the product has no unresolved artwork slots');
			for (const id of directionIds) {
				assert.ok(artwork.includes(`id="${id}"`), `${id} has an independent passive indicator`);
			}
		});
	}
	const html = await readFile(join(fixture, 'dist', 'player.template.html'), 'utf8');

	const bundle = await build({
		stdin: { contents: `export { BrowserOnscreenGamepad } from './hosts/browser/onscreen_gamepad';
export { BrowserOnscreenGamepadView } from './hosts/browser/onscreen_gamepad_view';
export { BrowserHostClock } from './hosts/browser/timing';
export { Input } from './hosts/common/input/manager';
export { createInputControllerSnapshot } from './machine/ts/machine/devices/input/contracts';`, resolveDir: repository },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'artworkFixture', write: false, tsconfig: 'tsconfig.base.json',
	});
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 852, height: 393 } });
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	const controls = html.slice(html.indexOf('<div id="controller-viewport"'), html.indexOf('<div id="gameContainer">'));
	const artworkPage = `<!doctype html><style>${await readFile('gamebase.css', 'utf8')} body { background: rgb(31, 127, 211); }</style>${controls}`;
	await page.setContent(artworkPage);
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	const initializeArtwork = () => {
		const api = (globalThis as any).artworkFixture;
		const clock = new api.BrowserHostClock();
		const model = new api.BrowserOnscreenGamepad(clock);
		const input = new api.Input(clock, { devices() { return [model]; }, subscribe(sink: any) { return model.subscribe(sink); } }, model.gamepadIndex);
		const snapshot = api.createInputControllerSnapshot();
		const view = new api.BrowserOnscreenGamepadView(document, window, model);
		view.layout(0, 0, 852, 393);
		const pad = document.getElementById('d-pad-svg')!.getBoundingClientRect();
		const x = pad.left + pad.width / 2;
		const y = pad.top + pad.height / 2;
		const travel = pad.width * 0.35;
		const geometry = [{ x, y: y - travel }, { x, y: y + travel }, { x: x - travel, y }, { x: x + travel, y }];
		const artwork = [...document.querySelectorAll<SVGPathElement>('.d-pad-direction')];
		const artworkWrites: Array<{ id: string; attribute: string }> = [];
		const observer = new MutationObserver(records => {
			for (const record of records) artworkWrites.push({ id: (record.target as Element).id, attribute: record.attributeName });
		});
		observer.observe(document.getElementById('d-pad-controls')!, { attributes: true, subtree: true });
		(globalThis as any).artworkProbe = {
			model, view, input, geometry, observer,
			pose(mode: 'dpad' | 'stick', direction: number) {
				model.cancelContacts();
				model.setDirectionalMode(mode);
				const bank = document.getElementById('d-pad-svg')!.getBoundingClientRect();
				const x = bank.left + bank.width / 2, y = bank.top + bank.height / 2, radius = bank.width / 2;
				if (mode === 'dpad') {
					for (let index = 0; index < 4; index += 1) {
						const angle = index * Math.PI / 2;
						model.beginContact(index + 1, x + radius * 0.7 * Math.cos(angle), y + radius * 0.7 * Math.sin(angle), 0, 0, true);
					}
				} else {
					model.beginContact(1, x, y, 0, 0, true);
					if (direction >= 0) model.moveContact(1, x + radius * 2 * Math.cos(direction * Math.PI / 4),
						y + radius * 2 * Math.sin(direction * Math.PI / 4), 0, 0, true);
				}
				return { x, y, radius };
			},
			setDirections(nibble: number) {
				model.cancelContacts();
				for (let index = 0; index < geometry.length; index += 1) {
					if ((nibble & (1 << index)) !== 0) model.beginContact(index + 1, geometry[index].x, geometry[index].y, 0, 0, true);
				}
				return model.buttons;
			},
			measure() {
				input.pollInput();
				input.sampleInputControllerSnapshot(snapshot, 0);
				return {
					buttons: model.buttons,
					sampledButtons: snapshot.pads[0].buttons,
					writes: artworkWrites.splice(0),
					active: artwork.filter(direction => direction.getAttribute('data-touched') === 'true').map(direction => direction.id),
					fills: [...document.querySelectorAll<SVGGeometryElement>('#d-pad-svg path, #d-pad-svg circle')].map(shape => getComputedStyle(shape).fill),
					strokes: artwork.map(direction => getComputedStyle(direction).strokeWidth),
					bounds: artwork.map(image => {
						const rect = image.getBoundingClientRect();
						return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
					}),
					geometry: document.getElementById('d-pad-svg')!.getBoundingClientRect().toJSON(),
					cross: document.getElementById('d-pad-cross')!.getBoundingClientRect().toJSON(),
					modeVisibility: ['d-pad-artwork', 'left-stick-artwork'].map(id => getComputedStyle(document.getElementById(id)!).visibility),
				};
			},
		};
	};
	await page.evaluate(initializeArtwork);
	const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
	const measure = () => page.evaluate(() => (globalThis as any).artworkProbe.measure());
	const resting = await measure();
	assert.deepEqual(resting.active, []);
	assert.ok(Math.abs(resting.geometry.width - 180 * Math.min(1.1, 852 / 568, 393 / 300)) < 0.0001,
		'the authored acquisition frame follows the single-shoulder-row landscape budget');
	assert.ok(Math.abs(resting.cross.width / resting.geometry.width - 0.891) < 0.0001,
		'the larger digital cross fills its existing acquisition frame without shrinking any face target');
	assert.deepEqual(resting.modeVisibility, ['visible', 'hidden'], 'D-pad mode paints no analog outer ring');
	let previousNibble = 0;
	for (let nibble = 0; nibble < 16; nibble += 1) {
		await t.test(`raw direction mask 0x${nibble.toString(16)} highlights all pressed arms without filling the game view`, async () => {
			const raw = nibble << 12;
			assert.equal(await page.evaluate(nibble => (globalThis as any).artworkProbe.setDirections(nibble), nibble), raw);
			await settle();
			const rendered = await measure();
			assert.equal(rendered.buttons, raw, 'opposing direction bits remain pressed in the model');
			assert.equal(rendered.sampledButtons, raw, 'the ordinary frame sample retains every raw direction bit');
			assert.deepEqual(rendered.active, directionIds.filter((_id, index) => (nibble & (1 << index)) !== 0), 'opposing arms remain independently highlighted');
			assert.ok(rendered.fills.every((fill: string) => fill === 'none'), 'even pressed artwork has no interior paint');
			assert.deepEqual(rendered.strokes, directionIds.map((_id, index) => (nibble & (1 << index)) !== 0 ? '2.5px' : '1.25px'));
			assert.deepEqual(rendered.bounds, resting.bounds, 'state changes do not move or resize the artwork');
			assert.deepEqual(rendered.geometry, resting.geometry, 'artwork projection leaves acquisition geometry unchanged');
			assert.deepEqual(rendered.writes, directionIds.filter((_id, index) => ((nibble ^ previousNibble) & (1 << index)) !== 0)
				.map(id => ({ id, attribute: 'data-touched' })), 'only changed raw directions write their cached indicator attribute');
			const pixels = PNG.sync.read(await page.locator('#d-pad-svg').screenshot());
			for (const [x, y] of [[0.5, 0.5], [0.05, 0.05], [0.5, 0.35], [0.5, 0.65], [0.35, 0.5], [0.65, 0.5]]) {
				const offset = (Math.trunc(y * pixels.height) * pixels.width + Math.trunc(x * pixels.width)) * 4;
				assert.deepEqual([...pixels.data.subarray(offset, offset + 4)], [31, 127, 211, 255], 'actual composed centre, corner and arm interiors leave the backdrop pixel intact');
			}
			previousNibble = nibble;
			await settle();
			assert.deepEqual((await measure()).writes, [], 'an unchanged next view frame performs no DOM writes');
		});
	}
	await t.test('calibrated digital and analog ink stays inside the unchanged acquisition bank at DPR 1, 2, and 3', async () => {
		// This is actual Chromium paint evidence from the public model/view
		// producer, separate from the native multi-finger delivery tests.
		for (const dpr of [1, 2, 3]) {
			const rasterPage = await browser.newPage({ viewport: { width: 320, height: 240 }, deviceScaleFactor: dpr });
			rasterPage.on('pageerror', error => errors.push(error.message));
			await rasterPage.setContent(artworkPage);
			await rasterPage.addScriptTag({ content: bundle.outputFiles[0].text });
			await rasterPage.evaluate(initializeArtwork);
			await rasterPage.evaluate(() => (globalThis as any).artworkProbe.observer.disconnect());
			await rasterPage.addStyleTag({ content: '.control-surface:not(#d-pad-controls), .host-control-surface { visibility: hidden !important; }' });
			for (const [width, height] of [[320, 240], [320, 568], [568, 239], [390, 763], [750, 369], [852, 393], [768, 980], [1024, 748]]) {
				await rasterPage.setViewportSize({ width, height });
				await rasterPage.evaluate(({ width, height }) => (globalThis as any).artworkProbe.view.layout(0, 0, width, height), { width, height });
				const hidden = await rasterPage.addStyleTag({ content: '#d-pad-svg { visibility: hidden !important; }' });
				const blank = PNG.sync.read(await rasterPage.screenshot());
				await hidden.evaluate(element => element.parentNode!.removeChild(element));
				await hidden.dispose();
				for (let pose = -2; pose < 8; pose += 1) {
					const bank = await rasterPage.evaluate(pose => (globalThis as any).artworkProbe.pose(pose === -2 ? 'dpad' : 'stick', pose), pose);
					await rasterPage.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
					const raster = PNG.sync.read(await rasterPage.screenshot());
					assert.equal(raster.width, width * dpr, 'the browser raster uses the tested device pixel ratio');
					let inkPixels = 0;
					for (let offset = 0; offset < raster.data.length; offset += 4) {
						if (raster.data[offset] === blank.data[offset] && raster.data[offset + 1] === blank.data[offset + 1]
							&& raster.data[offset + 2] === blank.data[offset + 2]) continue;
						inkPixels += 1;
						const pixel = offset / 4, x = pixel % raster.width, y = Math.trunc(pixel / raster.width);
						for (const dx of [0, 1]) for (const dy of [0, 1]) assert.ok(
							Math.hypot((x + dx) / dpr - bank.x, (y + dy) / dpr - bank.y) <= bank.radius,
							`${width}x${height}/DPR${dpr}/pose${pose}: every painted pixel corner, including active strokes, lies in the unchanged acquisition circle`);
					}
					assert.ok(inkPixels > 0, 'the visible digital cross or stick actually painted pixels');
				}
			}
			await rasterPage.close();
		}
	});
	await page.evaluate(() => {
		const probe = (globalThis as any).artworkProbe;
		probe.observer.disconnect();
		probe.input.dispose();
		probe.view.dispose();
	});
	assert.deepEqual(errors, []);
});
