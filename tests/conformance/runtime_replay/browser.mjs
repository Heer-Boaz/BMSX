import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { copyFile, cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';

// Playwright is a host test tool, not part of the product bundle.
const { chromium } = await import(process.env.BMSX_PLAYWRIGHT_MODULE || 'playwright');
const navigation = process.argv[2] === '--studio-navigation' ? process.argv[3] : null;
const fsm = process.argv[2] === '--studio-fsm-retarget' ? 'retarget' : process.argv[2] === '--studio-fsm-initial' ? 'initial' : null;
const reparent = process.argv[2] === '--studio-bt-reparent';
const session = process.argv[2] === '--studio-session';
const scenario = navigation !== null ? { kind: 'navigation', cart: navigation } : fsm !== null ? { kind: `fsm-${fsm}` } : reparent ? { kind: 'bt-reparent' } : { kind: 'workflows' };
const studio = session || process.argv[2] === '--studio' || navigation !== null || fsm !== null || reparent;
const studioLabel = session ? 'STUDIO-SESSION' : reparent ? 'STUDIO-BT-REPARENT' : fsm !== null ? `STUDIO-FSM-${fsm.toUpperCase()}` : navigation === null ? 'STUDIO-WORKFLOWS' : 'STUDIO-NAVIGATION';
const [bios, cart, screenshot] = process.argv.slice(navigation !== null ? 4 : studio ? 3 : 2);
if (!bios || !cart) throw new Error('Usage: browser.mjs [--studio | --studio-session | --studio-fsm-initial | --studio-fsm-retarget | --studio-bt-reparent | --studio-navigation CART_FOLDER] SYSTEM_ROM CART_ROM [SCREENSHOT_PNG]');
for (const backend of studio ? ['software', 'webgl2', 'webgpu'] : ['webgpu']) {
	const directory = await mkdtemp(join(tmpdir(), `bmsx-${backend}-rewind-`));
	let browser;
	let server;
	try {
		await build({ entryPoints: [resolve(import.meta.dirname, session ? 'browser_studio_session.ts' : studio ? 'browser_studio.ts' : 'browser_runner.ts')], bundle: true,
			platform: 'browser', format: 'esm', target: 'es2020', outfile: join(directory, 'test.js'),
			tsconfig: 'tsconfig.base.json', loader: { '.glsl': 'text', '.wgsl': 'text', '.png': 'dataurl' } });
		await writeFile(join(directory, 'index.html'), '<!doctype html><link rel="icon" href="data:,"><style>body{margin:0;background:#000}canvas{image-rendering:pixelated}</style><canvas width="256" height="212"></canvas>');
		await copyFile(bios, join(directory, 'bios.rom'));
		await copyFile(cart, join(directory, 'cart.rom'));
		if (studio) {
			await copyFile('dist/graph-layout.worker.js', join(directory, 'graph-layout.worker.js'));
			for (const root of [`carts/${navigation === null ? 'nemesis_s' : navigation}`, 'cartlib', 'machine/bios']) {
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
		await page.goto(address);
		let result = await page.evaluate(async ({ studio, session, backend, scenario }) => {
			const test = await import('/test.js');
			return session ? test.studioSessionBackends[backend](document.querySelector('canvas')) : studio ? test.studioBackends[backend](document.querySelector('canvas'), scenario)
				: test.runBrowserRewindConformance(document.querySelector('canvas'));
		}, { studio, session, backend, scenario });
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
