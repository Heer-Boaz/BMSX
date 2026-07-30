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
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import {
	BLUA32_IMAGE_ID,
	decodeBlua32Image,
} from '../../toolchain/ts/rompack/blua32_image';
import {
	BLUA32_SYMBOLS_IMAGE_ID,
	decodeBlua32SymbolsImage,
} from '../../toolchain/ts/rompack/blua32_symbols';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { LUA_BOOT_PRIMITIVES } from '../../machine/ts/spec/blua32/builtin';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { layoutRomAssetPayloads } from '../../toolchain/ts/rompack/asset_layout';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import { loadRomAssetList } from '../../toolchain/ts/rompack/loader';
import {
	decodeGxTextureImage,
	encodeDirect16GxTexture,
	encodePalette4GxTexture,
} from '../../toolchain/ts/rompack/gx_texture_codec';
import { layoutRomPrefix } from '../../toolchain/ts/rompack/rom_prefix_layout';
import { buildAssetModalView } from '../../scripts/rominspector/asset_modal_view';
import { resolveTextureGroupId } from '../../scripts/rompacker/atlasbuilder';
import { validateGxTextureLayout, type GxTextureLayout } from '../../scripts/rompacker/gx_texture_layout';
import { decodeImgDecStream, encodeImgDecStream } from '../../toolchain/ts/rompack/imgdec_codec';
import {
	buildRomBlua32Tail,
	compileLuaChunkBuffer,
	createTextureAtlases,
	finalizeRompack,
	generateRomAssets,
} from '../../scripts/rompacker/rombuilder';
import type { ImageResource, Resource, TextureAtlasResource } from '../../scripts/rompacker/rompacker.rompack';
import {
	GX_CART_TEXTURE_GROUP_ID_LIMIT,
	GX_SYSTEM_TEXTURE_GROUP_ID,
	textureGroupResourceName,
} from '../../scripts/rompacker/texture_atlas_contract';
import {
	GX_SYSTEM_VRAM_HEIGHT,
	GX_SYSTEM_VRAM_WIDTH,
	GX_SYSTEM_VRAM_X,
	GX_SYSTEM_VRAM_Y,
} from '../../scripts/rompacker/system_texture';

const PACKED_TEXTURE_ROM_ROOT = join(process.cwd(), 'tmp', 'gx-texture-rom-contract-test');

const GX_SYSTEM_VRAM_RESERVATION = {
	system: {
		x: GX_SYSTEM_VRAM_X,
		y: GX_SYSTEM_VRAM_Y,
		width: GX_SYSTEM_VRAM_WIDTH,
		height: GX_SYSTEM_VRAM_HEIGHT,
	},
};

test('texture group 254 belongs exclusively to the system producer', () => {
	assert.equal(resolveTextureGroupId('/workspace/system/font.png', ['/workspace/system']), GX_SYSTEM_TEXTURE_GROUP_ID);
	assert.equal(resolveTextureGroupId('/workspace/cart/player.png', ['/workspace/system']), 0);
	assert.equal(GX_CART_TEXTURE_GROUP_ID_LIMIT, GX_SYSTEM_TEXTURE_GROUP_ID);
	assert.throws(
		() => resolveTextureGroupId('/workspace/cart/player@atlas=254.png', ['/workspace/system'], GX_SYSTEM_TEXTURE_GROUP_ID),
		/collides with reserved system texture group id/,
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

test('GX layout validation rejects overlapping slots in one cart-authored working set', () => {
	const layout: GxTextureLayout = {
		reserved: GX_SYSTEM_VRAM_RESERVATION,
		slots: {
			left: { texture: { x: 0, y: 256, width: 128, height: 128 } },
			right: { texture: { x: 64, y: 256, width: 128, height: 128 } },
		},
		groups: {},
		working_sets: { scene: ['left', 'right'] },
	};
	assert.throws(
		() => validateGxTextureLayout(layout),
		/working set 'scene' overlaps slots 'left' and 'right'/,
	);
});

test('GX layout validation rejects texture storage outside physical VRAM', () => {
	const layout: GxTextureLayout = {
		reserved: GX_SYSTEM_VRAM_RESERVATION,
		slots: {
		main: { texture: { x: 1024, y: 0, width: 1, height: 1 } },
		},
		groups: {},
		working_sets: {},
	};
	assert.throws(
		() => validateGxTextureLayout(layout),
		/outside 1024x1024 VRAM/,
	);
});

test('GX layout validation rejects a palette4 CLUT that cannot be encoded exactly', () => {
	const layout: GxTextureLayout = {
		reserved: GX_SYSTEM_VRAM_RESERVATION,
		slots: {
			main: {
				texture: { x: 512, y: 256, width: 128, height: 128 },
				clut: { x: 513, y: 448, width: 16, height: 1 },
			},
		},
		groups: {
			0: { mode: 'palette4', slots: ['main'], page_local: true },
		},
		working_sets: {},
	};
	assert.throws(
		() => validateGxTextureLayout(layout),
		/not aligned for a PSX texture page and 16-word CLUT/,
	);
});

test('GX layout validation reserves the system group id from cart manifests', () => {
	const layout: GxTextureLayout = {
		reserved: GX_SYSTEM_VRAM_RESERVATION,
		slots: {
			main: { texture: { x: 0, y: 256, width: 256, height: 256 } },
		},
		groups: {
			254: { mode: 'direct16', slots: ['main'], page_local: true },
		},
		working_sets: {},
	};
	assert.throws(
		() => validateGxTextureLayout(layout),
		/not a cart texture group id below 254/,
	);
});

test('GX layout validation rejects unknown texture modes at the manifest boundary', () => {
	const layout = {
		reserved: GX_SYSTEM_VRAM_RESERVATION,
		slots: {
			main: { texture: { x: 0, y: 256, width: 256, height: 256 } },
		},
		groups: {
			0: { mode: 'rgb777', slots: ['main'], page_local: true },
		},
		working_sets: {},
	} as unknown as GxTextureLayout;
	assert.throws(
		() => validateGxTextureLayout(layout),
		/unknown mode 'rgb777'/,
	);
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
		name: '_atlas_00',
		id: 1,
		atlasId: 0,
	};
	const first: ImageResource = {
		type: 'image',
		name: 'first',
		id: 2,
		collisionType: 'aabb',
		targetAtlasId: 0,
		img: firstCanvas as unknown as ImageResource['img'],
	};
	const second: ImageResource = {
		type: 'image',
		name: 'second',
		id: 3,
		collisionType: 'aabb',
		targetAtlasId: 0,
		img: secondCanvas as unknown as ImageResource['img'],
	};
	const resources: Resource[] = [group, first, second];
	const layout: GxTextureLayout = {
		reserved: GX_SYSTEM_VRAM_RESERVATION,
		slots: {
			main: { texture: { x: 0, y: 0, width: 256, height: 256 } },
		},
		groups: {
			0: { mode: 'direct16', slots: ['main'], page_local: true },
		},
		working_sets: {
			main: ['main'],
		},
	};

	await createTextureAtlases(resources, layout);
	assert.ok(group.gxTexture);
	assert.deepEqual([first.textureU, first.textureV], [0, 0]);
	assert.deepEqual([second.textureU, second.textureV], [16, 0]);

	const assets = await generateRomAssets(resources);
	const textureId = textureGroupResourceName(0);
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
	assert.equal(assets[1].imgmeta!.gx_texture_resid, textureId);
	assert.equal(assets[2].imgmeta!.gx_texture_resid, textureId);
	const payloadLayout = layoutRomAssetPayloads(assets, true);
	assert.equal(payloadLayout.entries[0].start, payloadLayout.ranges[0].start);
	assert.equal(payloadLayout.entries[0].end, payloadLayout.ranges[0].end);
	assert.equal(payloadLayout.entries[1].model_texture_start, undefined);
	assert.equal(payloadLayout.entries[2].model_texture_start, undefined);

	await rm(PACKED_TEXTURE_ROM_ROOT, { recursive: true, force: true });
	try {
		const cartPrefix = layoutRomPrefix(assets, true, null);
		const entrySource = `module<entry>
require('bios/base')
require('bios/table')
require('bios/string_base')
local romdir<const> = require('cartlib/romdir')
local texture<const> = require('cartlib/gx/texture')
local imgdec<const> = require('cartlib/gx/imgdec')
local first_texture<const> = texture.from_image(romdir.image('first'))
local second_texture<const> = texture.from_image(romdir.image('second'))
texture.upload(first_texture, 0x00200040, 0)
return first_texture == second_texture and 1 or 0, imgdec.last_upload()
`;
		const moduleSources = [
			['bios/base', readFileSync('machine/firmware/bios/base.lua', 'utf8')],
			['bios/table', readFileSync('machine/firmware/bios/table.lua', 'utf8')],
			['bios/string_base', readFileSync('machine/firmware/bios/string_base.lua', 'utf8')],
			['bios/common/endian', readFileSync('machine/firmware/bios/common/endian.lua', 'utf8')],
			['bios/common/float_bits', readFileSync('machine/firmware/bios/common/float_bits.lua', 'utf8')],
			['cartlib/bin', readFileSync('cartlib/bin.lua', 'utf8')],
			['cartlib/romdir', readFileSync('cartlib/romdir.lua', 'utf8')],
			['bios/gx_gpu', 'return { texture_mode_palette4 = 0 }'],
			['cartlib/gx/imgdec', `
local imgdec<const> = {}
local source_addr, source_word_count, texture_word_count, clut_word_count, destination, size, clut_destination = 0, 0, 0, 0, 0, 0, 0
function imgdec.upload(source, source_words, texture_words, clut_words, target, target_size, clut_target)
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
return imgdec
`],
			['cartlib/gx/texture', readFileSync('cartlib/gx/texture.lua', 'utf8')],
		] as const;
		const executableSources: RomAsset[] = [{
			type: 'lua',
			resid: 'entry',
			buffer: Buffer.from(entrySource),
			compiled_buffer: compileLuaChunkBuffer(entrySource, 'entry.lua'),
			source_path: 'entry.lua',
		}];
		for (let index = 0; index < moduleSources.length; index += 1) {
			const [path, source] = moduleSources[index];
			executableSources.push({
				type: 'lua',
				resid: path,
				buffer: Buffer.from(source),
				compiled_buffer: compileLuaChunkBuffer(source, `${path}.lua`),
				source_path: `${path}.lua`,
			});
		}
		const systemPrefix = layoutRomPrefix([], false, null);
		const systemBlua32 = buildRomBlua32Tail(executableSources, {
			externalLuaAssets: [],
			generatedLuaModules: [],
			includeSymbols: true,
			optLevel: 3,
			imageOffset: systemPrefix.blua32Offset,
			domain: 'system',
			ramByteCount: 0x00400000,
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
		const systemImageEntry = systemIndex.entries.find(asset => asset.resid === BLUA32_IMAGE_ID)!;
		const systemSymbolsEntry = systemIndex.entries.find(asset => asset.resid === BLUA32_SYMBOLS_IMAGE_ID)!;
		const systemSymbols = decodeBlua32SymbolsImage(
			systemRom.subarray(systemSymbolsEntry.start, systemSymbolsEntry.end),
		);
		const systemImage = decodeBlua32Image(
			systemRom.subarray(systemImageEntry.start, systemImageEntry.end),
			SYSTEM_ROM_BASE + systemImageEntry.start!,
		);
		const cartEntrySource = 'module<entry>\nreturn 0';
		const cartBlua32 = buildRomBlua32Tail([{
			type: 'lua',
			resid: 'cart',
			buffer: Buffer.from(cartEntrySource),
			compiled_buffer: compileLuaChunkBuffer(cartEntrySource, 'cart.lua'),
			source_path: 'cart.lua',
		}], {
			externalLuaAssets: [],
			generatedLuaModules: [],
			includeSymbols: true,
			optLevel: 3,
			imageOffset: cartPrefix.blua32Offset,
			domain: 'cart',
			ramByteCount: 0x00400000,
			systemImage,
			systemSymbols,
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
		assert.equal(loadedFirst.imgmeta!.gx_texture_resid, textureId);
		assert.equal(loadedSecond.imgmeta!.gx_texture_resid, textureId);

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
		const cartSymbolsEntry = loaded.entries.find(asset => asset.resid === BLUA32_SYMBOLS_IMAGE_ID)!;
		const cartSymbols = decodeBlua32SymbolsImage(rom.subarray(cartSymbolsEntry.start, cartSymbolsEntry.end));
		cpu.reset();
		for (let index = 0; index < LUA_BOOT_PRIMITIVES.length; index += 1) {
			const primitive = LUA_BOOT_PRIMITIVES[index];
			cpu.setSystemGlobalByKey(
				cpu.stringPool.intern(primitive.name),
				ValueTag.BuiltinFunction,
				primitive.id,
				null,
			);
		}
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu).map(value => (value as number) >>> 0), [
			1,
			CART_ROM_BASE + loadedTexture.start!,
			(loadedTexture.end! - loadedTexture.start!) >> 2,
			loadedTexture.texturemeta!.texture_word_count,
			loadedTexture.texturemeta!.clut_word_count,
			0x00200040,
			loadedTexture.texturemeta!.word_width | (loadedTexture.texturemeta!.height << 16),
			0,
		]);
	} finally {
		await rm(PACKED_TEXTURE_ROM_ROOT, { recursive: true, force: true });
	}
});
