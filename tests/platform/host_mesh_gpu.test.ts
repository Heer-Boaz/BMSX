import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { build } from 'esbuild';
import { glsl } from 'esbuild-plugin-glsl';
import { chromium } from 'playwright';

let bundle: string;
before(async () => {
	const result = await build({ stdin: { contents: `
export {renderHostMeshCase} from './tests/helpers/host_mesh_gpu';
`, resolveDir: process.cwd() }, bundle: true, platform: 'browser', target: 'es2020', format: 'iife', globalName: 'meshTest', write: false,
		plugins: [glsl()], loader: { '.png': 'dataurl', '.glsl': 'text', '.wgsl': 'text' } });
	bundle = result.outputFiles[0].text;
});

for (const kind of ['webgl2', 'webgpu'] as const) test(`${kind} retained host meshes use real per-pixel depth, clipped viewport composition and owned generations`, async t => {
	const browser = await chromium.launch({ args: [
		'--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--use-vulkan=swiftshader',
		'--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface',
	] });
	t.after(() => browser.close());
	const page = await browser.newPage();
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.route('http://localhost/mesh-test/**', route => route.fulfill({ contentType: 'text/html',
		body: '<!doctype html><style>#player-surface{width:32px;height:32px}</style><div id="player-surface"><canvas id="gamescreen" width="32" height="32"></canvas></div>' }));
	await page.goto('http://localhost/mesh-test/');
	await page.addScriptTag({ content: bundle });
	const result = await page.evaluate(async kind => (globalThis as any).meshTest.renderHostMeshCase(kind), kind);
	t.diagnostic(JSON.stringify({ ...result, gxPixels: undefined }));
	assert.equal(result.kind, kind);
	assert.deepEqual(result.left, [255, 0, 0, 255]);
	assert.deepEqual(result.right, [0, 0, 255, 255]);
	assert.equal(result.orderIndependent, true, 'intersecting triangles cannot be replaced by per-face painter order');
	assert.equal(result.originPreserved, true);
	assert.equal(result.sameTarget, true);
	assert.deepEqual(result.idle, { passes: 0, uploads: 0 });
	assert.equal(result.reflectedVisible, true);
	assert.equal(result.sharedVertexBytes, 0, 'the already uploaded accessor stays shared across three index/material resources');
	assert.deepEqual(result.coplanar, [0, 255, 0, 255], 'strict greater retains the first coplanar primitive');
	assert.deepEqual(result.remaining, [255, 0, 0, 255], 'retiring one material does not destroy the shared position buffer');
	assert.equal(result.clippedVisible, true);
	assert.equal(result.resized, true);
	assert.deepEqual(result.background, [32, 32, 64, 255]);
	assert.deepEqual(result.cropped, [255, 0, 0, 255]);
	assert.deepEqual(result.laterUi, [0, 255, 0, 255]);
	assert.deepEqual(result.textured, {
		affine: [0, 0, 255, 255], upright: [0, 255, 255, 255], near: [0, 0, 255, 255], clipped: [0, 0, 0, 0],
		hole: [255, 255, 0, 255], opaque: [255, 0, 0, 255], alpha: [0, 128, 0, 128], coplanar: [255, 0, 255, 255],
		composite: [16, 144, 32, 255], changed: [255, 255, 255, 255], idle: { passes: 0, uploads: 0 },
		cutout: [0, 128, 0, 128], cutoutComposite: [16, 144, 32, 255],
	});
	assert.deepEqual(result.gpuErrors, []);
	assert.equal(result.gxAffineMatches, true); assert.equal(result.gxNearMatches, true);
	const gains = [0, 1, 64, 127, 128, 129, 192, 255];
	for (let y = 0; y < gains.length; y++) for (let x = 0; x < 32; x++) {
		const channels = x < 2 ? [0, 0, 0] : [x, 31 - x, (x * 3) & 31], color = [gains[y], 255 - gains[y], 128];
		const expected = channels.map((value, channel) => {
			const rgb5 = Math.min((value * color[channel]) >> 7, 31);
			return (rgb5 << 3) | (rgb5 >> 2);
		});
		const offset = (y * 32 + x) * 4;
		assert.deepEqual(result.gxPixels.slice(offset, offset + 4), [...expected, x === 1 ? 0 : 255], `GX texel ${x}, gain ${gains[y]}`);
	}
	assert.deepEqual(result.gxPixels.slice(8 * 32 * 4, 8 * 32 * 4 + 4), [49, 123, 74, 255]);
	assert.equal(result.validationError, undefined);
	assert.deepEqual(errors, []);
});
