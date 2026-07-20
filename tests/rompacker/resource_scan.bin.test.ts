import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { CART_ROM_BASE } from '../../machine/ts/machine/memory/map';
import { assertRomAssetSymbolsMatchToc, buildRomAssetSymbolModuleSource, collectRomAssetSymbols } from '../../machine/ts/rompack/asset_symbols';
import { layoutRomAssetPayloads } from '../../machine/ts/rompack/asset_layout';
import { CART_ROM_HEADER_SIZE, CART_ROM_WORD_ALIGNMENT, PROGRAM_BOOT_HEADER_VERSION, type RomAsset } from '../../machine/ts/rompack/format';
import { finalizeRompack, getResMetaList } from '../../scripts/rompacker/rombuilder';

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
		['data_stage_1', CART_ROM_BASE + CART_ROM_HEADER_SIZE + 4, 3],
		['bin_raw_bin', CART_ROM_BASE + 0x200, 8],
	]);

	const source = buildRomAssetSymbolModuleSource(assets, true);
	assert.match(source, new RegExp(`local data_stage_1_addr <const> = ${CART_ROM_BASE + CART_ROM_HEADER_SIZE + 4}`));
	assert.match(source, /local data_stage_1_len <const> = 3/);
	assert.match(source, /local bin_raw_bin_addr <const> = 16777728/);
	assert.doesNotMatch(source, /romlabel/);
});

test('ROM asset layout is shared by symbols and writer verification', () => {
	const assets: RomAsset[] = [
		{ type: 'lua', resid: 'cart', compiled_buffer: Buffer.from([0xaa, 0xbb]) },
		{ type: 'data', resid: 'stage-1', buffer: Buffer.from([1, 2, 3]), compiled_buffer: Buffer.from([4]) },
	];
	const ranges = layoutRomAssetPayloads(assets, true).ranges;
	assert.deepEqual(ranges.map(range => [range.asset.resid, range.kind, range.start, range.end]), [
		['cart', 'compiled', CART_ROM_HEADER_SIZE, CART_ROM_HEADER_SIZE + 2],
		['stage-1', 'buffer', CART_ROM_HEADER_SIZE + 4, CART_ROM_HEADER_SIZE + 7],
		['stage-1', 'compiled', CART_ROM_HEADER_SIZE + 8, CART_ROM_HEADER_SIZE + 9],
	]);

	const expected = collectRomAssetSymbols(assets, true, 'cart');
	assert.doesNotThrow(() => assertRomAssetSymbolsMatchToc(expected, [
		{ type: 'lua', resid: 'cart', compiled_start: CART_ROM_HEADER_SIZE, compiled_end: CART_ROM_HEADER_SIZE + 2 },
		{ type: 'data', resid: 'stage-1', start: CART_ROM_HEADER_SIZE + 4, end: CART_ROM_HEADER_SIZE + 7, compiled_start: CART_ROM_HEADER_SIZE + 8, compiled_end: CART_ROM_HEADER_SIZE + 9 },
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

test('ROM writer materializes word-aligned payload ranges', async () => {
	const outputDirectory = join(ROOT, 'output');
	await rm(ROOT, { recursive: true, force: true });
	try {
		const assets: RomAsset[] = [
			{ type: 'data', resid: 'odd', buffer: Buffer.from([0x11]) },
			{ type: 'image', resid: 'sprite', texture_buffer: Buffer.from([0x22, 0x33]), collision_bin_buffer: Buffer.from([0x44, 0x55, 0x66, 0x77]) },
		];
		const ranges = layoutRomAssetPayloads(assets, true).ranges;
		await finalizeRompack(assets, 'aligned', {
			zipRom: false,
			debug: false,
			programBoot: {
				version: PROGRAM_BOOT_HEADER_VERSION,
				flags: 0,
				resetProtoIndex: 0,
				codeByteCount: 0,
				constPoolCount: 0,
				protoCount: 0,
				constRelocCount: 0,
			},
			outputDirectory,
		});
		assert.equal(assets[1].texture_start, ranges[1].start);
		assert.equal(assets[1].texture_end, ranges[1].end);
		assert.equal(assets[1].collision_bin_start, ranges[2].start);
		assert.equal(assets[1].collision_bin_end, ranges[2].end);
		const rom = await readFile(join(outputDirectory, 'aligned.rom'));
		for (let index = 0; index < ranges.length; index += 1) {
			const range = ranges[index];
			assert.equal(range.start & (CART_ROM_WORD_ALIGNMENT - 1), 0);
			assert.deepEqual(rom.subarray(range.start, range.end), range.buffer);
			if (index > 0) {
				assert.deepEqual(rom.subarray(ranges[index - 1].end, range.start), Buffer.alloc(range.start - ranges[index - 1].end));
			}
		}
	} finally {
		await rm(ROOT, { recursive: true, force: true });
	}
});
