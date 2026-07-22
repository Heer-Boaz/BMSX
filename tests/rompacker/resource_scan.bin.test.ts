import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { CART_ROM_BASE } from '../../machine/ts/machine/memory/map';
import { buildRomAssetSymbolModuleSource, collectRomAssetSymbols } from '../../machine/ts/rompack/asset_symbols';
import { layoutRomAssetPayloads } from '../../machine/ts/rompack/asset_layout';
import { CART_ROM_HEADER_SIZE, CART_ROM_WORD_ALIGNMENT, PROGRAM_BOOT_HEADER_VERSION, type RomAsset } from '../../machine/ts/rompack/format';
import { loadRomAssetList } from '../../machine/ts/rompack/loader';
import { layoutRomProgramPrefix } from '../../machine/ts/rompack/tooling/rom_layout';
import { PROGRAM_IMAGE_ID } from '../../machine/ts/machine/program/loader';
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
		{ type: 'romlabel', resid: 'label', buffer: Buffer.from([9, 9, 9, 9]) },
	];
	const entries = layoutRomAssetPayloads(assets, true).entries;
	entries.push({ type: 'bin', resid: 'raw.bin', start: 0x200, end: 0x208, payload_id: 'cart' });
	const symbols = collectRomAssetSymbols(entries, 'cart');

	assert.deepEqual(symbols.map(symbol => [symbol.name, symbol.address, symbol.byteLength]), [
		['data_stage_1', CART_ROM_BASE + CART_ROM_HEADER_SIZE + 4, 3],
		['bin_raw_bin', CART_ROM_BASE + 0x200, 8],
	]);

	const source = buildRomAssetSymbolModuleSource(entries);
	assert.match(source, new RegExp(`local data_stage_1_addr <const> = ${CART_ROM_BASE + CART_ROM_HEADER_SIZE + 4}`));
	assert.match(source, /local data_stage_1_len <const> = 3/);
	assert.match(source, /local bin_raw_bin_addr <const> = 16777728/);
	assert.doesNotMatch(source, /romlabel/);
});

test('ROM asset layout produces the final TOC entries consumed by symbols', () => {
	const assets: RomAsset[] = [
		{ type: 'lua', resid: 'cart', compiled_buffer: Buffer.from([0xaa, 0xbb]) },
		{ type: 'data', resid: 'stage-1', buffer: Buffer.from([1, 2, 3]), compiled_buffer: Buffer.from([4]) },
	];
	const layout = layoutRomAssetPayloads(assets, true);
	assert.deepEqual(layout.ranges.map(range => [range.start, range.end]), [
		[CART_ROM_HEADER_SIZE, CART_ROM_HEADER_SIZE + 2],
		[CART_ROM_HEADER_SIZE + 4, CART_ROM_HEADER_SIZE + 7],
		[CART_ROM_HEADER_SIZE + 8, CART_ROM_HEADER_SIZE + 9],
	]);
	assert.deepEqual(layout.entries, [
		{ type: 'lua', resid: 'cart', compiled_start: CART_ROM_HEADER_SIZE, compiled_end: CART_ROM_HEADER_SIZE + 2 },
		{ type: 'data', resid: 'stage-1', start: CART_ROM_HEADER_SIZE + 4, end: CART_ROM_HEADER_SIZE + 7, compiled_start: CART_ROM_HEADER_SIZE + 8, compiled_end: CART_ROM_HEADER_SIZE + 9 },
	]);
	assert.deepEqual(collectRomAssetSymbols(layout.entries, 'cart').map(symbol => symbol.address), [
		CART_ROM_BASE + CART_ROM_HEADER_SIZE + 4,
	]);
});

test('ROM writer materializes word-aligned payload ranges', async () => {
	const outputDirectory = join(ROOT, 'output');
	await rm(ROOT, { recursive: true, force: true });
	try {
		const assets: RomAsset[] = [
			{ type: 'data', resid: 'odd', buffer: Buffer.from([0x11]) },
			{ type: 'model', resid: 'model', model_texture_buffer: Buffer.from([0x22, 0x33]) },
			{ type: 'image', resid: 'sprite', collision_bin_buffer: Buffer.from([0x44, 0x55, 0x66, 0x77]) },
		];
		const layout = layoutRomProgramPrefix(assets, true, null);
		const ranges = layout.assetRanges;
		const programAssets: RomAsset[] = [
			{ type: 'code', resid: PROGRAM_IMAGE_ID, buffer: Buffer.from([0x88]), compiled_buffer: Buffer.from([0x99]) },
		];
		await finalizeRompack('aligned', {
			zipRom: false,
			debug: false,
			program: {
				boot: {
					version: PROGRAM_BOOT_HEADER_VERSION,
					flags: 0,
					resetProtoIndex: 0,
					codeByteCount: 0,
					constPoolCount: 0,
					protoCount: 0,
					constRelocCount: 0,
				},
				layout: layoutRomAssetPayloads(programAssets, true, layout.programOffset),
			},
			layout,
			outputDirectory,
		});
		const rom = await readFile(join(outputDirectory, 'aligned.rom'));
		const index = await loadRomAssetList(rom);
		const model = index.entries.find(entry => entry.resid === 'model')!;
		const sprite = index.entries.find(entry => entry.resid === 'sprite')!;
		assert.equal(model.model_texture_start, ranges[1].start);
		assert.equal(model.model_texture_end, ranges[1].end);
		assert.equal(sprite.collision_bin_start, ranges[2].start);
		assert.equal(sprite.collision_bin_end, ranges[2].end);
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
