import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	GX_TEXTURE_LAYOUT_MODULE_PATH,
	GX_TEXTURE_LAYOUT_SOURCE_PATH,
} from '../../machine/ts/rompack/tooling/generated_modules';
import type { RomAsset } from '../../machine/ts/rompack/tooling/assets';
import { layoutRomPrefix } from '../../machine/ts/rompack/tooling/rom_prefix_layout';
import { buildRomBlua32Tail, compileLuaChunkBuffer } from '../../scripts/rompacker/rombuilder';

test('BLua32 image rejects a cart Lua module that collides with the persisted GX layout', () => {
	const entrySource = 'return true';
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
			compiled_buffer: compileLuaChunkBuffer(cartLayoutSource, GX_TEXTURE_LAYOUT_MODULE_PATH),
			source_path: GX_TEXTURE_LAYOUT_SOURCE_PATH,
		},
		{
			resid: GX_TEXTURE_LAYOUT_MODULE_PATH,
			type: 'lua',
			buffer: Buffer.from(generatedLayoutSource),
			compiled_buffer: compileLuaChunkBuffer(generatedLayoutSource, GX_TEXTURE_LAYOUT_MODULE_PATH),
			source_path: GX_TEXTURE_LAYOUT_SOURCE_PATH,
		},
	];
	const layout = layoutRomPrefix(assets, true, null);

	assert.throws(
		() => buildRomBlua32Tail(assets, 'cart.lua', {
			externalLuaAssets: [],
			generatedLuaModules: [],
			includeSymbols: true,
			optLevel: 3,
			imageOffset: layout.blua32Offset,
			domain: 'system',
			ramByteCount: 0x00400000,
		}),
		/ROM Lua module 'bmsx\/gx_texture_layout' is defined more than once/,
	);
});
