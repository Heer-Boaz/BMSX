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
	t.diagnostic(JSON.stringify(result));
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
	assert.deepEqual(result.gpuErrors, []);
	assert.equal(result.validationError, undefined);
	assert.deepEqual(errors, []);
});
