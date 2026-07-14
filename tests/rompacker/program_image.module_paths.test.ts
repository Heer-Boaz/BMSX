import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	GX_TEXTURE_LAYOUT_MODULE_PATH,
	GX_TEXTURE_LAYOUT_SOURCE_PATH,
	type RomAsset,
} from '../../machine/ts/rompack/format';
import { appendProgramImage, compileLuaChunkBuffer } from '../../scripts/rompacker/rombuilder';

test('program image rejects a cart Lua module that collides with the persisted GX layout', () => {
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

	assert.throws(
		() => appendProgramImage(assets, 'cart.lua'),
		/ROM Lua module 'bmsx\/gx_texture_layout' is defined more than once/,
	);
});
