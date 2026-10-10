import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { build } from 'esbuild';
import { glsl } from 'esbuild-plugin-glsl';
import { chromium } from 'playwright';

let backendBundle: string;
before(async () => {
	const bundle = await build({
		stdin: { contents: `
			export { createBrowserBackend } from './hosts/browser/backend';
			export { BrowserVideoOutput } from './hosts/browser/video_output';
			export { VideoPresenter } from './machine/ts/render/video_presenter';
			export { RenderPassLibrary } from './machine/ts/render/backend/pass/library';
		`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', target: 'es2020', format: 'iife', globalName: 'backendTest', write: false,
		plugins: [glsl()], loader: { '.png': 'dataurl', '.glsl': 'text', '.wgsl': 'text' },
	});
	backendBundle = bundle.outputFiles[0].text;
});

test('GX WebGPU pipelines specialize only the overrides used by each stage', async t => {
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
	for (const vramBytes of [2 * 1024 * 1024, 1024 * 1024]) {
		await page.goto('http://localhost/renderer-test/webgpu/');
		await page.addScriptTag({ content: backendBundle });
		assert.deepEqual(errors, []);
		const result = await page.evaluate(async vramBytes => {
			const { createBrowserBackend, BrowserVideoOutput, VideoPresenter, RenderPassLibrary } = (globalThis as any).backendTest;
			const canvas = document.getElementById('gamescreen');
			const backend = await createBrowserBackend(canvas, vramBytes);
			const device: GPUDevice = backend.device;
			const pipelines: { label: string; vertex: Record<string, GPUPipelineConstantValue>; fragment: Record<string, GPUPipelineConstantValue> }[] = [];
			const gpuErrors: string[] = [];
			device.addEventListener('uncapturederror', event => gpuErrors.push(event.error.message));
			const createRenderPipeline = device.createRenderPipeline;
			device.createRenderPipeline = function (descriptor) {
				pipelines.push({ label: descriptor.label, vertex: descriptor.vertex.constants, fragment: descriptor.fragment?.constants });
				return createRenderPipeline.call(this, descriptor);
			};
			device.pushErrorScope('validation');
			const presenter = new VideoPresenter(new BrowserVideoOutput(canvas, null), backend, 320, 240);
			const library = new RenderPassLibrary(backend, presenter);
			await device.queue.onSubmittedWorkDone();
			const validationError = await device.popErrorScope();
			library.dispose();
			device.destroy();
			return { pipelines, validationError: validationError?.message, gpuErrors };
		}, vramBytes);
		assert.equal(result.validationError, undefined, 'native GX and presentation pipelines compile successfully');
		assert.deepEqual(result.gpuErrors, []);
		for (const label of [
			'gx_gpu_solid', 'gx_gpu_fixed_solid', 'gx_gpu_line', 'gx_gpu_textured',
			'gx_gpu_fixed_textured', 'gx_gpu_transfer', 'gx_gpu_cpu_upload',
		]) {
			const pipeline = result.pipelines.find(pipeline => pipeline.label === label);
			assert.ok(pipeline, `${label} is created by the real pass bootstrap`);
			assert.deepEqual(pipeline.vertex, {
				gxGpuVramXAddressPeriod: 1024,
				gxGpuVramYAddressPeriod: 1024,
			}, `${label} vertex stage has no fragment-only overrides`);
			assert.deepEqual(pipeline.fragment, {
				gxGpuVramXAddressPeriod: 1024,
				gxGpuVramTextureRowMask: vramBytes / 2048 - 1,
			}, `${label} fragment stage has no vertex-only overrides`);
		}
	}
	assert.deepEqual(errors, []);
});

test('the browser selects WebGPU from its capabilities, not URL or page overrides', async t => {
	const browser = await chromium.launch({ args: [
		'--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan',
		'--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface',
	] });
	t.after(() => browser.close());
	const page = await browser.newPage();
	await page.route('http://localhost/renderer-test/**', route => route.fulfill({
		contentType: 'text/html', body: '<!doctype html><canvas id="gamescreen" data-renderer="webgl2"></canvas>',
	}));
	await page.addInitScript(() => {
		(globalThis as any).canvasContexts = [];
		const getContext = HTMLCanvasElement.prototype.getContext;
		Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
			value(kind: string, ...args: unknown[]) {
				(globalThis as any).canvasContexts.push(kind);
				return Reflect.apply(getContext, this, [kind, ...args]);
			},
		});
	});
	await page.goto('http://localhost/renderer-test/?renderer=webgl2');
	await page.addScriptTag({ content: backendBundle });
	assert.deepEqual(await page.evaluate(async () => {
		const backend = await (globalThis as any).backendTest.createBrowserBackend(document.getElementById('gamescreen'), 2 * 1024 * 1024);
		return { type: backend.type, contexts: (globalThis as any).canvasContexts };
	}), { type: 'webgpu', contexts: ['webgpu'] });
});

test('WebGPU initialization failure is reported without retrying another renderer', async t => {
	const browser = await chromium.launch({ args: [
		'--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan',
		'--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface',
	] });
	t.after(() => browser.close());
	const page = await browser.newPage();
	await page.route('http://localhost/renderer-test/**', route => route.fulfill({
		contentType: 'text/html', body: '<!doctype html><canvas id="gamescreen"></canvas>',
	}));
	await page.goto('http://localhost/renderer-test/');
	await page.addScriptTag({ content: backendBundle });
	await page.evaluate(() => {
		(globalThis as any).canvasContexts = [];
		const getContext = HTMLCanvasElement.prototype.getContext;
		Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
			value(kind: string, ...args: unknown[]) {
				(globalThis as any).canvasContexts.push(kind);
				return Reflect.apply(getContext, this, [kind, ...args]);
			},
		});
		GPUAdapter.prototype.requestDevice = async function () { throw new Error('Native device initialization failed'); };
	});
	await assert.rejects(page.evaluate(async () => {
		await (globalThis as any).backendTest.createBrowserBackend(document.getElementById('gamescreen'), 2 * 1024 * 1024);
	}), /Native device initialization failed/);
	assert.deepEqual(await page.evaluate(() => (globalThis as any).canvasContexts), []);
});

test('browsers without a WebGPU API or adapter select WebGL2 before initialization', async t => {
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage();
	await page.route('http://localhost/renderer-test/**', route => route.fulfill({
		contentType: 'text/html', body: '<!doctype html><canvas id="gamescreen"></canvas>',
	}));
	await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }));
	for (const available of [false, true]) {
		await page.goto('http://localhost/renderer-test/');
		await page.addScriptTag({ content: backendBundle });
		if (available) await page.evaluate("Object.defineProperty(navigator, 'gpu', { value: { async requestAdapter() { return null; } } })");
		assert.equal(await page.evaluate(async () => {
			return (await (globalThis as any).backendTest.createBrowserBackend(document.getElementById('gamescreen'), 2 * 1024 * 1024)).type;
		}), 'webgl2');
	}
});
