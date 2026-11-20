import assert from 'node:assert/strict';
import test, { after, before, type TestContext } from 'node:test';
import { build } from 'esbuild';
import { glsl } from 'esbuild-plugin-glsl';
import { chromium, type Browser } from 'playwright';
import type { renderPcrtcBlendCases } from '../helpers/pcrtc_scanout_fixture';
import { afterTest } from '../helpers/test_cleanup';
import type { renderTexturedModelCase } from '../helpers/textured_model_gpu';

let backendBundle: string;
let acceleratedBrowser: Promise<Browser> | undefined;

async function acceleratedPage(t: TestContext) {
	acceleratedBrowser ??= chromium.launch({ args: [
		'--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--use-vulkan=swiftshader',
		'--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface',
	] });
	const context = await (await acceleratedBrowser).newContext();
	afterTest(t, () => context.close());
	return context.newPage();
}

after(async () => {
	if (acceleratedBrowser !== undefined) await (await acceleratedBrowser).close();
});

type GxBrowserBackend = Parameters<typeof renderTexturedModelCase>[1];
type TexturedModelEvidence = Awaited<ReturnType<typeof renderTexturedModelCase>>;
const fullVramBytes = 2 * 1024 * 1024;
const modelEvidence = new Map<string, Promise<TexturedModelEvidence>>();

function texturedModelEvidence(t: TestContext, kind: GxBrowserBackend, vramBytes: number) {
	const key = `${kind}:${vramBytes}`;
	const captured = modelEvidence.get(key);
	if (captured !== undefined) return captured;
	const run = (async (): Promise<TexturedModelEvidence> => {
		const page = await acceleratedPage(t), errors: string[] = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.route('http://localhost/renderer-test/**', route => route.fulfill({ contentType: 'text/html',
			body: '<!doctype html><div id="player-surface"><canvas id="gamescreen" width="256" height="256"></canvas></div>' }));
		await page.goto('http://localhost/renderer-test/model/'); await page.addScriptTag({ content: backendBundle });
		const result = await page.evaluate(async ({ kind, vramBytes }) => (globalThis as any).backendTest.renderTexturedModelCase(
			document.getElementById('gamescreen'), kind, vramBytes), { kind, vramBytes });
		assert.deepEqual(errors, []);
		return result;
	})();
	// Each physical configuration owns one packet stream. The separate tests
	// keep their assertions, but share only the completed browser evidence.
	modelEvidence.set(key, run);
	return run;
}

before(async () => {
	const bundle = await build({
		stdin: { contents: `
			export { createBrowserBackend } from './hosts/browser/backend';
			export { renderPcrtcBlendCases } from './tests/helpers/pcrtc_scanout_fixture';
			export { renderTexturedModelCase } from './tests/helpers/textured_model_gpu';
			export { renderCrtNoiseCases } from './tests/helpers/crt_gpu';
			export { renderPresentationTarget } from './tests/helpers/presentation_target';
			export { renderHostFontCases } from './tests/helpers/host_font_gpu';
		`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', target: 'es2020', format: 'iife', globalName: 'backendTest', write: false,
		plugins: [glsl()], loader: { '.rgba': 'binary', '.png': 'dataurl', '.glsl': 'text', '.wgsl': 'text' },
	});
	backendBundle = bundle.outputFiles[0].text;
});

for (const kind of ['webgl2', 'webgpu']) test(`${kind} preserves bitmap fonts and scalable glyph coverage across layout and raster scales`, async t => {
	const page = await acceleratedPage(t), errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.route('http://localhost/renderer-test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas></canvas>' }));
	await page.goto('http://localhost/renderer-test/fonts/'); await page.addScriptTag({ content: backendBundle });
	const result = await page.evaluate(async kind => (globalThis as any).backendTest.renderHostFontCases(document.querySelector('canvas'), kind), kind);
	assert.equal(result.validationError, undefined); assert.equal(result.glError, 0);
	assert.deepEqual(result.errors, []); assert.deepEqual(errors, []);
	assert.ok(result.ink > 0, 'reference contains rendered glyphs');
	assert.equal(result.bootAtlasUploads, 0, 'renderer creation does not upload unused font assets');
	assert.equal(result.unusedScalableUploads, 0, 'bitmap-only output does not allocate the scalable atlas');
	assert.ok(result.atlasUploads.every(count => count === 1), 'each used atlas uploads once across repeated frames and font switches');
	assert.deepEqual(result.atlasSamples, Array.from({ length: 3 }, () => [[255, 0, 0, 255], [0, 255, 255, 0], [255, 0, 0, 255]]).flat(),
		'nearest, filtered and MSDF glyphs use their source atlas instead of a built-in font identity');
	for (const sample of result.cases) assert.equal(sample.differences, 0,
		`phase ${sample.phaseX},${sample.phaseY}: each glyph texel must match the aligned software image (first difference ${sample.firstDifference})`);
	t.diagnostic(JSON.stringify(result.sampling));
	for (const sample of result.sampling) {
		// Hardware bilinear weights and UNORM8 blending may each round by one byte.
		assert.ok(sample.maxError <= 2, `${kind} coverage at scale ${sample.scale} differs by ${sample.maxError}`);
		// SwiftShader Vulkan snaps triangle vertices to 1/16 pixel before interpolating UVs.
		// At 0.5 tint alpha that can move contour coverage by eight bytes; MSDF also
		// amplifies the filtered-distance rounding by screen range. No image-pixel tolerance.
		assert.ok(sample.msdfError <= 8 + sample.scale, `${kind} MSDF coverage at scale ${sample.scale} differs by ${sample.msdfError}`);
		assert.equal(sample.imageDifferences, 0, 'glyph filtering cannot change ordinary atlas images');
		assert.ok(sample.fractional > 0, 'fractional placement produces genuine glyph edge coverage');
	}
});

for (const kind of ['webgl2', 'webgpu']) test(`${kind} retains the old workspace target until the next presentation`, async t => {
	const page = await acceleratedPage(t), errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.route('http://localhost/renderer-test/**', route => route.fulfill({ contentType: 'text/html',
		body: '<!doctype html><style>body{margin:0}#player-surface{position:fixed;width:48px;height:36px}canvas{position:fixed}</style><div id="player-surface"><canvas width="16" height="12"></canvas></div>' }));
	await page.goto('http://localhost/renderer-test/presentation/'); await page.addScriptTag({ content: backendBundle });
	const result = await page.evaluate(async kind => (globalThis as any).backendTest.renderPresentationTarget(document.querySelector('canvas'), kind), kind);
	assert.equal(result.validationError, undefined); assert.equal(result.glError, 0);
	assert.deepEqual(result.errors, []); assert.deepEqual(errors, []);
	assert.equal(result.pending.allocations, result.before.allocations, 'a burst of layout requests allocates no undrawn targets');
	assert.deepEqual(result.pending.allocated, result.before.allocated);
	assert.deepEqual(result.pending.backing, [48, 36]);
	assert.deepEqual(result.pending.bounds, result.before.bounds, 'the published transform belongs to the image still on screen');
	assert.equal(result.pending.reads, result.before.reads, 'workspace policy changes do not remeasure the host area');
	assert.deepEqual(result.pending.selected, { x: 24, y: 18 }, 'layout prepares the selected dimensions');
	assert.equal(result.drawn.allocations, result.before.allocations, 'UI scaling reuses the physical buffer');
	assert.deepEqual(result.drawn.allocated, { x: 48, y: 36 });
	assert.deepEqual(result.drawn.backing, [48, 36]);
	assert.deepEqual(result.drawn.logical, [24, 18]);
	assert.equal(result.drawn.reads, result.before.reads, 'logical-only scale needs no DOM remeasurement');
	assert.equal(result.densityPending.allocations, result.drawn.allocations);
	assert.deepEqual(result.densityPending.backing, result.drawn.backing);
	assert.equal(result.density.allocations, result.drawn.allocations + 1);
	assert.deepEqual(result.density.backing, [96, 72]);
	assert.deepEqual(result.density.logical, result.drawn.logical);
	assert.equal(result.density.bounds.width, 48); assert.equal(result.density.bounds.height, 36);
	assert.deepEqual(result.history, [16, 12], 'host density and UI scale leave native game capture untouched');
	assert.deepEqual(result.pixel.slice(0, 3), [0x11, 0x22, 0x33], 'the resized target contains the held image, not the cleared backing buffer');
	for (const pixels of result.frames) for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
		const white = x >= 3 && x < 9 && y >= 4 && y < 8;
		assert.deepEqual(pixels.slice((y * 12 + x) * 4, (y * 12 + x + 1) * 4), white ? [255, 255, 255, 255] : [0x11, 0x22, 0x33, 255],
			'both lanes compose the logical frame viewport, nested transform and scissor independently of target dimensions');
	}
});

for (const kind of ['webgl2', 'webgpu']) test(`${kind} CRT noise uses deterministic pixel and line grain across frame phases`, async t => {
	const page = await acceleratedPage(t), errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.route('http://localhost/renderer-test/**', route => route.fulfill({ contentType: 'text/html',
		body: '<!doctype html><div id="player-surface"><canvas id="gamescreen" width="320" height="240"></canvas></div>' }));
	await page.goto('http://localhost/renderer-test/crt/'); await page.addScriptTag({ content: backendBundle });
	const result = await page.evaluate(async kind => (globalThis as any).backendTest.renderCrtNoiseCases(document.getElementById('gamescreen'), kind), kind);
	t.diagnostic(JSON.stringify(result));
	assert.equal(result.glError, 0); assert.equal(result.validationError, undefined);
	assert.deepEqual(result.gpuErrors, []); assert.deepEqual(errors, []);
	assert.equal(result.differences.length, 9);
	assert.ok(result.differences.every(value => value <= 1), 'grain, tint and glow agree within RGBA8 rounding');
});

for (const kind of ['webgl2', 'webgpu'] as const) test(`${kind} and CPU render flat/raw textured model packets with affine point sampling`, async t => {
	const result = await texturedModelEvidence(t, kind, fullVramBytes);
	const { projection, sampling } = result;
	assert.ok(projection && sampling, 'full VRAM reports the projected model and texture sampling evidence');
	t.diagnostic(JSON.stringify({ projection, sampling }));
	assert.equal(result.kind, kind); assert.equal(projection.difference, -1, 'whole-frame software/GPU parity');
	assert.equal(projection.commands, 3, 'upload and both projected faces completed');
	assert.deepEqual(projection.snapshotDifferences, [-1, -1, -1], 'complete VRAM bytes survive disjoint dirty captures and external replacement');
	assert.equal(projection.transfers.length, 2, 'unchanged checkpoints and imported VRAM perform no readback');
	assert.deepEqual(projection.snapshotWords, [0, 0x03e0], 'the high-row write actually changes the captured machine word');
	assert.deepEqual(projection.transfers[1], [197, 901, 3, 2], 'the small high-row write reads its exclusive rectangle bounds, including WebGPU row padding');
	assert.deepEqual(result.adjacentDifferences.slice(0, 3), [-1, -1, -1], 'adjacent texture draws retain whole-frame software parity');
	assert.deepEqual(result.adjacentCopies.slice(0, 3), [1, 0, 1], 'an adjacent framebuffer does not dirty its texture page, but an actual write does');
	assert.deepEqual(sampling.wrappedDifferences, [-1, -1], 'both UV-wrap directions sample late uploads with whole-frame software parity');
	assert.deepEqual(sampling.rectangleDifferences, [-1, -1, -1, -1], 'non-power-of-two sprite flips retain whole-frame software parity');
	assert.deepEqual(sampling.flatColorDifferences, [-1, -1], 'all flat color/gain bytes retain whole-frame software parity');
	assert.deepEqual(projection.samples.map(sample => sample.software), [
		[255, 0, 0, 0], [0, 255, 0, 0], [0, 0, 255, 0], [0, 0, 0, 0],
		[255, 0, 0, 0], [0, 255, 0, 0], [0, 0, 255, 0], [0, 0, 0, 0],
	]);
	assert.equal(result.validationError, undefined); assert.equal(result.glError, 0); assert.deepEqual(result.gpuErrors, []);
});

for (const kind of ['webgl2', 'webgpu'] as const) test(`${kind} consumes every raw draw layout`, async t => {
	for (const vramBytes of [fullVramBytes, 1024 * 1024]) {
		const result = await texturedModelEvidence(t, kind, vramBytes);
		assert.deepEqual(result.drawLayoutDifferences, Array(20).fill(-1), 'each layout matches software pixel-for-pixel');
		assert.equal(result.drawLayoutPixels.length, 20);
		assert.ok(result.drawLayoutPixels.every((count: number) => count > 0), 'each case drew visible pixels');
		assert.deepEqual(result.lineExtraWordCounts, [2, 2], 'the producer retains exactly two line vertices');
		assert.deepEqual(result.lineExtraWordDifferences, [-1, -1], 'extra line words match software');
		assert.ok(result.lineExtraWordPixels.every(([line, extra]: number[]) => line !== 0 && extra === 0), 'extra raw words never create a third line vertex');
		assert.equal(result.validationError, undefined); assert.equal(result.glError, 0);
		assert.deepEqual(result.gpuErrors, []);
	}
});

for (const kind of ['webgl2', 'webgpu'] as const) test(`${kind} solid batches publish only drawn cells, including aliased VRAM`, async t => {
	for (const vramBytes of [fullVramBytes, 1024 * 1024]) {
		const result = await texturedModelEvidence(t, kind, vramBytes);
		assert.deepEqual(result.maskedRectangleWords, [0x7c00, 0x801f, 0x7c00, 0x8000, 0x7c00, 0x801f, 0x7c00, 0x8000], 'masked rectangles retain all six vertices across primitive-kind batch changes');
		assert.equal(result.orderedReadbackPending, true, 'guest C0 requests a backend readback before rendering');
		assert.deepEqual(result.orderedReadbackWords, [vramBytes === 1024 * 1024 ? 0x03e003e0 : 0x001f03e0], 'guest GPUREAD observes both dependent draws at the C0 fence');
		assert.deepEqual(result.adjacentDifferences, [-1, -1, -1, -1, -1, -1]);
		assert.deepEqual(result.adjacentPixel[5], [0, 255, 0, 0], 'an empty clipped batch cannot suppress the following draw');
		assert.deepEqual(result.adjacentCopyRects[1], []);
		assert.deepEqual(result.adjacentCopyRects[2], [[320, 0, 16, 16]], 'a one-pixel source write must not dirty the adjacent CLUT');
		assert.equal(result.orderedSourceDifference, -1, 'dependent draws and changing palettes match the full software VRAM');
		assert.equal(result.selfTextureReadback, 0x7c00, 'GPUREAD observes self-textured pixels');
		assert.equal(result.selfTextureRestored, 0x7c00, 'restored VRAM retains self-textured pixels');
		assert.deepEqual(result.orderedSourceWords, [31, 31, 31, 0x0421, 0x0842, 0x0c63, 0x1084,
			0x03e0, 0x03e0, vramBytes === 1024 * 1024 ? 0x03e0 : 0x001f,
			vramBytes === 1024 * 1024 ? 0x001f : 0, 0x7c00, 0x7c00, 0x7c00, 0x7c00, 0x7c00, 0x81ef, 0x03e0],
			'pending sources, triangle self-reads and aliased palette writes remain ordered');
		if (vramBytes === 1024 * 1024) {
			assert.deepEqual(result.adjacentCopyRects[3], [[320, 0, 16, 16]], 'a write through the high logical band dirties the aliased physical texture');
			assert.deepEqual(result.adjacentPixel[4], [57, 189, 0, 0], 'the second logical band blends over the first');
		} else {
			assert.deepEqual(result.adjacentPixel[4], [123, 123, 0, 0], 'separate physical bands do not alias');
			assert.ok(result.capacityResult, 'full VRAM reports the command-buffer capacity limit');
			assert.equal(result.capacityResult.commands, 4096);
			assert.equal(result.capacityResult.difference, -1, 'the full command buffer matches software');
			assert.deepEqual(result.capacityResult.pixel, [0, 255, 0, 0], 'the final fill reaches the sampled cell');
			assert.deepEqual(result.capacityResult.copies, [[16, 0, 16, 16]], 'the final wrapped primitive must publish its cell');
		}
		assert.equal(result.glError, 0);
		assert.equal(result.validationError, undefined);
		assert.deepEqual(result.gpuErrors, []);
	}
});

test('GX WebGPU pipelines specialize only the overrides used by each stage', async t => {
	for (const vramBytes of [fullVramBytes, 1024 * 1024]) {
		const result = await texturedModelEvidence(t, 'webgpu', vramBytes);
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
});

test('WebGPU PCRTC constant RGB blend matches software for both AMOD settings and field modes', async t => {
	const page = await acceleratedPage(t);
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.route('http://localhost/renderer-test/**', route => route.fulfill({
		contentType: 'text/html', body: '<!doctype html><div id="player-surface"><canvas id="gamescreen" width="2" height="2"></canvas></div>',
	}));
	await page.goto('http://localhost/renderer-test/pcrtc-blend/');
	await page.addScriptTag({ content: backendBundle });
	const result = await page.evaluate<Awaited<ReturnType<typeof renderPcrtcBlendCases>>>(async () =>
		(globalThis as any).backendTest.renderPcrtcBlendCases(document.getElementById('gamescreen')));
	assert.deepEqual(errors, []);
	assert.equal(result.validationError, undefined);
	assert.deepEqual(result.gpuErrors, []);
	assert.equal(result.cases.length, 48);
	t.diagnostic(`WebGPU adapter: ${JSON.stringify(result.adapter)}`);
	for (const witness of [result.cases[0], result.cases.find(sample => sample.smode2 === 0 && sample.amod !== 0 && sample.alpha === 128)!]) {
		t.diagnostic(`ALP=128, AMOD=${witness.amod}: GPU=${JSON.stringify(witness.webgpu.slice(0, 4))}, software=${JSON.stringify(witness.software.slice(0, 4))}`);
	}
	for (const sample of result.cases) {
		const label = `SMODE2=${sample.smode2}, AMOD=${sample.amod}, ALP=${sample.alpha}`;
		assert.deepEqual(sample.software.slice(0, 4), [sample.alpha, 0, 0, sample.amod === 0 ? 64 : 200], `${label}: red witness and output alpha`);
		assert.deepEqual(sample.webgpu, sample.software, `${label}: GPU readback matches software RGBA pixels`);
	}
});

test('the browser selects WebGPU from its capabilities, not URL or page overrides', async t => {
	const page = await acceleratedPage(t);
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
	const page = await acceleratedPage(t);
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
	const page = await acceleratedPage(t);
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
