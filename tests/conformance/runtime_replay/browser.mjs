import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { copyFile, cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';

// Playwright is a host test tool, not part of the product bundle.
const { chromium } = await import(process.env.BMSX_PLAYWRIGHT_MODULE || 'playwright');
const studio = process.argv[2] === '--studio';
const [bios, cart, screenshot] = process.argv.slice(studio ? 3 : 2);
if (!bios || !cart) throw new Error('Usage: browser.mjs [--studio] SYSTEM_ROM CART_ROM [SCREENSHOT_PNG]');
for (const backend of studio ? ['software', 'webgl2', 'webgpu'] : ['webgpu']) {
	const directory = await mkdtemp(join(tmpdir(), `bmsx-${backend}-rewind-`));
	let browser;
	let server;
	try {
		await build({ entryPoints: [resolve(import.meta.dirname, studio ? 'browser_studio.ts' : 'browser_runner.ts')], bundle: true,
			platform: 'browser', format: 'esm', target: 'es2020', outfile: join(directory, 'test.js'),
			tsconfig: 'tsconfig.base.json', loader: { '.glsl': 'text', '.wgsl': 'text', '.png': 'dataurl' } });
		await writeFile(join(directory, 'index.html'), '<!doctype html><link rel="icon" href="data:,"><style>body{margin:0;background:#000}canvas{image-rendering:pixelated}</style><canvas width="256" height="212"></canvas>');
		await copyFile(bios, join(directory, 'bios.rom'));
		await copyFile(cart, join(directory, 'cart.rom'));
		if (studio) {
			for (const root of ['carts/nemesis_s', 'cartlib', 'machine/bios']) {
				await cp(root, join(directory, root), { recursive: true,
					filter: async path => (await stat(path)).isDirectory() || path.endsWith('.lua') });
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
		const result = await page.evaluate(async ({ studio, backend }) => {
			const test = await import('/test.js');
			return studio ? test.studioBackends[backend](document.querySelector('canvas'))
				: test.runBrowserRewindConformance(document.querySelector('canvas'));
		}, { studio, backend });
		if (pageErrors.length !== 0) throw new AggregateError(pageErrors, 'Uncaught browser workflow errors');
		if (screenshot) {
			const { dir, name, ext } = parse(screenshot);
			await page.screenshot({ path: studio ? join(dir, `${name}-${backend}${ext}`) : screenshot });
		}
		if (studio) {
			const savedSource = await readFile(join(directory, 'carts/nemesis_s/title_screen.lua'), 'utf8');
			if (!savedSource.includes("pattern = 'left[jp]'")) throw new Error('Save did not persist the second FSM revision through the real workspace API');
		}
		console.log(JSON.stringify({ backend, ...result }));
		console.log(studio ? `STUDIO-WORKFLOWS:${backend}:PASS` : 'RUNTIME-WEBGPU-REWIND:PASS');
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
if (studio) console.log('STUDIO-WORKFLOWS:PASS');
