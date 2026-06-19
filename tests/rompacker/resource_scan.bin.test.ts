import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { CART_ROM_BASE } from '../../machine/ts/machine/memory/map';
import { assertRomAssetSymbolsMatchToc, buildRomAssetSymbolModuleSource, collectRomAssetSymbols } from '../../machine/ts/rompack/asset_symbols';
import { collectRomAssetPayloadRanges } from '../../machine/ts/rompack/asset_layout';
import { CART_ROM_HEADER_SIZE, type RomAsset } from '../../machine/ts/rompack/format';
import { getResMetaList } from '../../scripts/rompacker/rombuilder';

const ROOT = join(process.cwd(), 'tmp', 'rompacker-bin-scan-test');

test('resource scan treats glTF buffer URIs as model-owned and keeps other .bin files as raw assets', async () => {
	await rm(ROOT, { recursive: true, force: true });
	try {
		await mkdir(join(ROOT, 'data'), { recursive: true });
		await mkdir(join(ROOT, 'models'), { recursive: true });
		await mkdir(join(ROOT, 'raw'), { recursive: true });
		await writeFile(join(ROOT, 'data', 'tiles.bin'), Buffer.from([1, 2, 3, 4]));
		await writeFile(join(ROOT, 'raw', 'scripted.bin'), Buffer.from([9, 10, 11, 12]));
		await writeFile(join(ROOT, 'models', 'mesh.bin'), Buffer.from([5, 6, 7, 8]));
		await writeFile(join(ROOT, 'models', 'mesh.gltf'), JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'mesh.bin', byteLength: 4 }] }));

		const resources = await getResMetaList([ROOT]);
		const binResources = resources.filter(resource => resource.type === 'bin');

		assert.deepEqual(binResources.map(resource => resource.name).sort(), ['scripted', 'tiles']);
	} finally {
		await rm(ROOT, { recursive: true, force: true });
	}
});

test('ROM asset symbols expose concrete memory addresses without runtime lookup', () => {
	const assets: RomAsset[] = [
		{ type: 'lua', resid: 'cart', compiled_buffer: Buffer.from([0xaa, 0xbb]) },
		{ type: 'data', resid: 'stage-1', buffer: Buffer.from([1, 2, 3]) },
		{ type: 'bin', resid: 'raw.bin', start: 0x200, end: 0x208, payload_id: 'cart' },
		{ type: 'romlabel', resid: 'label', buffer: Buffer.from([9, 9, 9, 9]) },
	];
	const symbols = collectRomAssetSymbols(assets, true, 'cart');

	assert.deepEqual(symbols.map(symbol => [symbol.name, symbol.address, symbol.byteLength]), [
		['data_stage_1', CART_ROM_BASE + CART_ROM_HEADER_SIZE + 2, 3],
		['bin_raw_bin', CART_ROM_BASE + 0x200, 8],
	]);

	const source = buildRomAssetSymbolModuleSource(assets, true);
	assert.match(source, /local data_stage_1_addr <const> = 16777290/);
	assert.match(source, /local data_stage_1_len <const> = 3/);
	assert.match(source, /local bin_raw_bin_addr <const> = 16777728/);
	assert.doesNotMatch(source, /romlabel/);
});

test('ROM asset layout is shared by symbols and writer verification', () => {
	const assets: RomAsset[] = [
		{ type: 'lua', resid: 'cart', compiled_buffer: Buffer.from([0xaa, 0xbb]) },
		{ type: 'data', resid: 'stage-1', buffer: Buffer.from([1, 2, 3]), compiled_buffer: Buffer.from([4]) },
	];
	const ranges = collectRomAssetPayloadRanges(assets, true);
	assert.deepEqual(ranges.map(range => [range.asset.resid, range.kind, range.start, range.end]), [
		['cart', 'compiled', CART_ROM_HEADER_SIZE, CART_ROM_HEADER_SIZE + 2],
		['stage-1', 'buffer', CART_ROM_HEADER_SIZE + 2, CART_ROM_HEADER_SIZE + 5],
		['stage-1', 'compiled', CART_ROM_HEADER_SIZE + 5, CART_ROM_HEADER_SIZE + 6],
	]);

	const expected = collectRomAssetSymbols(assets, true, 'cart');
	assert.doesNotThrow(() => assertRomAssetSymbolsMatchToc(expected, [
		{ type: 'lua', resid: 'cart', compiled_start: CART_ROM_HEADER_SIZE, compiled_end: CART_ROM_HEADER_SIZE + 2 },
		{ type: 'data', resid: 'stage-1', start: CART_ROM_HEADER_SIZE + 2, end: CART_ROM_HEADER_SIZE + 5, compiled_start: CART_ROM_HEADER_SIZE + 5, compiled_end: CART_ROM_HEADER_SIZE + 6 },
	], true, 'cart'));
	const finalAssets: RomAsset[] = [
		{ type: 'lua', resid: 'cart', compiled_start: CART_ROM_HEADER_SIZE, compiled_end: CART_ROM_HEADER_SIZE + 2 },
		{ type: 'data', resid: 'stage-1', start: CART_ROM_HEADER_SIZE + 3, end: CART_ROM_HEADER_SIZE + 6, compiled_start: CART_ROM_HEADER_SIZE + 6, compiled_end: CART_ROM_HEADER_SIZE + 7 },
	];
	assert.throws(
		() => assertRomAssetSymbolsMatchToc(expected, finalAssets, true, 'cart'),
		/Generated symbol 'data_stage_1' does not match final TOC symbol 'data_stage_1'/,
	);
});
