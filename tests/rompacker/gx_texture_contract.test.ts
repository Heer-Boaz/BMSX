import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { createCanvas } from 'canvas';
import { materializeCpuCompletionValues } from '../lua/cpu_test_harness';

import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import {
	BLUA32_IMAGE_ID,
} from '../../toolchain/ts/rompack/blua32_image';
import {
	BLUA32_BIOS_IMPORTS_IMAGE_ID,
	decodeBlua32BiosImports,
} from '../../toolchain/ts/rompack/blua32_bios_imports';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { layoutRomAssetPayloads } from '../../toolchain/ts/rompack/asset_layout';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import { loadRomAssetList } from '../../toolchain/ts/rompack/loader';
import {
	decodeGxTextureImage,
	encodeDirect16GxTexture,
	encodePalette4GxTexture,
	gxTextureFitsPalette4,
} from '../../toolchain/ts/rompack/gx_texture_codec';
import {
	GX_GPU_TEXTURE_MODE_PALETTE4,
	gxGpuPair16,
} from '../../machine/ts/spec/gx/gp0';
import { layoutRomPrefix } from '../../toolchain/ts/rompack/rom_prefix_layout';
import { buildAssetModalView } from '../../scripts/rominspector/asset_modal_view';
import { resolveTextureAtlasName } from '../../scripts/rompacker/atlasbuilder';
import { decodeImgDecStream, encodeImgDecStream } from '../../toolchain/ts/rompack/imgdec_codec';
import {
	buildRomBlua32Tail,
	compileLuaChunkBuffer,
	createTextureAtlases,
	finalizeRompack,
	generateRomAssets,
	parseImageMeta,
} from '../../scripts/rompacker/rombuilder';
import type { ImageResource, Resource, TextureAtlasResource } from '../../scripts/rompacker/rompacker.rompack';
import { GX_SYSTEM_TEXTURE_ATLAS_NAME } from '../../scripts/rompacker/texture_atlas_contract';
import { SYSTEM_ROM_ASSET_OFFSET } from '../../toolchain/ts/rompack/system';

const PACKED_TEXTURE_ROM_ROOT = join(process.cwd(), 'tmp', 'gx-texture-rom-contract-test');

test('system and cart producers resolve distinct named atlases', () => {
	assert.equal(
		resolveTextureAtlasName('/workspace/system/font.png', ['/workspace/system'], undefined),
		GX_SYSTEM_TEXTURE_ATLAS_NAME,
	);
	assert.equal(
		resolveTextureAtlasName('/workspace/cart/player@atlas=gameplay.png', ['/workspace/system'], 'gameplay'),
		'gameplay',
	);
	assert.throws(
		() => resolveTextureAtlasName('/workspace/cart/player.png', ['/workspace/system'], undefined),
		/must declare a named @atlas=<name>/,
	);
});

test('direct16 production emits destination-free RGB555 STP words', () => {
	const texture = encodeDirect16GxTexture(3, 1, new Uint8ClampedArray([
		0xff, 0x00, 0x00, 0xff,
		0xff, 0xff, 0xff, 0x00,
		0x00, 0x00, 0xff, 0xff,
	]));

	assert.equal(texture.wordWidth, 3);
	assert.equal(texture.height, 1);
	assert.deepEqual(Array.from(texture.words), [
		0x1f, 0x80, 0x00, 0x00,
		0x00, 0xfc, 0x00, 0x00,
	]);
});

test('palette4 production keeps packed texels and the CLUT in one destination-free payload', () => {
	const texture = encodePalette4GxTexture(4, 1, new Uint8ClampedArray([
		0x00, 0x00, 0x00, 0x00,
		0xff, 0x00, 0x00, 0xff,
		0x00, 0xff, 0x00, 0xff,
		0x00, 0x00, 0xff, 0xff,
	]));

	assert.equal(texture.wordWidth, 1);
	assert.deepEqual(Array.from(texture.words.subarray(0, 12)), [
		0x10, 0x32, 0x00, 0x00,
		0x00, 0x00, 0x1f, 0x80,
		0xe0, 0x83, 0x00, 0xfc,
	]);
});

test('ROM inspection decodes raw system textures and decompressed cart texture streams', () => {
	const direct = encodeDirect16GxTexture(1, 1, new Uint8ClampedArray([0xff, 0x00, 0x00, 0xff]));
	const directImgDec = encodeImgDecStream(direct.words, direct.textureWordCount, direct.clutWordCount);
	const directMeta = {
		width: 1,
		height: 1,
		textureU: 0,
		textureV: 0,
	};
	assert.deepEqual(
		Array.from(decodeGxTextureImage(direct.words, direct, directMeta).rgba),
		[255, 0, 0, 255],
	);
	assert.deepEqual(
		Array.from(decodeGxTextureImage(decodeImgDecStream(directImgDec).payload, direct, directMeta).rgba),
		[255, 0, 0, 255],
	);

	const palette = encodePalette4GxTexture(4, 1, new Uint8ClampedArray([
		0x00, 0x00, 0x00, 0x00,
		0xff, 0x00, 0x00, 0xff,
		0x00, 0xff, 0x00, 0xff,
		0x00, 0x00, 0xff, 0xff,
	]));
	const paletteImgDec = encodeImgDecStream(palette.words, palette.textureWordCount, palette.clutWordCount);
	const paletteMeta = {
		width: 1,
		height: 1,
		textureU: 2,
		textureV: 0,
	};
	assert.deepEqual(
		Array.from(decodeGxTextureImage(decodeImgDecStream(paletteImgDec).payload, palette, paletteMeta).rgba),
		[0, 255, 0, 255],
	);
});

test('palette4 production rejects a seventeenth RGB555 STP color', () => {
	const rgba = new Uint8ClampedArray(17 * 4);
	for (let color = 0; color < 17; color += 1) {
		const offset = color * 4;
		rgba[offset] = color << 3;
		rgba[offset + 3] = 0xff;
	}
	assert.throws(
		() => encodePalette4GxTexture(17, 1, rgba),
		/more than 16 RGB555\/STP colors/,
	);
});

test('image annotations retain only semantic collision and atlas metadata', () => {
	assert.deepEqual(
		parseImageMeta('intro@atlas=story@cc'),
		{
			sanitizedName: 'intro',
			collisionType: 'concave',
			targetAtlasName: 'story',
		},
	);
});

test('palette4 admission is selected only when the native GX palette is lossless', () => {
	const rgba = new Uint8ClampedArray(17 * 4);
	for (let color = 0; color < 17; color += 1) {
		const offset = color * 4;
		rgba[offset] = color << 3;
		rgba[offset + 3] = 0xff;
	}
	assert.equal(gxTextureFitsPalette4(rgba.subarray(0, 16 * 4)), true);
	assert.equal(gxTextureFitsPalette4(rgba), false);
});

test('a packed cart texture resolves through the ROM loader, inspector, and cart library', async () => {
	const firstCanvas = createCanvas(16, 16);
	const firstContext = firstCanvas.getContext('2d');
	firstContext.fillStyle = '#ff0000';
	firstContext.fillRect(0, 0, 16, 16);
	const secondCanvas = createCanvas(16, 16);
	const secondContext = secondCanvas.getContext('2d');
	secondContext.fillStyle = '#00ff00';
	secondContext.fillRect(0, 0, 16, 16);
	const group: TextureAtlasResource = {
		type: 'atlas',
		name: 'story',
		id: 1,
	};
	const first: ImageResource = {
		type: 'image',
		name: 'first',
		id: 2,
		collisionType: 'aabb',
		targetAtlasName: 'story',
		img: firstCanvas as unknown as ImageResource['img'],
	};
	const second: ImageResource = {
		type: 'image',
		name: 'second',
		id: 3,
		collisionType: 'aabb',
		targetAtlasName: 'story',
		img: secondCanvas as unknown as ImageResource['img'],
	};
	const resources: Resource[] = [group, first, second];

	await createTextureAtlases(resources);
	assert.ok(group.gxTexture);
	assert.equal(group.gxTexture.mode, GX_GPU_TEXTURE_MODE_PALETTE4);
	assert.deepEqual([first.textureU, first.textureV], [0, 0]);
	assert.deepEqual([second.textureU, second.textureV], [16, 0]);

	const assets = await generateRomAssets(resources);
	const textureId = 'story';
	assert.deepEqual(assets.map(asset => asset.resid), [textureId, 'first', 'second']);
	const texture = assets[0];
	assert.equal(texture.type, 'texture');
	assert.deepEqual(texture.texturemeta, {
		mode: group.gxTexture.mode,
		word_width: group.gxTexture.wordWidth,
		height: group.gxTexture.height,
		texture_word_count: group.gxTexture.textureWordCount,
		clut_word_count: group.gxTexture.clutWordCount,
	});
	assert.equal(assets[1].imgmeta!.gx_atlas_id, textureId);
	assert.equal(assets[2].imgmeta!.gx_atlas_id, textureId);
	const payloadLayout = layoutRomAssetPayloads(assets, true);
	assert.equal(payloadLayout.entries[0].start, payloadLayout.ranges[0].start);
	assert.equal(payloadLayout.entries[0].end, payloadLayout.ranges[0].end);
	assert.equal(payloadLayout.entries[1].model_texture_start, undefined);
	assert.equal(payloadLayout.entries[2].model_texture_start, undefined);

	await rm(PACKED_TEXTURE_ROM_ROOT, { recursive: true, force: true });
	try {
		const cartPrefix = layoutRomPrefix(assets, true, null);
		const systemEntrySource = `module<entry>
require('base')
table = require('table')
string = require('string/base')
cop0.exec = mem[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]
`;
		const systemModuleSources = [
			['base', readFileSync('machine/bios/base.lua', 'utf8')],
			['tty/console', 'return { write = function() end, end_line = function() end }'],
			['table', readFileSync('machine/bios/table.lua', 'utf8')],
			['string/base', readFileSync('machine/bios/string/base.lua', 'utf8')],
			['string/utf8', readFileSync('machine/bios/string/utf8.lua', 'utf8')],
		] as const;
		const systemExecutableSources: RomAsset[] = [{
			type: 'lua',
			resid: 'entry',
			buffer: Buffer.from(systemEntrySource),
			compiled_buffer: compileLuaChunkBuffer(systemEntrySource, 'entry.lua'),
			source_path: 'entry.lua',
		}];
		for (let index = 0; index < systemModuleSources.length; index += 1) {
			const [path, source] = systemModuleSources[index];
			systemExecutableSources.push({
				type: 'lua',
				resid: path,
				buffer: Buffer.from(source),
				compiled_buffer: compileLuaChunkBuffer(source, `${path}.lua`),
				source_path: `${path}.lua`,
			});
		}
		const systemPrefix = layoutRomPrefix([], false, null);
		const systemBlua32 = buildRomBlua32Tail(systemExecutableSources, {
			generatedLuaModules: [],
			includeSymbols: true,
			optLevel: 3,
			systemAssetEndOffset: SYSTEM_ROM_ASSET_OFFSET,
			domain: 'system',
			ramByteCount: 0x00400000,
			biosExports: [],
		});
		await finalizeRompack('texture-contract-system', {
			debug: false,
			cartridgeBoardWord: 0,
			cartridgeRamByteCount: 0,
			blua32: systemBlua32,
			layout: systemPrefix,
			outputDirectory: PACKED_TEXTURE_ROM_ROOT,
		});
		const systemRom = await readFile(join(PACKED_TEXTURE_ROM_ROOT, 'texture-contract-system.rom'));
		const systemIndex = await loadRomAssetList(systemRom, 'system');
		const systemImportsEntry = systemIndex.entries.find(asset => asset.resid === BLUA32_BIOS_IMPORTS_IMAGE_ID)!;
		const biosImports = decodeBlua32BiosImports(
			systemRom.subarray(systemImportsEntry.start, systemImportsEntry.end),
		);

		const cartEntrySource = `module<entry>
local atlas<const> = require('cartlib/gx/atlas')
local image<const> = require('cartlib/gx/image')
local imgdec<const> = require('cartlib/gx/imgdec')
local vram<const> = require('cartlib/gx/vram')
vram.configure(1)
local first_image<const> = image.resolve('first')
local second_image<const> = image.resolve('second')
atlas.load('story')
local allocation<const> = first_image._texture._allocation
local first_destination<const> = imgdec.destination()
atlas.load('story')
return first_image._texture == second_image._texture and 1 or 0,
	allocation == first_image._texture._allocation and 1 or 0,
	imgdec.upload_count(), first_destination, imgdec.last_upload()
`;
		const cartModuleSources = [
			['cartlib/memory', readFileSync('cartlib/memory.lua', 'utf8')],
			['string/float/decode', readFileSync('machine/bios/string/float/decode.lua', 'utf8')],
			['cartlib/bin', readFileSync('cartlib/bin.lua', 'utf8')],
			['cartlib/rom_dir', readFileSync('cartlib/rom_dir.lua', 'utf8')],
			['gpu/system_vram_region', `return function()
	return ${gxGpuPair16(704, 720)}, ${gxGpuPair16(320, 304)}
end`],
			['cartlib/gx/display', `return {
	read_size_word = function()
		return ${gxGpuPair16(320, 240)}
	end,
}`],
			['cartlib/gx/gp0', readFileSync('cartlib/gx/gp0.lua', 'utf8')],
			['cartlib/gx/command_list', 'return { blit = function() end }'],
			['cartlib/gx/imgdec', `local imgdec<const> = {}
local count = 0
local source_addr, source_word_count, texture_word_count, clut_word_count, destination, size, clut_destination = 0, 0, 0, 0, 0, 0, 0
function imgdec.upload(source, source_words, texture_words, clut_words, target, target_size, clut_target)
	count = count + 1
	source_addr = source
	source_word_count = source_words
	texture_word_count = texture_words
	clut_word_count = clut_words
	destination = target
	size = target_size
	clut_destination = clut_target
end
function imgdec.last_upload()
	return source_addr, source_word_count, texture_word_count, clut_word_count, destination, size, clut_destination
end
function imgdec.upload_count()
	return count
end
function imgdec.destination()
	return destination
end
return imgdec
`],
			['cartlib/gx/vram', readFileSync('cartlib/gx/vram.lua', 'utf8')],
			['cartlib/gx/atlas', readFileSync('cartlib/gx/atlas.lua', 'utf8')],
			['cartlib/gx/image', readFileSync('cartlib/gx/image.lua', 'utf8')],
		] as const;
		const cartExecutableSources: RomAsset[] = [{
			type: 'lua',
			resid: 'cart',
			buffer: Buffer.from(cartEntrySource),
			compiled_buffer: compileLuaChunkBuffer(cartEntrySource, 'cart.lua'),
			source_path: 'cart.lua',
		}];
		for (let index = 0; index < cartModuleSources.length; index += 1) {
			const [path, source] = cartModuleSources[index];
			cartExecutableSources.push({
				type: 'lua',
				resid: path,
				buffer: Buffer.from(source),
				compiled_buffer: compileLuaChunkBuffer(source, `${path}.lua`),
				source_path: `${path}.lua`,
			});
		}
		const cartBlua32 = buildRomBlua32Tail(cartExecutableSources, {
			generatedLuaModules: [],
			includeSymbols: true,
			optLevel: 3,
			imageOffset: cartPrefix.nextOffset,
			domain: 'cart',
			ramByteCount: 0x00400000,
			biosImports,
		});
		await finalizeRompack('texture-contract', {
			debug: false,
			cartridgeBoardWord: 0,
			cartridgeRamByteCount: 0,
			blua32: cartBlua32,
			layout: cartPrefix,
			outputDirectory: PACKED_TEXTURE_ROM_ROOT,
		});
		const rom = await readFile(join(PACKED_TEXTURE_ROM_ROOT, 'texture-contract.rom'));
		const loaded = await loadRomAssetList(rom, 'cart');
		const loadedTexture = loaded.entries.find(asset => asset.type === 'texture')!;
		const loadedFirst = loaded.entries.find(asset => asset.resid === first.name)!;
		const loadedSecond = loaded.entries.find(asset => asset.resid === second.name)!;
		assert.equal(loadedTexture.resid, textureId);
		assert.deepEqual(loadedTexture.texturemeta, texture.texturemeta);
		assert.equal(loadedFirst.imgmeta!.gx_atlas_id, textureId);
		assert.equal(loadedSecond.imgmeta!.gx_atlas_id, textureId);

		const decodedTexture = {};
		const modalContext = {
			rombin: rom,
			assetList: loaded.entries,
			decodedTexture,
			manifest: null,
			projectRootPath: null,
			formatByteSize: (size: number) => `${size} bytes`,
			modalWidth: 80,
			modalHeight: 24,
			previewZoom: 1,
		};
		const firstView = await buildAssetModalView(loadedFirst, modalContext);
		const secondView = await buildAssetModalView(loadedSecond, modalContext);
		assert.deepEqual(Array.from(firstView.previewSections[0].rgba.subarray(0, 4)), [255, 0, 0, 255]);
		assert.deepEqual(Array.from(secondView.previewSections[0].rgba.subarray(0, 4)), [0, 255, 0, 255]);

		const memory = new Memory({ systemRom, cartridgeSlots: cartridgeSlots(rom) }, PSX_MACHINE_SPEC.ramBytes);
		const executionAddressSpace = new ExecutionAddressSpace(memory);
		const cpu = new CPU(memory, new IrqController(memory), executionAddressSpace);
		cpu.reset();
		cpu.installBootPrimitives();
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		const textureDestination = gxGpuPair16(320, 0);
		const clutDestination = gxGpuPair16(320, 16);
		assert.deepEqual(materializeCpuCompletionValues(cpu).map(value => (value as number) >>> 0), [
			1,
			1,
			1,
			textureDestination,
			CART_ROM_BASE + loadedTexture.start!,
			(loadedTexture.end! - loadedTexture.start!) >> 2,
			loadedTexture.texturemeta!.texture_word_count,
			loadedTexture.texturemeta!.clut_word_count,
			textureDestination,
			loadedTexture.texturemeta!.word_width | (loadedTexture.texturemeta!.height << 16),
			clutDestination,
		]);
	} finally {
		await rm(PACKED_TEXTURE_ROM_ROOT, { recursive: true, force: true });
	}
});
