import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { SCALABLE_FONT_ATLAS } from '../../hosts/fonts/jetbrains_mono/scalable_font.generated';
import { productNeedsRebuild } from '../../scripts/products/rebuild';

test('unbundled tools and shipped products consume the same binary font atlas', async () => {
	const bytes = await readFile('hosts/fonts/jetbrains_mono/scalable_font.rgba');
	assert.equal(bytes.byteLength, SCALABLE_FONT_ATLAS.width * SCALABLE_FONT_ATLAS.height * 4);
	assert.ok(bytes.equals(SCALABLE_FONT_ATLAS.pixels));
	for (const platform of ['node', 'browser'] as const) {
		const result = await build({ stdin: { contents: "export { default as pixels } from '#bmsx/scalable-font-pixels';", resolveDir: process.cwd() },
			platform, target: platform === 'node' ? 'node22' : 'es2020', conditions: ['bmsx-bundle', 'module'], loader: { '.rgba': 'binary' },
			bundle: true, write: false, metafile: true, format: 'iife', globalName: 'asset' });
		const context = { Buffer, Uint8Array, asset: undefined };
		runInNewContext(result.outputFiles[0].text, context);
		assert.ok(bytes.equals(context.asset.pixels), `${platform} packaging preserves linear distance bytes without image color conversion`);
		assert.equal(Object.keys(result.metafile.inputs).some(path => path.startsWith('hosts/node/')), false,
			'shipped products embed the asset without the unbundled tool filesystem reader');
	}
});

test('a changed binary font atlas invalidates the product even when glyph metrics are unchanged', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-font-asset-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const pixels = join(root, 'font.rgba'), product = join(root, 'product.js');
	await writeFile(pixels, new Uint8Array([1, 2, 3, 255]));
	await writeFile(product, '');
	await utimes(pixels, 100, 100); await utimes(product, 200, 200);
	assert.equal(await productNeedsRebuild(product, [root]), false);
	await utimes(pixels, 300, 300);
	assert.equal(await productNeedsRebuild(product, [root]), true);
});
