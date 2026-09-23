import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';

// Playwright is a host test tool, not part of the product bundle.
const { chromium } = await import(process.env.BMSX_PLAYWRIGHT_MODULE || 'playwright');
const navigation = process.argv[2] === '--studio-navigation' ? process.argv[3] : null;
const fsm = process.argv[2] === '--studio-fsm-retarget-imported' ? 'retarget-imported' : process.argv[2] === '--studio-fsm-retarget' ? 'retarget' : process.argv[2] === '--studio-fsm-initial' ? 'initial' : null;
const executionOperations = process.argv[2] === '--studio-execution-operations';
const testRunner = process.argv[2] === '--studio-test-runner';
const sceneViewport = process.argv[2] === '--studio-scene-viewport';
const preload = process.argv[2] === '--studio-preload';
const inspection = process.argv[2] === '--studio-runtime-inspection';
const reparent = process.argv[2] === '--studio-bt-reparent';
const session = process.argv[2] === '--studio-session';
const sceneCart = process.argv[2] === '--studio-cart-scenes' ? process.argv[3] : null;
const nemesisScenes = process.argv[2] === '--studio-nemesis-scenes';
const scenario = executionOperations ? { kind: 'execution-operations' } : testRunner ? { kind: 'test-runner' } : sceneViewport ? { kind: 'scene-viewport' } : sceneCart !== null ? { kind: 'cart-scenes', cart: sceneCart } : nemesisScenes ? { kind: 'nemesis-scenes' } : preload ? { kind: 'preload' } : inspection ? { kind: 'runtime-inspection' } : navigation !== null ? { kind: 'navigation', cart: navigation } : fsm !== null ? { kind: `fsm-${fsm}` } : reparent ? { kind: 'bt-reparent' } : { kind: 'workflows' };
const studio = executionOperations || testRunner || sceneViewport || sceneCart !== null || nemesisScenes || preload || inspection || session || process.argv[2] === '--studio' || navigation !== null || fsm !== null || reparent;
const studioLabel = executionOperations ? 'STUDIO-EXECUTION-OPERATIONS' : sceneViewport ? 'STUDIO-SCENE-VIEWPORT' : sceneCart !== null ? `STUDIO-${sceneCart}-SCENES` : nemesisScenes ? 'STUDIO-NEMESIS-SCENES' : preload ? 'STUDIO-PRELOAD' : inspection ? 'STUDIO-RUNTIME-INSPECTION' : session ? 'STUDIO-SESSION' : reparent ? 'STUDIO-BT-REPARENT' : fsm !== null ? `STUDIO-FSM-${fsm.toUpperCase()}` : navigation === null ? 'STUDIO-WORKFLOWS' : 'STUDIO-NAVIGATION';
const [bios, cart, screenshot] = process.argv.slice(navigation !== null || sceneCart !== null ? 4 : studio ? 3 : 2);
if (!bios || !cart) throw new Error('Usage: browser.mjs [--studio-cart-scenes CART_FOLDER | --studio-execution-operations | --studio-test-runner | --studio-scene-viewport | --studio | --studio-nemesis-scenes | --studio-preload | --studio-runtime-inspection | --studio-session | --studio-fsm-initial | --studio-fsm-retarget | --studio-fsm-retarget-imported | --studio-bt-reparent | --studio-navigation CART_FOLDER] SYSTEM_ROM CART_ROM [SCREENSHOT_PNG]');
let inspectionPixels;
const backends = studio ? ['software', 'webgl2', 'webgpu'] : ['webgpu'];
const requestedBackend = process.env.BMSX_TEST_BACKEND;
if (requestedBackend !== undefined) assert.ok(backends.includes(requestedBackend), `Unsupported test backend: ${requestedBackend}`);
for (const backend of requestedBackend === undefined ? backends : [requestedBackend]) {
	const directory = await mkdtemp(join(tmpdir(), `bmsx-${backend}-rewind-`));
	let browser;
	let server;
	try {
		await build({ entryPoints: [resolve(import.meta.dirname, session ? 'browser_studio_session.ts' : studio ? 'browser_studio.ts' : 'browser_runner.ts')], bundle: true,
			platform: 'browser', format: 'esm', target: 'es2020', outfile: join(directory, 'test.js'),
			tsconfig: 'tsconfig.base.json', loader: { '.glsl': 'text', '.wgsl': 'text', '.png': 'dataurl' } });
		await writeFile(join(directory, 'index.html'), '<!doctype html><link rel="icon" href="data:,"><style>body{margin:0;background:#000}canvas{image-rendering:pixelated}</style><canvas width="256" height="212"></canvas>');
		await copyFile(bios, join(directory, 'bios.rom'));
		if (preload) {
			const built = spawnSync('npx', ['tsx', resolve(import.meta.dirname, 'preload_cartridge.ts'), directory, resolve(bios)], { stdio: 'inherit' });
			if (built.error) throw built.error;
			assert.equal(built.status, 0, 'preload fixture uses the production ROM builder');
		} else {
			await copyFile(cart, join(directory, 'cart.rom'));
		}
		if (studio) {
			await copyFile('dist/graph-layout.worker.js', join(directory, 'graph-layout.worker.js'));
			const sourceRoots = preload ? ['cartlib', 'testlib', 'machine/bios']
				: [`carts/${sceneCart !== null ? sceneCart : navigation === null ? 'nemesis_s' : navigation}`, 'cartlib', 'machine/bios'];
			for (const root of sourceRoots) {
				await cp(root, join(directory, root), { recursive: true,
					filter: async path => (await stat(path)).isDirectory() || path.endsWith('.lua') || path.endsWith('.aem.yaml') });
			}
		}
		// The actual product file API, rooted in an isolated workspace. No recovery
		// fallback, API mock, or writes to the developer's cart sources.
		server = spawn(process.execPath, [resolve('scripts/serve-dist.mjs'), '--dir', directory,
			'--port', '0', '--host', '127.0.0.1'], { cwd: directory, stdio: ['ignore', 'pipe', 'inherit'] });
		const address = await new Promise((resolve, reject) => {
			let output = '';
			server.on('error', reject);
			server.on('exit', code => reject(new Error(`product server exited with ${code}`)));
			server.stdout.on('data', chunk => {
				output += chunk;
				const match = /http:\/\/localhost:\d+/.exec(output);
				if (match) resolve(match[0].replace('localhost', '127.0.0.1'));
			});
		});
		browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-webgpu',
			'--enable-features=Vulkan', '--use-angle=vulkan', '--use-vulkan=swiftshader',
			'--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface', '--disable-dev-shm-usage'] });
		const page = await browser.newPage({ viewport: { width: 768, height: 576 } });
		const pageErrors = [];
		page.on('pageerror', error => { pageErrors.push(error); console.error(error); });
		page.on('console', message => console.log(`[browser:${message.type()}] ${message.text()}`));
		if (screenshot) await page.exposeFunction('captureStudioCheckpoint', async checkpoint => {
			const { dir, name, ext } = parse(screenshot);
			await page.screenshot({ path: join(dir, `${name}-${backend}-${checkpoint}${ext}`) });
		});
		await page.goto(address);
		let result = await page.evaluate(async ({ studio, session, backend, scenario, capture }) => {
			const test = await import('/test.js');
			return session ? test.studioSessionBackends[backend](document.querySelector('canvas')) : studio ? test.studioBackends[backend](document.querySelector('canvas'), scenario,
				capture ? globalThis.captureStudioCheckpoint : undefined)
				: test.runBrowserRewindConformance(document.querySelector('canvas'));
		}, { studio, session, backend, scenario, capture: screenshot !== undefined });
		if (session) {
			// A real page navigation fires pagehide; the next import has no old JS models,
			// inputs, subscriptions, semantic cache, run state or layout workers.
			await page.reload();
			result = await page.evaluate(async ({ backend, expected }) => {
				const test = await import('/test.js');
				return test.studioSessionBackends[backend](document.querySelector('canvas'), expected);
			}, { backend, expected: result });
		}
		if (pageErrors.length !== 0) throw new AggregateError(pageErrors, 'Uncaught browser workflow errors');
		if (inspection) {
			const pixels = PNG.sync.read(await page.locator('canvas').screenshot());
			const { width, height, topBarBottom, hover } = result.renderProof;
			assert.ok(topBarBottom > 0 && topBarBottom < height, 'pixel proof includes the actual menu bar');
			assert.equal(pixels.width / width, pixels.height / height, 'Studio pixels keep their aspect ratio');
			if (inspectionPixels) {
				assert.equal(pixels.width, inspectionPixels.width);
				assert.equal(pixels.height, inspectionPixels.height);
				// Actual menu glyphs after Reboot/Hot Resume/rewind, not replacement text.
				// Ignore caret/guest-time differences outside this retained chrome.
				const end = pixels.width * (topBarBottom * pixels.height / height) * 4;
				for (let offset = 0; offset < end; offset += 1) {
					assert.ok(Math.abs(pixels.data[offset] - inspectionPixels.data[offset]) <= 1,
						`${backend}: restored Studio chrome differs from software at byte ${offset}`);
				}
			} else {
				inspectionPixels = pixels;
			}
			let textPixels = 0, backgroundPixels = 0;
			assert.ok(hover.left >= 0 && hover.top >= 0 && hover.right <= width && hover.bottom <= height,
				`${backend}: physical runtime hover is fully on screen`);
			const scale = pixels.width / width;
			for (let y = (hover.top + 1) * scale; y < (hover.bottom - 1) * scale; y += 1) {
				for (let x = (hover.left + 1) * scale; x < (hover.right - 1) * scale; x += 1) {
					const offset = (y * pixels.width + x) * 4;
					const rgb = (pixels.data[offset] << 16) | (pixels.data[offset + 1] << 8) | pixels.data[offset + 2];
					if (rgb === (hover.text & 0xffffff)) textPixels += 1;
					if (rgb === (hover.background & 0xffffff)) backgroundPixels += 1;
				}
			}
			assert.ok(textPixels > 0 && backgroundPixels > textPixels, `${backend}: physical runtime hover paints its theme text and opaque surface`);
		}
		if (screenshot) {
			const { dir, name, ext } = parse(screenshot);
			await page.screenshot({ path: studio ? join(dir, `${name}-${backend}${ext}`) : screenshot });
		}
		if (studio && !session && scenario.kind === 'workflows') {
			const savedSource = await readFile(join(directory, 'carts/nemesis_s/title_screen.lua'), 'utf8');
			// Save & Reboot follows the extra WebGPU callback-lifetime test, which
			// applies a further right-key FSM revision while a real readback is held.
			const finalRule = backend === 'webgpu' ? "pattern = 'right[jp]'" : "pattern = 'up[jp]'";
			if (!savedSource.includes(finalRule) || !savedSource.endsWith('\n-- W04 reboot request\n')) {
				throw new Error('Save & Reboot did not persist the final accepted FSM revision through the real workspace API');
			}
			const savedScene = await readFile(join(directory, 'carts/nemesis_s/scenes/root.lua'), 'utf8');
			if (!savedScene.includes('( --[[source-owned anchor]]\n\t\t\t\t\t17)')) throw new Error('Scene Editor did not persist the accepted position and original trivia');
		}
		if (nemesisScenes) {
			const title = await readFile(join(directory, 'carts/nemesis_s/scenes/title.lua'), 'utf8');
			const hangar = await readFile(join(directory, 'carts/nemesis_s/scenes/hangar.lua'), 'utf8');
			assert.ok(title.includes('pos = { x = 88, y = 136, z = 1 }'), 'workspace persisted the selector edit');
			assert.ok(hangar.includes('pos = { x = 56, y = 125, z = 3 }'), 'workspace persisted both ship edits');
		}
		console.log(JSON.stringify({ backend, ...result }));
		console.log(studio ? `${studioLabel}:${backend}:PASS` : 'RUNTIME-WEBGPU-REWIND:PASS');
	} finally {
		if (browser) await browser.close();
		if (server && server.exitCode === null && server.signalCode === null) {
			const exited = new Promise(resolve => server.once('exit', resolve));
			server.kill();
			await exited;
		}
		await rm(directory, { recursive: true, force: true });
	}
}
if (studio) console.log(`${studioLabel}:PASS`);
