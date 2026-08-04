import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	GX_VRAM_LAYOUT_MODULE_PATH,
	GX_VRAM_LAYOUT_SOURCE_PATH,
} from '../../toolchain/ts/rompack/generated_modules';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import { SYSTEM_ROM_ASSET_OFFSET } from '../../toolchain/ts/rompack/system';
import { buildRomBlua32Tail, compileLuaChunkBuffer } from '../../scripts/rompacker/rombuilder';

test('BLua32 image rejects a cart Lua module that collides with the persisted GX VRAM layout', () => {
	const entrySource = 'module<entry>\nreturn true';
	const cartLayoutSource = 'return { scene = 1 }';
	const generatedLayoutSource = 'return { scene = 2 }';
	const assets: RomAsset[] = [
		{
			resid: 'cart',
			type: 'lua',
			buffer: Buffer.from(entrySource),
			compiled_buffer: compileLuaChunkBuffer(entrySource, 'cart'),
			source_path: 'cart.lua',
		},
		{
			resid: 'cart_layout',
			type: 'lua',
			buffer: Buffer.from(cartLayoutSource),
			compiled_buffer: compileLuaChunkBuffer(cartLayoutSource, GX_VRAM_LAYOUT_MODULE_PATH),
			source_path: GX_VRAM_LAYOUT_SOURCE_PATH,
		},
		{
			resid: GX_VRAM_LAYOUT_MODULE_PATH,
			type: 'lua',
			buffer: Buffer.from(generatedLayoutSource),
			compiled_buffer: compileLuaChunkBuffer(generatedLayoutSource, GX_VRAM_LAYOUT_MODULE_PATH),
			source_path: GX_VRAM_LAYOUT_SOURCE_PATH,
		},
	];
	assert.throws(
		() => buildRomBlua32Tail(assets, {
			generatedLuaModules: [],
			includeSymbols: true,
			optLevel: 3,
			systemAssetEndOffset: SYSTEM_ROM_ASSET_OFFSET,
			domain: 'system',
			ramByteCount: 0x00400000,
			biosExports: [],
		}),
		/ROM Lua module 'bmsx\/gx_vram_layout' is defined more than once/,
	);
});
