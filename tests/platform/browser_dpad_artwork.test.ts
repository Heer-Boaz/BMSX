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

const run = promisify(execFile);
const artworkNames = ['neutral', 'u', 'ru', 'r', 'rd', 'd', 'ld', 'l', 'lu'] as const;

test('original D-pad artwork stays passive, complete and byte-identical in browser products', async t => {
	const repository = process.cwd();
	const tsxLoader = createRequire(join(repository, 'package.json')).resolve('tsx');
	const fixture = await mkdtemp(join(tmpdir(), 'bmsx-dpad-artwork-'));
	t.after(() => rm(fixture, { recursive: true, force: true }));
	await mkdir(join(fixture, 'rom'));
	for (const path of ['gamebase.html', 'gamebase.css', 'rom/bmsx.png', 'rom/manifest.json',
		...artworkNames.map(name => `rom/d-pad-${name}.png`)]) {
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
	const originals = new Map(await Promise.all(artworkNames.map(async name => [name, await readFile(`rom/d-pad-${name}.png`)] as const)));
	for (const filename of pages) {
		await t.test(`all nine original PNGs are embedded in ${filename}`, async () => {
			const html = await readFile(join(fixture, 'dist', filename), 'utf8');
			assert.equal([...html.matchAll(/class="d-pad-image"/g)].length, 9);
			assert.ok(!html.includes('@@DPAD_'), 'the product has no unresolved artwork slots');
			for (const name of artworkNames) {
				const match = html.match(new RegExp(`<image id="svgimg-d-pad-${name}"[^>]*href="data:image/png;base64,([^"]+)"`));
				assert.ok(match, `${name} is embedded as a PNG, not an extra URL request`);
				assert.deepEqual(Buffer.from(match[1], 'base64'), originals.get(name), `${name} uses the unchanged authored bytes`);
			}
		});
	}
	const html = await readFile(join(fixture, 'dist', 'player.template.html'), 'utf8');
	await t.test('page packaging rereads artwork without requiring an engine rebuild', async () => {
		await copyFile(join(fixture, 'rom/d-pad-neutral.png'), join(fixture, 'rom/d-pad-u.png'));
		await run(process.execPath, ['--import', tsxLoader, '--input-type=module', '--eval',
			`import { buildBrowserPlayerPackage } from ${JSON.stringify(buildModule)}; await buildBrowserPlayerPackage({ debug: false, romName: 'nemesis_s', title: 'Nemesis', shortName: 'Nemesis' });`], { cwd: fixture });
		const changed = await readFile(join(fixture, 'dist', 'player.template.html'), 'utf8');
		const up = changed.match(/<image id="svgimg-d-pad-u"[^>]*href="data:image\/png;base64,([^"]+)"/)!;
		assert.deepEqual(Buffer.from(up[1], 'base64'), originals.get('neutral'));
	});

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
	await page.setContent(`<!doctype html><style>${await readFile('gamebase.css', 'utf8')}</style>${controls}`);
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	await page.evaluate(async () => {
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
		const artwork = [...document.querySelectorAll<SVGImageElement>('.d-pad-image')];
		await Promise.all(artwork.map(image => {
			const resource = new Image();
			resource.src = image.href.baseVal;
			return resource.decode();
		}));
		const artworkWrites: Array<{ id: string; attribute: string }> = [];
		const observer = new MutationObserver(records => {
			for (const record of records) artworkWrites.push({ id: (record.target as Element).id, attribute: record.attributeName });
		});
		observer.observe(document.getElementById('d-pad-controls')!, { attributes: true, subtree: true });
		(globalThis as any).artworkProbe = {
			model, view, input, geometry, observer,
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
					active: artwork.filter(image => image.getAttribute('data-active') === 'true').map(image => image.id),
					visible: artwork.filter(image => getComputedStyle(image).visibility === 'visible').map(image => image.id),
					bounds: artwork.map(image => {
						const rect = image.getBoundingClientRect();
						return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
					}),
					geometry: document.getElementById('d-pad-svg')!.getBoundingClientRect().toJSON(),
				};
			},
		};
	});
	const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
	const measure = () => page.evaluate(() => (globalThis as any).artworkProbe.measure());
	const resting = await measure();
	assert.deepEqual(resting.active, ['svgimg-d-pad-neutral']);
	assert.ok(Math.abs(resting.bounds[0].width - 196.5) < 0.0001, 'the original images follow the authored landscape hand-row scale');
	assert.deepEqual(resting.bounds, Array(9).fill(resting.bounds[0]), 'every original state shares the exact same artwork frame');
	const projected = ['neutral', 'u', 'd', 'neutral', 'l', 'lu', 'ld', 'l', 'r', 'ru', 'rd', 'r', 'neutral', 'u', 'd', 'neutral'];
	let previousImage = 'neutral';
	for (let nibble = 0; nibble < projected.length; nibble += 1) {
		await t.test(`raw direction mask 0x${nibble.toString(16)} projects to ${projected[nibble]} without changing input`, async () => {
			const raw = nibble << 12;
			assert.equal(await page.evaluate(nibble => (globalThis as any).artworkProbe.setDirections(nibble), nibble), raw);
			await settle();
			const rendered = await measure();
			assert.equal(rendered.buttons, raw, 'opposing direction bits remain pressed in the model');
			assert.equal(rendered.sampledButtons, raw, 'the ordinary frame sample retains every raw direction bit');
			assert.deepEqual(rendered.active, [`svgimg-d-pad-${projected[nibble]}`]);
			assert.deepEqual(rendered.visible, rendered.active);
			assert.deepEqual(rendered.bounds, resting.bounds, 'state changes do not move or resize the artwork');
			assert.deepEqual(rendered.geometry, resting.geometry, 'restoring images leaves acquisition geometry unchanged');
			assert.deepEqual(rendered.writes, projected[nibble] === previousImage ? [] : [
				{ id: `svgimg-d-pad-${previousImage}`, attribute: 'data-active' },
				{ id: `svgimg-d-pad-${projected[nibble]}`, attribute: 'data-active' },
			], 'only a changed artwork projection writes the previous and next visibility attributes; PNG URLs are never reassigned');
			previousImage = projected[nibble];
		});
	}
	await page.evaluate(() => {
		const probe = (globalThis as any).artworkProbe;
		probe.observer.disconnect();
		probe.input.dispose();
		probe.view.dispose();
	});
	assert.deepEqual(errors, []);
});
