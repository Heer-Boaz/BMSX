import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { before } from 'node:test';
import { build } from 'esbuild';
import { glsl } from 'esbuild-plugin-glsl';
import { chromium } from 'playwright';

let backendBundle: string;
before(async () => {
	const bundle = await build({
		stdin: { contents: "export { createBrowserBackend } from './hosts/browser/backend';", resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'backendTest', write: false,
		plugins: [glsl()], loader: { '.png': 'dataurl', '.glsl': 'text', '.wgsl': 'text' },
	});
	backendBundle = bundle.outputFiles[0].text;
});

test('browser renderer selection respects explicit requests and reports native GPU diagnostics', async t => {
	const diagnostics = await readFile('scripts/render/diagnostics/browser_gpu.mjs', 'utf8');
	const browser = await chromium.launch({ args: [
		'--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan',
		'--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface',
	] });
	t.after(() => browser.close());
	const page = await browser.newPage();
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.route('http://localhost/renderer-test/**', route => route.fulfill({
		contentType: 'text/html', body: '<!doctype html><canvas id="gamescreen" width="320" height="240"></canvas>',
	}));
	await page.addInitScript(() => {
		(globalThis as any).adapterRequests = 0;
		const requestAdapter = GPU.prototype.requestAdapter;
		GPU.prototype.requestAdapter = function (options) {
			(globalThis as any).adapterRequests++;
			return requestAdapter.call(this, options);
		};
	});
	for (const requested of ['auto', 'webgpu', 'webgl2']) {
		await page.goto(`http://localhost/renderer-test/?renderer=${requested}`);
		await page.addScriptTag({ content: diagnostics });
		await page.addScriptTag({ content: backendBundle });
		const backend = await page.evaluate(async () => {
			const backend = await (globalThis as any).backendTest.createBrowserBackend(document.getElementById('gamescreen'), 2 * 1024 * 1024);
			(globalThis as any).selectedBackend = backend;
			return { type: backend.type, requests: (globalThis as any).adapterRequests };
		});
		assert.deepEqual(backend, { type: requested === 'webgl2' ? 'webgl2' : 'webgpu', requests: requested === 'webgl2' ? 0 : 1 });
		assert.match(await page.locator('#gpu-status').innerText(), requested === 'webgl2' ? /WebGL2/ : /WebGPU/);
		await page.waitForFunction(() => document.getElementById('gpu-messages')!.textContent.includes('Gevraagd:'));
		assert.match(await page.locator('#gpu-summary').innerText(), /^0 fouten/);
		if (requested === 'webgpu') {
			// Real native compilation/validation errors must reach the visible panel.
			await page.evaluate(() => {
				const device: GPUDevice = (globalThis as any).selectedBackend.device;
				const module = device.createShaderModule({ label: 'diagnostic-bad-shader', code: 'not valid WGSL' });
				device.createRenderPipeline({
					label: 'diagnostic-bad-pipeline', layout: 'auto',
					vertex: { module, entryPoint: 'main' }, primitive: { topology: 'triangle-list' },
				});
			});
			await page.waitForFunction(() => {
				const messages = document.getElementById('gpu-messages')!.textContent;
				return messages.includes('diagnostic-bad-shader') && messages.includes('diagnostic-bad-pipeline');
			});
			assert.equal(await page.locator('#gpu-diagnostics details').evaluate(element => (element as HTMLDetailsElement).open), true);
		}
	}
	await page.goto('http://localhost/renderer-test/?renderer=webgl');
	await page.addScriptTag({ content: backendBundle });
	await assert.rejects(page.evaluate(async () => {
		await (globalThis as any).backendTest.createBrowserBackend(document.getElementById('gamescreen'), 2 * 1024 * 1024);
	}), /Unknown browser renderer: webgl/);
	assert.deepEqual(errors, []);
});

test('an explicit WebGPU request never silently selects WebGL2 when the capability is absent', async t => {
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage();
	await page.route('http://localhost/renderer-test/**', route => route.fulfill({
		contentType: 'text/html', body: '<!doctype html><canvas id="gamescreen"></canvas>',
	}));
	await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }));
	await page.goto('http://localhost/renderer-test/?renderer=webgpu');
	await page.addScriptTag({ content: backendBundle });
	await assert.rejects(page.evaluate(async () => {
		await (globalThis as any).backendTest.createBrowserBackend(document.getElementById('gamescreen'), 2 * 1024 * 1024);
	}), /WebGPU is not available/);
	await page.evaluate("Object.defineProperty(navigator, 'gpu', { value: { async requestAdapter() { return null; } } })");
	await assert.rejects(page.evaluate(async () => {
		await (globalThis as any).backendTest.createBrowserBackend(document.getElementById('gamescreen'), 2 * 1024 * 1024);
	}), /Unable to obtain the requested WebGPU adapter/);
	await page.goto('http://localhost/renderer-test/');
	await page.addScriptTag({ content: backendBundle });
	assert.equal(await page.evaluate(async () => {
		return (await (globalThis as any).backendTest.createBrowserBackend(document.getElementById('gamescreen'), 2 * 1024 * 1024)).type;
	}), 'webgl2');
});
